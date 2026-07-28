// Парсер PDF-заявок контрагента КОРОЛЕВСКИЙ ВКУС.
// Вход — текст после OCR (скан «Договор-заявка на оказание транспортных услуг»).
// Выход — по одной заявке на город назначения (грузы города сливаются при создании).
// Устойчив к типовому шуму OCR: лишние «|», «_», пропуски весов.
import type { ParsedImport, ParsedRequestDraft, ParsedCargoLine } from '../types';

const KV_CLIENT_INN = '7724618482';
const PICKUP_NAME = 'Королевский Вкус (произв.)'; // забор у КВ всегда с производства в Королёве

const num = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// Город с заглавной по словам, сохраняя дефисы: «КАЗАНЬ» → «Казань», «РОСТОВ-НА-ДОНУ» → «Ростов-на-Дону»
function titleCity(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.replace(/(^|[\s-])([а-яё])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

// «17:00-19:00» → {from:'17:00',to:'19:00'}; «До 12:00» → {from:null,to:'12:00'}
function parseTime(spec: string): { from: string | null; to: string | null } {
  const range = spec.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
  if (range) return { from: range[1], to: range[2] };
  const until = spec.match(/(?:до\s*)?(\d{1,2}:\d{2})/i);
  if (until) return { from: null, to: until[1] };
  return { from: null, to: null };
}

function toIso(dd: string): string | null {
  const m = dd.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Темп. режим по диапазону: «+2-+4» → COOLED, «-18» → FROZEN, иначе AMBIENT
function parseTemp(line: string): string | null {
  const m = line.match(/([+-]?\d{1,2})\s*[-.–]+\s*([+-]?\d{1,2})/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if ([lo, hi].some((v) => v < 0)) return 'FROZEN';
  if (hi <= 8) return 'COOLED';
  return 'AMBIENT';
}

export function parseKorolevskyVkus(ocrText: string): ParsedImport {
  const warnings: string[] = [];
  const text = ocrText.replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Дата документа: «25» 07 2026
  const docM = text.match(/«?\s*(\d{1,2})\s*»?\s+(\d{2})\s+(\d{4})\s*г/);
  const documentDate = docM ? toIso(`${docM[1].padStart(2, '0')}.${docM[2]}.${docM[3]}`) : null;
  const clientInn = text.includes(KV_CLIENT_INN) ? KV_CLIENT_INN : null;
  if (!clientInn) warnings.push('ИНН клиента (7724618482) не найден в тексте — проверьте, это КОРОЛЕВСКИЙ ВКУС?');

  // Даты+время в разделе «Условия перевозки»: [0] = забор, далее — выгрузки по порядку
  const dateTime: { date: string; time: string }[] = [];
  for (const l of lines) {
    const dm = l.match(/\d{2}\.\d{2}\.\d{4}/);
    if (!dm) continue;
    const t = l.match(/(?:до\s*)?\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?/i);
    dateTime.push({ date: dm[0], time: t ? t[0] : '' });
    if (dateTime.length >= 8) break; // хватит; ниже реквизиты
  }
  const pickup = dateTime[0];
  const deliveries = dateTime.slice(1);
  const pickupDate = pickup ? toIso(pickup.date) : null;
  const pickupT = pickup ? parseTime(pickup.time) : { from: null, to: null };

  // Строки грузов: содержат «Самокат <ГОРОД>» + «N европаллет»
  const cargoLines: ParsedCargoLine[] = [];
  for (const l of lines) {
    if (!/самокат/i.test(l) || !/европал/i.test(l)) continue;
    const cityM = l.match(/самокат\s+([^\d|]+)/i);
    if (!cityM) continue;
    const city = titleCity(cityM[1].replace(/[|_]/g, ' ').trim());
    if (!city) continue;
    const pallets = num((l.match(/(\d+)\s*европал/i) || [])[1]);
    const weightKg = num((l.match(/([\d.,]+)\s*кг/i) || [])[1]);
    // № заказа: цифры между городом и темп-режимом («+2…»)
    const afterCity = l.slice(l.toLowerCase().indexOf('самокат'));
    const orderPart = afterCity.split(/[+±]\s*\d/)[0].replace(/самокат\s+[^\d|]+/i, '');
    const orderNumbers = (orderPart.match(/\d{3,}/g) || []).filter((n) => n.length <= 7);
    cargoLines.push({ rawName: l.replace(/\s*\|\s*/g, ' ').trim().slice(0, 120), city, orderNumbers, tempRegime: parseTemp(l), pallets, weightKg });
  }
  if (!cargoLines.length) warnings.push('Не найдено ни одной строки груза («Самокат ГОРОД … европаллет») — проверьте качество OCR.');

  // Группировка по городу в порядке появления
  const order: string[] = [];
  const byCity = new Map<string, ParsedCargoLine[]>();
  for (const c of cargoLines) {
    if (!byCity.has(c.city)) { byCity.set(c.city, []); order.push(c.city); }
    byCity.get(c.city)!.push(c);
  }

  if (deliveries.length && deliveries.length !== order.length) {
    warnings.push(`Городов назначения ${order.length}, а дат выгрузки ${deliveries.length} — даты выгрузки могли распознаться неточно; проверьте.`);
  }

  const requests: ParsedRequestDraft[] = order.map((city, i) => {
    const group = byCity.get(city)!;
    const del = deliveries[i];
    const delT = del ? parseTime(del.time) : { from: null, to: null };
    const pallets = group.reduce((s, c) => s + (c.pallets || 0), 0);
    const weights = group.map((c) => c.weightKg).filter((w): w is number => w != null);
    const weightKg = weights.length ? Math.round(weights.reduce((s, w) => s + w, 0) * 100) / 100 : null;
    for (const c of group) {
      if (c.pallets != null && c.weightKg == null) warnings.push(`OCR не распознал вес строки: «${c.rawName.slice(0, 60)}» — вес заявки может быть неполным.`);
    }
    const temp = group.find((c) => c.tempRegime)?.tempRegime ?? null;
    const notes = group.map((c) => c.rawName + (c.orderNumbers.length ? ` (№ ${c.orderNumbers.join(', ')})` : '')).join('; ');
    return {
      city,
      destinationName: `Самокат ${city}`,
      deliveryDate: del ? toIso(del.date) : null,
      deliveryTimeFrom: delT.from,
      deliveryTimeTo: delT.to,
      pickupDate,
      pickupTimeFrom: pickupT.from,
      pickupTimeTo: pickupT.to,
      pickupName: PICKUP_NAME,
      pallets,
      weightKg,
      tempRegime: temp,
      cargoLines: group,
      notes,
    };
  });

  return { clientInn, clientName: 'КОРОЛЕВСКИЙ ВКУС', documentDate, requests, warnings };
}
