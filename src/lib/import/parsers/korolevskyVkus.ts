// Парсер PDF-заявок контрагента КОРОЛЕВСКИЙ ВКУС (OCR = Google Cloud Vision).
// Vision выдаёт текст блоками-колонками: сначала все 9 названий грузов (по порядку
// Казань×3, Самара×3, Уфа×3), затем блок данных (№/темп/вес/паллеты/цена) в том же порядке.
// Стратегия: собрать города из названий и паллеты/вес из блока данных, зипнуть по индексу,
// сгруппировать по городу → одна заявка на город (грузы города сливаются).
import type { ParsedImport, ParsedRequestDraft, ParsedCargoLine } from '../types';

const KV_CLIENT_INN = '7724618482';
const PICKUP_NAME = 'Королевский Вкус (произв.)';

const num = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

function titleCity(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.replace(/(^|[\s-])([а-яё])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

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
  const dt = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function parseKorolevskyVkus(ocrText: string): ParsedImport {
  const warnings: string[] = [];
  const text = ocrText.replace(/\r/g, '');
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Отрезаем «Условия оплаты» и далее (юр. текст с «400 кг», «1000 руб» и т.п.)
  const cutIdx = allLines.findIndex((l) => /услови[яй]\s+оплаты/i.test(l));
  const lines = cutIdx > 0 ? allLines.slice(0, cutIdx) : allLines;
  const region = lines.join('\n');

  // Дата документа: «25» 07 … 2026 г (в Vision разбито на строки)
  const dm = text.match(/(\d{1,2})\s*[»"']\s*(\d{2})\b/);
  const ym = text.match(/(20\d{2})\s*г/);
  const documentDate = dm && ym ? toIso(`${dm[1].padStart(2, '0')}.${dm[2]}.${ym[1]}`) : null;
  if (!documentDate) warnings.push('Не удалось распознать дату документа.');
  const clientInn = text.includes(KV_CLIENT_INN) ? KV_CLIENT_INN : null;
  if (!clientInn) warnings.push('ИНН клиента (7724618482) не найден — проверьте, это КОРОЛЕВСКИЙ ВКУС?');

  // Даты+время (раздел «Условия перевозки»): время на той же или следующей строке.
  // [0] — забор, далее — выгрузки по порядку.
  const isDate = (l: string) => /\d{2}\.\d{2}\.\d{4}/.test(l);
  const timeRe = /(?:до\s*)?\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?/i;
  const dateTime: { date: string; time: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isDate(lines[i])) continue;
    const date = lines[i].match(/\d{2}\.\d{2}\.\d{4}/)![0];
    let time = (lines[i].match(timeRe) || [''])[0];
    if (!time) { const nx = lines[i + 1] || ''; if (!isDate(nx)) time = (nx.match(timeRe) || [''])[0]; }
    dateTime.push({ date, time });
  }
  const pickup = dateTime[0];
  const deliveries = dateTime.slice(1);
  const pickupDate = pickup ? toIso(pickup.date) : null;
  const pickupT = pickup ? parseTime(pickup.time) : { from: null, to: null };

  // Города из строк-названий «… Самокат ГОРОД» (в порядке следования)
  const cities: { raw: string; city: string }[] = [];
  for (const l of lines) {
    const m = l.match(/самокат\s+([^,\d|]+)/i);
    if (!m) continue;
    const city = titleCity(m[1].replace(/[|_]/g, ' ').trim());
    if (city) cities.push({ raw: l.replace(/\s+/g, ' ').trim(), city });
  }
  // Паллеты и веса из блока данных (в том же порядке)
  const pallets = Array.from(region.matchAll(/(\d+)\s*европал/gi)).map((m) => Number(m[1]));
  const weights = Array.from(region.matchAll(/([\d]+[.,]?\d*)\s*кг/gi)).map((m) => num(m[1]));

  if (!cities.length) warnings.push('Не найдено ни одной строки груза («… Самокат ГОРОД»).');
  if (cities.length !== pallets.length) warnings.push(`Городов ${cities.length}, а значений паллет ${pallets.length} — раскладка OCR разошлась, проверьте.`);
  const weightsAligned = weights.length === cities.length;
  if (!weightsAligned && cities.length) warnings.push(`Весов ${weights.length} при ${cities.length} грузах — вес не сопоставлен построчно, проставлен не будет.`);

  // Зип по индексу → строки грузов
  const n = Math.min(cities.length, pallets.length);
  const cargoLines: ParsedCargoLine[] = [];
  for (let i = 0; i < n; i++) {
    cargoLines.push({
      rawName: cities[i].raw.slice(0, 120),
      city: cities[i].city,
      orderNumbers: [],
      tempRegime: 'COOLED', // КВ возит в +2..+4
      pallets: pallets[i] ?? null,
      weightKg: weightsAligned ? weights[i] ?? null : null,
    });
  }

  // Группировка по городу (в порядке появления), пары с датами выгрузки по индексу
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
    const pal = group.reduce((s, c) => s + (c.pallets || 0), 0);
    const ws = group.map((c) => c.weightKg).filter((w): w is number => w != null);
    const weightKg = ws.length ? Math.round(ws.reduce((s, w) => s + w, 0) * 100) / 100 : null;
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
      pallets: pal,
      weightKg,
      tempRegime: 'COOLED',
      cargoLines: group,
      notes: group.map((c) => c.rawName).join('; '),
    };
  });

  return { clientInn, clientName: 'КОРОЛЕВСКИЙ ВКУС', documentDate, requests, warnings };
}
