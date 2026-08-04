// Универсальный парсер «ДОГОВОР-ЗАЯВКА на транспортные услуги» ГФ Трейд.
// Один код на всех клиентов этого шаблона (Поляна, Фермерский Супермаркет, Профул…):
// клиент определяется по ИНН (тот, что НЕ исполнитель), стопы — из стандартной таблицы.
// Новый КА = только запись контрагента с parserKey='gf-trade', без нового кода.
// Источник текста — OCR PDF (Google Vision) или извлечение docx.
//
// ВНИМАНИЕ: логика собрана по разбору документов и синтетике/реальному docx (ФС).
// На реальном выводе Google Vision раскладка может отличаться — сверять перед боем.
import type { ParsedImport, ParsedRequestDraft, ParsedCargoLine } from '../types';

const CARRIER_INN = '7811715411'; // ООО «ГФ Трейд» — исполнитель (не клиент)

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

// «Вес» бывает в тоннах (0,334) и в кг (103,00). Малые (<10) считаем тоннами (×1000),
// крупные (>=10) — килограммами.
function weightToKg(v: number | null): number | null {
  if (v == null) return null;
  return v < 10 ? Math.round(v * 1000) : Math.round(v);
}

// Служебные слова из шапки таблицы — НЕ могут быть пунктом назначения. Vision иногда
// разбивает «Номер Заказа» на отдельные строки «Номер»/«Заказа», поэтому проверяем и
// одиночные слова, а не только фразу «номер заказа».
const SERVICE_WORDS = /^(?:номер|заказа?|наименование|груза?|темп|вес|объ[её]м|количество|мест[оа]?|стоимость|итого|дата|время|условия|прочие)$/i;

// Пункт назначения правдоподобен, если длиннее 2 символов и не является одним
// служебным словом (список выше).
function isPlausibleDest(name: string): boolean {
  const t = name.trim();
  if (t.length < 3) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && SERVICE_WORDS.test(words[0])) return false;
  return true;
}

