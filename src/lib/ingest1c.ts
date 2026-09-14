// Приём заказов из 1С («Заказы на производство», productionOrders) → плановые
// поставки на перевозку. Здесь ТОЛЬКО чистый трансформ (без БД и без сети): вход —
// массив строк выгрузки 1С, выход — сгруппированные поставки с посчитанными
// паллетами и определённым производителем. Запись в заявки и HTTP-забор —
// отдельно (см. src/lib/actions/ingest1c.ts), чтобы логику можно было гонять и
// проверять на файлах-образцах.
//
// Решения (согласованы с заказчиком, см. память 07–14.09):
//  • Берём только заказы, чей СкладGUID в белом списке (15 точек Магнит/Дикси/ВВ).
//    Всё прочее — молча мимо (хаб-производство, Урал, циферные Дикси).
//  • Поставка = СкладGUID + ДатаОтгрузкиНаРЦ + ДоговорGUID (дробим по производителю:
//    1 Договор = 1 производитель).
//  • Идемпотентность — по ключу поставки (externalKey), см. серверный модуль.
//  • Паллеты = ceil( Σ по строкам ( Количество / НоменклатураКвант /
//    НоменклатураКоличествоНаПаллете ) ); пусто/0 в квант/напаллете → 1.
//    Проверено на боевых: Воронеж 09.09 = 24 (реально ехало 26). Построчный
//    ceil (Σ ceil) даёт ~в 1.5 раза больше и не годится.
//  • ДатаОтгрузкиНаРЦ = дата ВЫГРУЗКИ на РЦ. День забора (ячейка планирования)
//    считается уже в серверном модуле = дата выгрузки − смещение выгрузки шаблона.
//    Отдельной таблицы транзита здесь НЕТ — транзит зашит в шаблон заявки.

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
// при подключении к БД направление разрешается по коду (Route.code).
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

// Производитель-отправитель. Определяется по ДоговорGUID (1 Договор = 1
// производитель). Ключи разрешаются в конкретного Customer в серверном модуле.
//  • BIRYULEVO / PRIEM / FUDHOLDING — наши производства, идут в заявки.
//  • SKIP — производитель вне периметра (Студия Вкуса не существует, Сендвич-Цех
//    ещё не заведён) либо спорный без ответа заказчика — поставка пропускается.
export type ProducerKey = 'BIRYULEVO' | 'PRIEM' | 'FUDHOLDING' | 'SKIP';

// Явная карта ДоговорGUID → производитель (из разбора выгрузки 04–14.09).
// Префиксы GUID достаточно уникальны в периметре; сверять по началу строки.
export const DOGOVOR_TO_PRODUCER: { prefix: string; producer: ProducerKey; note?: string }[] = [
  { prefix: '7508df62', producer: 'BIRYULEVO', note: 'Завод Бирюлёво' },
  { prefix: '7d384066', producer: 'FUDHOLDING', note: 'ГФ Фудхолдинг' },
  { prefix: '97c20ca5', producer: 'PRIEM', note: 'Дикси_Прием' },
  // 10 договоров «Магнит_РЦ_Прием» → Завод Приём
  { prefix: '26a8847d', producer: 'PRIEM' },
  { prefix: '43172e41', producer: 'PRIEM' },
  { prefix: '97123d64', producer: 'PRIEM' },
  { prefix: '30379a8a', producer: 'PRIEM' },
  { prefix: '56c8fab2', producer: 'PRIEM' },
  { prefix: '704e245c', producer: 'PRIEM' },
  { prefix: '3a688efd', producer: 'PRIEM' },
  { prefix: 'f855d49e', producer: 'PRIEM' },
  { prefix: '0c13fe6e', producer: 'PRIEM' },
  { prefix: '1001ec6f', producer: 'PRIEM' },
  // спорные, разрешённые по контексту (см. память):
  { prefix: 'e8f153ed', producer: 'BIRYULEVO', note: 'Дикси, товар «Завод Бирюлёво»' },
  { prefix: '237c730d', producer: 'BIRYULEVO', note: 'ВВ, «ВВ Завод Бирюлёво»' },
  // Студия Вкуса — не существует, пропускаем:
  { prefix: 'dde0e3a5', producer: 'SKIP', note: 'Студия Вкуса (не существует)' },
  { prefix: 'eb8389c2', producer: 'SKIP', note: 'Студия Вкуса (не существует)' },
  // РЕАЛЬНО спорный, ждёт ответа заказчика (кто производитель) — пока пропускаем:
  { prefix: '9da53048', producer: 'SKIP', note: 'ГК/30738/24 — производитель не подтверждён' },
];

// Суффикс проекта в названии договора → производитель (fallback, если GUID не в
// карте). В названии зашито «Магнит_РЦ_Бирюлево / _Прием / _Фудхолдинг».
function producerFromName(dogovor: string): ProducerKey | null {
  const s = (dogovor || '').toLowerCase();
  if (s.includes('фудхолдинг')) return 'FUDHOLDING';
  if (s.includes('_прием') || s.includes('_приём') || s.includes(' прием') || s.includes(' приём')) return 'PRIEM';
  if (s.includes('бирюлево') || s.includes('бирюлёво')) return 'BIRYULEVO';
  return null;
}

export function producerForDogovor(dogovorGuid: string | undefined, dogovorName: string | undefined): ProducerKey {
  const g = dogovorGuid ?? '';
  const hit = DOGOVOR_TO_PRODUCER.find((d) => g.startsWith(d.prefix));
  if (hit) return hit.producer;
  return producerFromName(dogovorName ?? '') ?? 'SKIP';
}

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
  key: string;                 // СкладGUID|дата|ДоговорGUID — ключ поставки (externalKey без префикса)
  direction: string;          // код направления (Route.code)
  rc: string;
  deliveryDate: string;        // YYYY-MM-DD, ДатаОтгрузкиНаРЦ (выгрузка на РЦ)
  dogovorGuid: string;
  dogovor: string;
  producer: ProducerKey;       // отправитель-производитель
  sourceOrderGuids: string[];  // СсылкаGUID заказов, слитых в поставку
  lines: number;
  pallets: number;             // ceil(Σ дробных) по всей поставке
  fractional: number;
};

const isoDate = (s: string) => (s || '').slice(0, 10);

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
        dogovorGuid: r.ДоговорGUID, dogovor: r.Договор,
        producer: producerForDogovor(r.ДоговорGUID, r.Договор),
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
