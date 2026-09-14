// Приём заказов из 1С («Заказы на производство», productionOrders) → плановые
// заявки на перевозку. Здесь ТОЛЬКО чистый трансформ (без БД и без сети): вход —
// массив строк выгрузки 1С, выход — сгруппированные поставки с посчитанными
// паллетами. Запись в заявки и HTTP-забор — отдельно (не в этом модуле), чтобы
// логику можно было гонять и проверять на файлах-образцах.
//
// Решения (согласованы с заказчиком, см. память 07–14.09):
//  • Берём только заказы, чей СкладGUID в белом списке (15 точек Магнит/Дикси/ВВ).
//    Всё прочее — молча мимо (хаб-производство, Урал, циферные Дикси).
//  • Поставка = СкладGUID + ДатаОтгрузкиНаРЦ + ДоговорGUID (дробим по производителю).
//  • Идемпотентность — по СсылкаGUID (ключ заказа).
//  • Паллеты = ceil( Σ по строкам ( Количество / НоменклатураКвант /
//    НоменклатураКоличествоНаПаллете ) ); пусто/0 в квант/напаллете → 1.
//    Проверено на боевых: Воронеж 09.09 = 24 (реально ехало 26). Построчный
//    ceil (Σ ceil) даёт ~в 1.5 раза больше и не годится.
//  • ДатаОтгрузкиНаРЦ = дата ВЫГРУЗКИ на РЦ; забор = выгрузка − транзит направления.

export type OrderRow = {
  СсылкаGUID: string;
  Номер: string;
  ДатаОтгрузкиНаРЦ: string;
  СкладGUID: string;
  Склад: string;
  ДоговорGUID: string;
  Договор: string;
  Номенклатура: string;
  Количество: number | string;
  НоменклатураКвант: number | string;
  НоменклатураКоличествоНаПаллете: number | string;
  Проведен?: boolean;
  ФиктивныйЗаказ?: boolean;
  Статус?: string;
};

// СкладGUID (префикс) → код нашего направления. Префиксы — из разбора выгрузки;
// при подключении к БД заменить на полные GUID и сверить с Location.
export const WAREHOUSE_TO_DIRECTION: { prefix: string; direction: string; rc: string }[] = [
  { prefix: 'f8bc5d11', direction: 'MSK-MG-VRN', rc: 'РЦ Магнит Воронеж' },
  { prefix: '1cd6e7f3', direction: 'MSK-MG-DMT', rc: 'РЦ Магнит Дмитров' },
  { prefix: '9ba28402', direction: 'MSK-MG-NGN', rc: 'РЦ Магнит Восток' },
  { prefix: 'd49bee3e', direction: 'MSK-MG-TUL', rc: 'РЦ Магнит Тула' },
  { prefix: '543a27f6', direction: 'MSK-MG-YAR', rc: 'РЦ Магнит Ярославль' },
  { prefix: 'b77a37f9', direction: 'MSK-MG-DZR', rc: 'РЦ Магнит Дзержинск' },
  { prefix: '82075e5a', direction: 'MSK-MG-IVN', rc: 'РЦ Магнит Иваново' },
  { prefix: 'ee2d1dbc', direction: 'MSK-MG-TMB', rc: 'РЦ Магнит Тамбов' },
  { prefix: '6fb45474', direction: 'SPB-MG-KLP', rc: 'РЦ Магнит Колпино' },
  { prefix: '8f577278', direction: 'MSK-DX-SEV', rc: 'РЦ Дикси Северный' },
  { prefix: 'e64af204', direction: 'MSK-DX-VNK', rc: 'РЦ Дикси Внуково' },
  { prefix: '06bef428', direction: 'MSK-DX-VSH', rc: 'РЦ Дикси Всходы' },
  { prefix: 'ef78fd48', direction: 'SPB-DX-SHR', rc: 'РЦ Дикси Шушары' },
  { prefix: 'ecd7a585', direction: 'MSK-VV-DMD', rc: 'РЦ ВкусВилл Домодедово' },
  { prefix: '0e709fee', direction: 'MSK-VV-VSH', rc: 'РЦ ВкусВилл Вешки' },
];

