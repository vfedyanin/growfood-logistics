// Парсер «ДОГОВОР-ЗАЯВКА (приложение к договору перевозки)» — заказчик ООО «КУК СТУДИО».
// Отличается от gf-trade: стороны Перевозчик/Заказчик, вес «Согласно УПД» (в документе
// числа нет), несколько выгрузок отдельными блоками (РЦ Х5 …), ИНН в документе отсутствует.
//
// ВНИМАНИЕ: ИНН заказчика в документе нет — задайте KUK_INN, иначе createRequests не найдёт
// контрагента. Проверено на тексте docx; на реальном OCR Vision (если придёт сканом) сверить.
import type { ParsedImport, ParsedRequestDraft, ParsedCargoLine } from '../types';

const KUK_INN = ''; // ← ЗАПОЛНИТЬ: ИНН ООО «КУК СТУДИО» (в документе его нет)

const titleCity = (raw: string): string =>
  raw.trim().toLowerCase().replace(/(^|[\s-])([а-яё])/g, (_m, s, c) => s + c.toUpperCase());

function toIso(dd: string): string | null {
  const m = dd.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function parseKukStudio(ocrText: string): ParsedImport {
  const warnings: string[] = [];
  const text = ocrText.replace(/\r/g, '');
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const cutIdx = allLines.findIndex((l) => /прочие\s+услови|данные\s+транспортн|адреса\s+и\s+реквизит/i.test(l));
  const lines = cutIdx > 0 ? allLines.slice(0, cutIdx) : allLines;
  const region = lines.join('\n');

  // Дата документа из номера «№ 31072026/…» → 31.07.2026.
  const dn = region.match(/№\s*(\d{2})(\d{2})(\d{4})/);
  const documentDate = dn ? toIso(`${dn[1]}.${dn[2]}.${dn[3]}`) : null;
  if (!documentDate) warnings.push('Не удалось распознать дату документа (из номера заявки).');

  const clientInn = KUK_INN || null;
  if (!clientInn) warnings.push('ИНН заказчика «КУК СТУДИО» не задан (в документе его нет) — заполните KUK_INN, иначе заявки не создадутся.');

  // Тело — после «Условия перевозки», чтобы не захватить дату/номер договора из шапки
  // (напр. «№ 30-11-25Т от 21.11.2025»).
  const bodyStart = lines.findIndex((l) => /услови[яй]\s+перевозки/i.test(l));
  const body = (bodyStart >= 0 ? lines.slice(bodyStart) : lines).join('\n');

  // Даты и (одиночные) времена по порядку: [0] — забор, далее — выгрузки.
  const dates = Array.from(body.matchAll(/\b(\d{2}\.\d{2}\.\d{4})\b/g)).map((m) => m[1]);
  const times = Array.from(body.matchAll(/\b(\d{1,2}:\d{2})\b/g)).map((m) => m[1]);
  const pickupDate = dates[0] ? toIso(dates[0]) : null;
  const pickupTimeFrom = times[0] ?? null;
  const deliveryDates = dates.slice(1);
  const deliveryTimes = times.slice(1);

  // Температура (обычно одна): «+2-+4» → COOLED. Требуем «+» после тире (иначе «30-11-25»).
  const tempM = body.match(/([+\-])\s*\d{1,2}\s*[-–]\s*\+\s*\d{1,2}/);
  const tempRegime: string | null = tempM ? (tempM[1] === '-' ? 'FROZEN' : 'COOLED') : null;

  // Стопы: грузополучатели «РЦ Х5 ГОРОД». Паллеты — «N европаллетомест» по порядку.
  const dests = Array.from(body.matchAll(/(РЦ\s+Х5\s+([А-ЯЁ][а-яё]+))/gi)).map((m) => ({ full: m[1].replace(/\s+/g, ' ').trim(), city: titleCity(m[2]) }));
  const pallets = Array.from(body.matchAll(/(\d+)\s*европаллетомест/gi)).map((m) => Number(m[1]));

  if (!dests.length) warnings.push('Не найдено ни одного получателя «РЦ Х5 …» — проверьте раскладку.');
  warnings.push('Вес по документу — «Согласно УПД» (в заявке числа нет), проставлен не будет. Точки должны совпасть с реестром Location (или алиасы).');

  const requests: ParsedRequestDraft[] = dests.map((d, i) => {
    const cargoLine: ParsedCargoLine = { rawName: `Продукты питания — ${d.full}`, city: d.city, orderNumbers: [], tempRegime, pallets: pallets[i] ?? null, weightKg: null };
    return {
      city: d.city,
      destinationName: d.full,
      deliveryDate: deliveryDates[i] ? toIso(deliveryDates[i]) : (deliveryDates[0] ? toIso(deliveryDates[0]) : null),
      deliveryTimeFrom: deliveryTimes[i] ?? null,
      deliveryTimeTo: null,
      pickupDate,
      pickupTimeFrom,
      pickupTimeTo: null,
      pickupName: 'КУК СТУДИО (Томилино)',
      pallets: pallets[i] ?? 0,
      weightKg: null,
      tempRegime,
      cargoLines: [cargoLine],
      notes: `Груз: Продукты питания; ${pallets[i] ?? '?'} пал; вес по УПД`,
    };
  });

  return { clientInn, clientName: 'КУК СТУДИО', documentDate, requests, warnings };
}
