// Парсер PDF-заявок контрагента ООО «Поляна» (OCR = Google Cloud Vision).
// Формат — типовой «ДОГОВОР-ЗАЯВКА на оказание транспортных услуг»: таблица с
// подписанными полями (Дата загрузки/выгрузки, Адрес погрузки/выгрузки, Вес,
// Количество мест и т.п.). Одна погрузка (Москва) и одна выгрузка (город
// назначения), один груз. В отличие от korolevskyVkus извлекаем по меткам и
// порядку следования, а не по колоночным блокам Vision.
//
// ВНИМАНИЕ: логика проверена на СИНТЕТИЧЕСКОМ OCR-образце. Раскладку реального
// вывода Google Vision для этой вёрстки НЕ сверяли — перед боевым использованием
// прогнать настоящий PDF через Vision и проверить извлечённые поля (см. warnings).
import type { ParsedImport, ParsedRequestDraft, ParsedCargoLine } from '../types';

const POLYANA_CLIENT_INN = '7701412799';   // ООО «Поляна» — клиент
const CARRIER_INN = '7811715411';           // ООО «ГФ Трейд» — исполнитель (не клиент)
const PICKUP_NAME = 'Поляна (Москва)';      // точка забора; сверить с реестром точек

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

// Город из адреса: «г. Воронеж, Новоусманский р-н, …» → «Воронеж».
function cityFromAddress(addr: string): string | null {
  const m = addr.match(/г\.?\s*([А-ЯЁ][а-яё]+(?:[-\s][А-ЯЁ][а-яё]+)?)/);
  return m ? titleCity(m[1]) : null;
}

export function parsePolyana(ocrText: string): ParsedImport {
  const warnings: string[] = [];
  const text = ocrText.replace(/\r/g, '');
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Отрезаем «Прочие условия» и ниже (юр. текст с «400 кг», «1000 руб/час»,
  // одиночными временами «15:00»/«18:00», датой доверенности в подписи).
  const cutIdx = allLines.findIndex((l) => /прочие\s+услови|данные\s+транспортного/i.test(l));
  const head = cutIdx > 0 ? allLines.slice(0, cutIdx) : allLines;
  const region = head.join('\n');

  // Дата документа: «29» 07 2026 г (кавычки/пробелы могут гулять).
  const dm = region.match(/[«"'”]\s*(\d{1,2})\s*[»"'”]\s*(\d{2})\b/);
  const ym = region.match(/(20\d{2})\s*г/);
  const documentDate = dm && ym ? toIso(`${dm[1].padStart(2, '0')}.${dm[2]}.${ym[1]}`) : null;
  if (!documentDate) warnings.push('Не удалось распознать дату документа.');

  // ИНН клиента ищем во всём тексте (реквизиты — ниже отрезанной части).
  const clientInn = text.includes(POLYANA_CLIENT_INN) ? POLYANA_CLIENT_INN : null;
  if (!clientInn) {
    warnings.push(`ИНН клиента (${POLYANA_CLIENT_INN}) не найден — это точно «Поляна»?`);
  }
  if (text.includes(CARRIER_INN) && !clientInn) {
    warnings.push('Найден ИНН исполнителя, но не клиента — проверьте документ.');
  }

  // Даты в порядке следования: [0] — погрузка, [1] — выгрузка.
  const dates = Array.from(region.matchAll(/\b(\d{2}\.\d{2}\.\d{4})\b/g)).map((m) => m[1]);
  // Диапазоны времени в порядке: [0] — погрузка, [1] — выгрузка.
  const times = Array.from(region.matchAll(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/g)).map((m) => `${m[1]}-${m[2]}`);

  if (dates.length < 2) warnings.push(`Найдено дат: ${dates.length} (ожидались погрузка и выгрузка) — проверьте.`);
  if (times.length < 2) warnings.push(`Найдено интервалов времени: ${times.length} (ожидались погрузка и выгрузка) — проверьте.`);

  const pickupDate = dates[0] ? toIso(dates[0]) : null;
  const deliveryDate = dates[1] ? toIso(dates[1]) : null;
  const pickupT = parseTimeRange(times[0]);
  const deliveryT = parseTimeRange(times[1]);

  // Город назначения: из блока после метки «Адрес выгрузки»/«Грузополучатель».
  const delIdx = region.search(/адрес\s+выгрузки|грузополучател/i);
  let city: string | null = null;
  if (delIdx >= 0) city = cityFromAddress(region.slice(delIdx));
  // Фолбэк: первый город из «г. …», не являющийся Москвой/СПб (пункты забора).
  if (!city) {
    const all = Array.from(region.matchAll(/г\.?\s*([А-ЯЁ][а-яё]+(?:[-\s][А-ЯЁ][а-яё]+)?)/g)).map((m) => titleCity(m[1]));
    city = all.find((c) => !/^(Москва|Санкт|Петербург)/i.test(c)) ?? null;
    if (city) warnings.push('Город назначения определён фолбэком (первый не-московский) — проверьте.');
  }
  if (!city) {
    warnings.push('Не удалось определить город назначения из «Адрес выгрузки».');
    city = 'Не определён';
  }

  // Вес и паллеты из строки груза (раздел 1).
  const weightKg = num((region.match(/([\d]+[.,]?\d*)\s*кг/i) || [])[1]);
  const palletsM = region.match(/(\d+)\s*(?:европал|паллет|мест)/i);
  const pallets = palletsM ? Number(palletsM[1]) : 0;
  if (!pallets) warnings.push('Не удалось определить количество паллет/мест.');

  // Температурный режим: «+2+4°C» → COOLED; отрицательные → FROZEN; иначе AMBIENT.
  const tempStr = (region.match(/([+\-]?\d+\s*[+\-]\s*[+\-]?\d+\s*°?\s*C)/i) || [])[0] || '';
  let tempRegime: string | null = null;
  if (/-\s*\d/.test(tempStr)) tempRegime = 'FROZEN';
  else if (/\d/.test(tempStr)) tempRegime = 'COOLED';

  const cargoLine: ParsedCargoLine = {
    rawName: 'Продукты питания — Самокат',
    city,
    orderNumbers: [],
    tempRegime,
    pallets: pallets || null,
    weightKg,
  };

  const request: ParsedRequestDraft = {
    city,
    destinationName: `Самокат ${city}`,
    deliveryDate,
    deliveryTimeFrom: deliveryT.from,
    deliveryTimeTo: deliveryT.to,
    pickupDate,
    pickupTimeFrom: pickupT.from,
    pickupTimeTo: pickupT.to,
    pickupName: PICKUP_NAME,
    pallets,
    weightKg,
    tempRegime,
    cargoLines: [cargoLine],
    notes: `Груз: ${cargoLine.rawName}; ${pallets} паллет; ${weightKg ?? '?'} кг`,
  };

  return { clientInn, clientName: 'Поляна', documentDate, requests: [request], warnings };
}
