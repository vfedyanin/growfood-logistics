// Приём заказов из 1С («Заказы на производство», productionOrders) → плановые
// поставки на перевозку. Здесь ТОЛЬКО чистый трансформ (без БД и без сети): вход —
// массив строк выгрузки 1С, выход — сгруппированные поставки с посчитанными
// паллетами и определённым производителем. Запись в заявки и HTTP-забор —
// отдельно (см. src/lib/actions/ingest1c.ts), чтобы логику можно было гонять и
// проверять на файлах-образцах.
//
// Решения (согласованы с заказчиком, см. память 07–16.09):
//  • Берём только заказы, чей СкладGUID в белом списке (15 РЦ Магнит/Дикси/ВВ + Фудмайлз).
//    Всё прочее — молча мимо (Екатеринбург/Урал, Тандер-магазины, циферные Дикси).
//  • Производитель — по ЦФОДоговора (центр ответственности = фактическое производство:
//    Бирюлёво/Приём/Фудхолдинг/Цех Сэндвичей), фолбэк на карту договоров для старых данных.
//  • Поставка = СкладGUID + ДатаОтгрузкиНаРЦ + производитель (ЦФО); договоры одного
//    производителя сливаются в одну заявку.
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
  // Добавлены 1С 16.09 для определения производителя. ЦФОДоговора = центр
  // финансовой ответственности = фактическое производство (надёжнее названия договора).
  ЦФОДоговора?: string;
  ЦФОДоговораGUID?: string;
  ПроектДоговора?: string;
  ПроектДоговораGUID?: string;
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
  { prefix: 'cbc89be6', direction: 'MSK-FMILES', rc: 'Склад Фудмайлз' },
];

// Производитель-отправитель. Определяется по ЦФОДоговора (центр финансовой
// ответственности = фактическое производство), с фолбэком на старую карту
// договоров для данных без ЦФО. Ключи разрешаются в конкретного Customer в
// серверном модуле.
//  • BIRYULEVO / PRIEM / FUDHOLDING / SENDWICH — наши производства, идут в заявки.
//  • SKIP — вне периметра (Екатеринбург/Урал и пр.) — поставка пропускается.
export type ProducerKey = 'BIRYULEVO' | 'PRIEM' | 'FUDHOLDING' | 'SENDWICH' | 'SKIP';

// ОСНОВНОЙ ключ: ЦФОДоговораGUID → производитель (получено 16.09 из выгрузки с
// новыми полями). Полные GUID, сверять по началу строки.
export const CFO_TO_PRODUCER: { prefix: string; producer: ProducerKey; note?: string }[] = [
  { prefix: '46499874', producer: 'BIRYULEVO', note: 'Собственное_производство_Бирюлево' },
  { prefix: 'cf27f42b', producer: 'PRIEM', note: 'Собственное_производство_Прием' },
  { prefix: 'e1ec8187', producer: 'FUDHOLDING', note: 'Собственное_производство_Фудхолдинг' },
  { prefix: '776f3588', producer: 'SENDWICH', note: 'Собственное производство_Цех Сэндвичей' },
  // Урал — вне периметра:
  { prefix: '5aaf9e29', producer: 'SKIP', note: 'Собственное_производство_Екатеринбург (Урал)' },
];

// ЦФО по слову — фолбэк, если GUID незнаком, но текст ЦФО заполнен.
function producerFromCfoName(cfo: string): ProducerKey | null {
  const s = (cfo || '').toLowerCase();
  if (s.includes('екатеринбург')) return 'SKIP';
  if (s.includes('сэндвич') || s.includes('сендвич') || s.includes('цех')) return 'SENDWICH';
  if (s.includes('фудхолдинг')) return 'FUDHOLDING';
  if (s.includes('прием') || s.includes('приём')) return 'PRIEM';
  if (s.includes('бирюлево') || s.includes('бирюлёво')) return 'BIRYULEVO';
  return null;
}

// СТАРЫЙ фолбэк по ДоговорGUID — для данных БЕЗ ЦФО (до 16.09). НЕ содержит 7d384066
// (по ЦФО он оказался Цех Сэндвичей, а не Фудхолдинг — договор врал названием).
export const DOGOVOR_TO_PRODUCER: { prefix: string; producer: ProducerKey; note?: string }[] = [
  { prefix: '7508df62', producer: 'BIRYULEVO' },
  { prefix: '97c20ca5', producer: 'PRIEM' },
  { prefix: '26a8847d', producer: 'PRIEM' }, { prefix: '43172e41', producer: 'PRIEM' },
  { prefix: '97123d64', producer: 'PRIEM' }, { prefix: '30379a8a', producer: 'PRIEM' },
  { prefix: '56c8fab2', producer: 'PRIEM' }, { prefix: '704e245c', producer: 'PRIEM' },
  { prefix: '3a688efd', producer: 'PRIEM' }, { prefix: 'f855d49e', producer: 'PRIEM' },
  { prefix: '0c13fe6e', producer: 'PRIEM' }, { prefix: '1001ec6f', producer: 'PRIEM' },
  { prefix: 'e8f153ed', producer: 'BIRYULEVO' }, { prefix: '237c730d', producer: 'BIRYULEVO' },
  { prefix: 'dde0e3a5', producer: 'SKIP', note: 'Студия Вкуса' },
  { prefix: 'eb8389c2', producer: 'SKIP', note: 'Студия Вкуса' },
];

/** Производитель заказа: ЦФОДоговораGUID → ЦФО-текст → карта договоров → SKIP. */
export function producerForOrder(r: OrderRow): ProducerKey {
  const cfoG = r.ЦФОДоговораGUID ?? '';
  const byCfoGuid = CFO_TO_PRODUCER.find((c) => cfoG.startsWith(c.prefix));
  if (byCfoGuid) return byCfoGuid.producer;
  const byCfoName = producerFromCfoName(r.ЦФОДоговора ?? '');
  if (byCfoName) return byCfoName;
  const g = r.ДоговорGUID ?? '';
  const byDog = DOGOVOR_TO_PRODUCER.find((d) => g.startsWith(d.prefix));
  return byDog ? byDog.producer : 'SKIP';
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
  key: string;                 // СкладGUID|дата|ЦФОДоговораGUID — ключ поставки = РЦ+дата+производитель (externalKey без префикса)
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
    // Поставка = РЦ + дата + ПРОИЗВОДИТЕЛЬ. Дискриминатор — ЦФОДоговораGUID (все
    // договоры одного производителя сливаются в одну заявку); для старых данных
    // без ЦФО — ДоговорGUID.
    const producerKey = r.ЦФОДоговораGUID || r.ДоговорGUID;
    const key = `${r.СкладGUID}|${delivery}|${producerKey}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, direction: dir.direction, rc: dir.rc, deliveryDate: delivery,
        dogovorGuid: r.ДоговорGUID, dogovor: r.ЦФОДоговора || r.Договор,
        producer: producerForOrder(r),
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