export function parseGfTrade(ocrText: string): ParsedImport {
  const warnings: string[] = [];
  const text = ocrText.replace(/\r/g, '');
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Отрезаем «Данные транспортного средства»/«Прочие условия» и ниже (юр. текст).
  const cutIdx = allLines.findIndex((l) => /прочие\s+услови|данные\s+транспортн/i.test(l));
  const lines = cutIdx > 0 ? allLines.slice(0, cutIdx) : allLines;
  const region = lines.join('\n');

  // Дата документа: «29» 07 2026 г  или  «03» августа 2026 г (месяц словом).
  const MON: Record<string, string> = { янв: '01', фев: '02', мар: '03', апр: '04', мая: '05', июн: '06', июл: '07', авг: '08', сен: '09', окт: '10', ноя: '11', дек: '12' };
  // «29» 07 …  Vision иногда искажает: «« → <<», «г» → латинская «r».
  const dm = region.match(/(?:[«"'”]|<<)\s*(\d{1,2})\s*(?:[»"'”]|>>)?\s*([а-яё]{3,}|\d{2})/i);
  const ym = region.match(/(20\d{2})\s*[гr]/i);
  const mm = dm ? (/^\d{2}$/.test(dm[2]) ? dm[2] : (MON[dm[2].toLowerCase().slice(0, 3)] ?? null)) : null;
  const documentDate = dm && ym && mm ? toIso(`${dm[1].padStart(2, '0')}.${mm}.${ym[1]}`) : null;
  if (!documentDate) warnings.push('Не удалось распознать дату документа.');

  // Клиент = ИНН при метке «ИНН», не равный исполнителю. Ищем во всём тексте.
  const inns = Array.from(text.matchAll(/ИНН[^\d]{0,12}(\d{10})/gi)).map((m) => m[1]);
  const clientInn = inns.find((i) => i !== CARRIER_INN) ?? null;
  if (!clientInn) warnings.push('ИНН клиента не найден (или найден только исполнитель) — проверьте документ.');

  // Даты и интервалы времени по порядку: [0] — погрузка, далее — выгрузки.
  const dates = Array.from(region.matchAll(/\b(\d{2}\.\d{2}\.\d{4})\b/g)).map((m) => m[1]);
  const times = Array.from(region.matchAll(/(\d{1,2}:\d{2})(?:\s*[-–—]\s*(\d{1,2}:\d{2}))?/g)).map((m) => (m[2] ? `${m[1]}-${m[2]}` : m[1]));
  const pickupDate = dates[0] ? toIso(dates[0]) : null;
  const pickupT = parseTimeRange(times[0]);
  const deliveryDates = dates.slice(1);
  const deliveryTimes = times.slice(1);

  // Точка забора: грузоотправитель (ООО …) рядом с меткой; иначе общее имя.
  const shipM = region.match(/грузоотправител[ья][\s\S]{0,60}?(ООО[^\n,|]{1,40})/i);
  const pickupName = shipM ? shipM[1].replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim() : 'Погрузка (ГФ Трейд)';

  // Температурный режим (обычно один): «+2-+4»/«+2+4» → COOLED; отрицательный → FROZEN.
  const startIdx = lines.findIndex((l) => /номер\s*заказа|наименование\s+груза/i.test(l));
  let endIdx = lines.findIndex((l, i) => startIdx >= 0 && i > startIdx && /услови[яй]\s+оплаты/i.test(l));
  if (endIdx < 0) endIdx = lines.length;
  const cargoBlock = startIdx >= 0 ? lines.slice(startIdx, endIdx) : lines;
  const cargoText = cargoBlock.join('\n');
  const tempM = cargoText.match(/([+\-])\s*\d{1,2}\s*°?[СCсc]?\s*[-–]?\s*([+\-])\s*\d{1,2}/);
  const tempRegime: string | null = tempM ? (tempM[1] === '-' ? 'FROZEN' : 'COOLED') : null;

  // Стопы из таблицы груза: метка (нумерованная «1 Пушкино» или именованная «Перекрёсток»)
  // → вес → «M паллет». Служебные строки исключаем.
  const stopRe = /^(?:\d\s+)?([А-ЯЁ][А-Яа-яёЁ.\- ]{2,32})$/;
  const skipRe = /продукт|наименован|номер\s*заказ|темп|вес|объ[её]м|количеств|стоимост|груз|европал|паллет|услови|адрес|контакт|склад|дата|время/i;
  const palletRe = /(\d+)\s*(?:европал|паллет|мест)/i;

  type Stop = { city: string; destinationName: string; weightKg: number | null; pallets: number };
  const stops: Stop[] = [];
  const allWeights: (number | null)[] = [];
  const allPallets: number[] = [];
  let cur: Stop | null = null;
  for (const l of cargoBlock) {
    const sm = l.match(stopRe);
    if (sm && !skipRe.test(l) && isPlausibleDest(sm[1])) { const city = titleCity(sm[1].replace(/[.\-]/g, ' ').trim()); cur = { city, destinationName: city, weightKg: null, pallets: 0 }; stops.push(cur); continue; }
    const pm = l.match(palletRe);
    if (pm) { const p = Number(pm[1]); allPallets.push(p); if (cur && !cur.pallets) cur.pallets = p; continue; }
    // Вес: строка-число; пробелы внутри убираем («149. 185» → 149.185).
    // Вес: явное «150 кг», либо число ≤4 цифр (чтобы не спутать с 10-значным номером заказа).
    const wKg = l.match(/(\d+(?:[.,]\d+)?)\s*кг(?![а-яё])/i);
    if (wKg) { const w = weightToKg(num(wKg[1])); allWeights.push(w); if (cur && cur.weightKg == null) cur.weightKg = w; continue; }
    const norm = l.replace(/\s+/g, '');
    if (/^\d{1,4}(?:[.,]\d+)?$/.test(norm)) { const w = weightToKg(num(norm)); allWeights.push(w); if (cur && cur.weightKg == null) cur.weightKg = w; continue; }
  }

  // Фолбэк для одностоповых без метки в «Номер заказа» (Крафт, Корона, Поляна):
  // получатели из секции выгрузки (не только «Самокат» — ещё Пятёрочка/Перекрёсток/…),
  // вес/паллеты из блока груза по индексу.
  if (!stops.length) {
    const delStart = lines.findIndex((l) => /грузополучател|дата\s+выгрузк/i.test(l));
    const delLines = delStart >= 0 ? lines.slice(delStart, startIdx >= 0 ? startIdx : lines.length) : lines;
    const consRe = /самокат|пят[её]роч|перекр[её]ст|магнит|умный\s+ритейл|ритейл|\bрц\b|\bтд\b/i;
    const dests = Array.from(new Set(delLines
      .filter((l) => consRe.test(l) && !/адрес|контакт|дата|время|грузополучател/i.test(l))
      .map((l) => l.replace(/\s+/g, ' ').trim())));
    dests.forEach((d, i) => {
      // Обрезаем хвост-адрес, если он попал в ту же строку.
      const clean = d.split(/\s+(?=\d{5,6}\b|область|обл\.?\b|район|р-н|ул\.|д\.\s*\d)/i)[0].trim();
      if (!isPlausibleDest(clean)) return; // не выдумываем точку из служебного текста/мусора
      const cm = clean.match(/самокат\s+([А-ЯЁ][а-яё]+)/i);
      const city = cm ? titleCity(cm[1]) : clean.split(/[\s(]/)[0];
      stops.push({ city, destinationName: clean, weightKg: allWeights[i] ?? allWeights[0] ?? null, pallets: allPallets[i] ?? allPallets[0] ?? 0 });
    });
    // Задача 2: если ничего не нашли или получатель распознан неуверенно (одно слово) —
    // прикладываем фрагмент блока выгрузки, чтобы оператор разобрал через интерфейс.
    const singleWord = stops.some((s) => s.destinationName.split(/\s+/).filter(Boolean).length === 1);
    if (!stops.length || singleWord) {
      const frag = delLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      warnings.push(stops.length
        ? `Пункт назначения распознан неуверенно — сверьте по блоку выгрузки: «${frag}»`
        : `Не удалось определить пункт назначения. Блок выгрузки: «${frag}»`);
    }
  }

  if (!stops.length) warnings.push('Не найдено ни одной строки груза (метка стопа) — проверьте раскладку OCR.');
  if (deliveryTimes.length && deliveryTimes.length !== stops.length) {
    warnings.push(`Стопов ${stops.length}, а интервалов выгрузки ${deliveryTimes.length} — время могло разъехаться; проверьте.`);
  }
  warnings.push('Точки (забор/выгрузка) должны совпасть с реестром Location (или добавьте алиасы) — иначе заявки не создадутся. Единицы веса определены эвристикой (<10 → тонны).');

  const requests: ParsedRequestDraft[] = stops.map((s, i) => {
    const delT = parseTimeRange(deliveryTimes[i]);
    // Дата выгрузки: своя на стоп, если их столько же; иначе единственная — на все.
    const dd = deliveryDates.length === stops.length ? deliveryDates[i] : (deliveryDates[deliveryDates.length - 1] ?? deliveryDates[0]);
    const cargoLine: ParsedCargoLine = {
      rawName: `Продукты питания — ${s.city}`,
      city: s.city,
      orderNumbers: [],
      tempRegime,
      pallets: s.pallets || null,
      weightKg: s.weightKg,
    };
    return {
      city: s.city,
      destinationName: s.destinationName, // метка стопа/получатель; сопоставление — через реестр/алиасы
      deliveryDate: dd ? toIso(dd) : null,
      deliveryTimeFrom: delT.from,
      deliveryTimeTo: delT.to,
      pickupDate,
      pickupTimeFrom: pickupT.from,
      pickupTimeTo: pickupT.to,
      pickupName,
      pallets: s.pallets,
      weightKg: s.weightKg,
      tempRegime,
      cargoLines: [cargoLine],
      notes: `Груз: Продукты питания; ${s.pallets} пал; ${s.weightKg ?? '?'} кг`,
    };
  });

  return { clientInn, clientName: null, documentDate, requests, warnings };
}