// Транзит (дней) выгрузка − забор. ПРОВИЗОРНО — при подключении к БД брать из
// смещений плеч направления/шаблона, а не из этой таблицы. Москва-точки — день-в-
// день, регионалка — ночь (−1), Питер — двое суток (−2).
const TRANSIT_DAYS: Record<string, number> = {
  'MSK-MG-DMT': 0, 'MSK-DX-SEV': 0, 'MSK-DX-VNK': 0, 'MSK-DX-VSH': 0,
  'MSK-VV-DMD': 0, 'MSK-VV-VSH': 0,
  'MSK-MG-VRN': 1, 'MSK-MG-NGN': 1, 'MSK-MG-TUL': 1, 'MSK-MG-YAR': 1,
  'MSK-MG-DZR': 1, 'MSK-MG-IVN': 1, 'MSK-MG-TMB': 1,
  'SPB-MG-KLP': 2, 'SPB-DX-SHR': 2,
};

const num = (x: unknown): number => {
  const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function directionForWarehouse(skladGuid: string | undefined) {
  const g = skladGuid ?? '';
  return WAREHOUSE_TO_DIRECTION.find((w) => g.startsWith(w.prefix)) ?? null;
}

/** Паллеты строки (дробно): Количество / Квант / КоличествоНаПаллете. */
export function fractionalPallets(r: OrderRow): number {
  const q = num(r.Количество);
  const kvant = num(r.НоменклатураКвант) || 1;
  const perPallet = num(r.НоменклатураКоличествоНаПаллете) || 1;
  return q / kvant / perPallet;
}

export type PlannedDelivery = {
  key: string;                 // СкладGUID|дата|ДоговорGUID — ключ поставки
  direction: string;
  rc: string;
  deliveryDate: string;        // YYYY-MM-DD, ДатаОтгрузкиНаРЦ (выгрузка на РЦ)
  pickupDate: string;          // deliveryDate − транзит (день забора с хаба)
  dogovorGuid: string;
  dogovor: string;
  sourceOrderGuids: string[];  // СсылкаGUID заказов, слитых в поставку (идемпотентность)
  lines: number;
  pallets: number;             // ceil(Σ дробных)
  fractional: number;
};

const isoDate = (s: string) => (s || '').slice(0, 10);
function shiftDate(iso: string, minusDays: number): string {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() - minusDays);
  return d.toISOString().slice(0, 10);
}

/** Главный трансформ: строки выгрузки 1С → плановые поставки. */
export function planFrom1c(rows: OrderRow[]): PlannedDelivery[] {
  const groups = new Map<string, PlannedDelivery & { _guids: Set<string> }>();
  for (const r of rows) {
    if (r.Проведен === false || r.ФиктивныйЗаказ === true) continue; // не в работе
    const dir = directionForWarehouse(r.СкладGUID);
    if (!dir) continue; // не наш склад — молча мимо
    const delivery = isoDate(r.ДатаОтгрузкиНаРЦ);
    if (!delivery) continue;
    const key = `${r.СкладGUID}|${delivery}|${r.ДоговорGUID}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, direction: dir.direction, rc: dir.rc, deliveryDate: delivery,
        pickupDate: shiftDate(delivery, TRANSIT_DAYS[dir.direction] ?? 1),
        dogovorGuid: r.ДоговорGUID, dogovor: r.Договор,
        sourceOrderGuids: [], lines: 0, pallets: 0, fractional: 0,
        _guids: new Set<string>(),
      };
      groups.set(key, g);
    }
    g.lines += 1;
    g.fractional += fractionalPallets(r);
    g._guids.add(r.СсылкаGUID);
  }
  const out: PlannedDelivery[] = [];
  for (const g of Array.from(groups.values())) {
    g.sourceOrderGuids = Array.from(g._guids);
    g.pallets = Math.ceil(g.fractional);
    const { _guids, ...clean } = g;
    out.push(clean);
  }
  return out.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.rc.localeCompare(b.rc));
}
