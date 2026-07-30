// Парсер заявок контрагента ООО «Фермерский Супермаркет» (ФС).
// Формат — «ДОГОВОР-ЗАЯВКА на транспортные услуги» ГФ Трейд: подписанная таблица,
// МУЛЬТИСТОП (один забор в Москве + несколько выгрузок → одна заявка на точку).
// Источник текста — извлечение из .docx (mammoth) или OCR PDF (Google Vision).
//
// ВНИМАНИЕ: логика проверена на тексте из .docx. На реальном выводе Google Vision
// (PDF-путь) раскладка может отличаться — сверить перед боевым использованием.
import type { ParsedImport, ParsedRequestDraft, ParsedCargoLine } from '../types';

const FS_CLIENT_INN = '7723370817';   // ООО «Фермерский Супермаркет» — клиент
const CARRIER_INN = '7811715411';      // ООО «ГФ Трейд» — исполнитель (не клиент)
const PICKUP_NAME = 'СФЕРМ (Москва)';  // точка забора; сверить с реестром точек

const num = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

function titleCity(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.replace(/(^|[\s-])([а-яё])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

function parseTimeRange(spec: string | undefined | null): { from: string | null; to: string | null } {
  if (!spec) return { from: null, to: null };
  const range = spec.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
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

// «Вес» в этом формате — в тоннах (0,334 → 334 кг). Малые значения (<10) считаем
// тоннами и переводим в кг; крупные (>=10) считаем уже килограммами.
function weightToKg(v: number | null): number | null {
  if (v == null) return null;
  return v < 10 ? Math.round(v * 1000) : Math.round(v);
}

export function parseFermerskySupermarket(ocrText: string): ParsedImport {
  const warnings: string[] = [];
  const text = ocrText.replace(/\r/g, '');
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Отрезаем «Данные транспортного средства»/«Прочие условия» и ниже (юр. текст
  // с «400 кг», «1000 руб/час», временами «15:00»/«18:00»).
  const cutIdx = allLines.findIndex((l) => /прочие\s+услови|данные\s+транспортн/i.test(l));
  const lines = cutIdx > 0 ? allLines.slice(0, cutIdx) : allLines;
  const region = lines.join('\n');

  // Дата документа: «29» 07 2026 г
  const dm = region.match(/[«"'”]\s*(\d{1,2})\s*[»"'”]\s*(\d{2})\b/);
  const ym = region.match(/(20\d{2})\s*г/);
  const documentDate = dm && ym ? toIso(`${dm[1].padStart(2, '0')}.${dm[2]}.${ym[1]}`) : null;
  if (!documentDate) warnings.push('Не удалось распознать дату документа.');

  // ИНН клиента (реквизиты — ниже отрезанной части, ищем во всём тексте).
  const clientInn = text.includes(FS_CLIENT_INN) ? FS_CLIENT_INN : null;
  if (!clientInn) warnings.push(`ИНН клиента (${FS_CLIENT_INN}) не найден — это точно «Фермерский Супермаркет»?`);

  // Даты и интервалы времени в порядке следования.
  // Дата погрузки — [0]; дата выгрузки — [1] (в шаблоне одна на все выгрузки).
  const dates = Array.from(region.matchAll(/\b(\d{2}\.\d{2}\.\d{4})\b/g)).map((m) => m[1]);
  // Время: [0] — погрузка, далее — выгрузки по порядку остановок.
  const times = Array.from(region.matchAll(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/g)).map((m) => `${m[1]}-${m[2]}`);
  const pickupDate = dates[0] ? toIso(dates[0]) : null;
  const deliveryDate = dates[1] ? toIso(dates[1]) : pickupDate;
  const pickupT = parseTimeRange(times[0]);
  const deliveryTimes = times.slice(1);

  // Блок груза (от заголовка «Наименование груза»/«Номер Заказа»): «N Город» →
  // вес(тонны) → «M паллета». В этом блоке нет телефонов/времён — ищем в нём и темп.
  const startIdx = lines.findIndex((l) => /номер\s*заказа|наименование\s+груза/i.test(l));
  const cargoBlock = startIdx >= 0 ? lines.slice(startIdx) : lines;
  const cargoText = cargoBlock.join('\n');

  // Температурный режим (один на груз): «+2-+4» → COOLED, отрицательный → FROZEN.
  // Требуем «+» после тире, чтобы не спутать с хвостом телефона («…793-78-64»).
  const tempMatch = cargoText.match(/([+\-])\s*\d{1,2}\s*[-–]\s*\+\s*\d{1,2}/);
  let tempRegime: string | null = null;
  if (tempMatch) tempRegime = tempMatch[1] === '-' ? 'FROZEN' : 'COOLED';

  const stopRe = /^(\d)\s+([А-ЯЁ][А-Яа-яёЁ.\- ]+)$/;   // «1 Пушкино», не «1. адрес…»
  const weightRe = /^(\d+[.,]\d+)$/;
  const palletRe = /(\d+)\s*паллет/i;

  type Stop = { city: string; weightKg: number | null; pallets: number };
  const stops: Stop[] = [];
  let cur: Stop | null = null;
  for (const l of cargoBlock) {
    const sm = l.match(stopRe);
    if (sm) { cur = { city: titleCity(sm[2].replace(/[.\-]/g, ' ').trim()), weightKg: null, pallets: 0 }; stops.push(cur); continue; }
    if (!cur) continue;
    const wm = l.match(weightRe);
    if (wm && cur.weightKg == null) { cur.weightKg = weightToKg(num(wm[1])); continue; }
    const pm = l.match(palletRe);
    if (pm && !cur.pallets) { cur.pallets = Number(pm[1]); continue; }
  }

  if (!stops.length) warnings.push('Не найдено ни одной строки груза («N Город») — проверьте раскладку.');
  if (deliveryTimes.length && deliveryTimes.length !== stops.length) {
    warnings.push(`Остановок ${stops.length}, а интервалов выгрузки ${deliveryTimes.length} — время могло разъехаться; проверьте.`);
  }
  warnings.push('Вес принят в тоннах и переведён в кг (×1000). Точки «Самокат <город>» и «СФЕРМ (Москва)» должны совпасть с реестром Location (или добавьте алиасы) — иначе заявки не создадутся.');

  const requests: ParsedRequestDraft[] = stops.map((s, i) => {
    const delT = parseTimeRange(deliveryTimes[i]);
    const cargoLine: ParsedCargoLine = {
      rawName: 'Продукты питания',
      city: s.city,
      orderNumbers: [],
      tempRegime,
      pallets: s.pallets || null,
      weightKg: s.weightKg,
    };
    return {
      city: s.city,
      destinationName: `Самокат ${s.city}`,
      deliveryDate,
      deliveryTimeFrom: delT.from,
      deliveryTimeTo: delT.to,
      pickupDate,
      pickupTimeFrom: pickupT.from,
      pickupTimeTo: pickupT.to,
      pickupName: PICKUP_NAME,
      pallets: s.pallets,
      weightKg: s.weightKg,
      tempRegime,
      cargoLines: [cargoLine],
      notes: `Груз: Продукты питания; ${s.pallets} пал; ${s.weightKg ?? '?'} кг`,
    };
  });

  return { clientInn, clientName: 'Фермерский Супермаркет', documentDate, requests, warnings };
}
