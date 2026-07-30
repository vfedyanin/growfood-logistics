// Правила разбивки файла на заявки и заполнения сторон/плеч — по контрагенту.
// Читается createRequests.ts на этапе создания заявок (Задача 4).
//
// Ключ верхнего уровня = Customer.parserKey (тот же, что в PARSERS в parsers/index.ts).

// ─────────────────────────────────────────────────────────────────────────────
// ТИПЫ
// ─────────────────────────────────────────────────────────────────────────────

// Как определяется сторона заявки.
export type PartyRule =
  | { mode: 'contractor' }                    // = контрагент, от которого пришло письмо
  | { mode: 'fixed'; customerCode: string }   // всегда конкретный контрагент
  | { mode: 'byBrand' }                       // из бренда в строке груза, через brandMap
  | { mode: 'byDestination' }                 // владелец точки доставки
  | { mode: 'none' };

// Точка, которая известна не однозначно: маршрут может идти через одну из нескольких.
// Пока правило выбора не задано, заявка НЕ создаётся автоматически как готовая —
// см. requiresReview ниже.
export type LocationChoice = {
  oneOf: string[];                                   // коды Location, из которых выбирается
  resolveBy: 'MANUAL' | 'SCHEDULE' | 'TEMP_REGIME';  // чем определяется выбор
  note?: string;
};

export type LocationRef = string | LocationChoice;

// Одно плечо маршрута. $PICKUP и $DESTINATION подставляются на лету.
// directionCode — код Direction (таблица Route). Через него плечо цепляется к тарифу,
// поэтому неверно выбранная точка = неверная цена плеча.
export type LegRule = { from: LocationRef; to: LocationRef; directionCode?: string };

export type ImportRule = {
  // Что считать отдельной заявкой. Сейчас в коде жёстко ['city'].
  splitBy: ('city' | 'brand')[];

  pickupLocationCode: string;

  parties: {
    customer: PartyRule;
    payer: PartyRule;
    shipper: PartyRule;
    consignee: PartyRule;
  };

  // Бренд из ParsedCargoLine.rawName → код контрагента в справочнике Customer.
  brandMap?: Record<string, string>;

  // Плечи. Ключ — город назначения, '*' — по умолчанию. Порядок в массиве = legOrder.
  legs: Record<string, LegRule[]>;

  // Если true — заявка создаётся, но помечается как требующая проверки оператором.
  // Ставить, пока в правиле остаются LocationChoice или неподтверждённый плательщик.
  requiresReview?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// КОДЫ ТОЧЕК (Location.code) — сверено со справочником от 30.07.2026
// ─────────────────────────────────────────────────────────────────────────────

const LOC = {
  KV_PROIZVODSTVO: 'LOC-KV',          // Королевский Вкус (произв.), Королёв, Космонавта Стрекалова 49
  RC_MSK_BIRYULEVO: 'LOC-MSK-SOUTH',  // РЦ МСК (Бирюлёво), Ступинский пр-д 1А стр 1 — OWN
  KD_MSK_SEVER: 'LOC-MSK-NORTH',      // КД Север (Москва), Северянинский пр-д 1 стр 4 — OWN
  KD_KAZAN: 'LOC-KZN-CD',             // КД Казань, Васильченко 20Д — PARTNER

  // ??? СВЕРИТЬ: в справочнике LOC-POLYANA — «ул. Докукина, д. 10с11»,
  // а в PDF от 29.07.2026 адрес погрузки «ул. Красная Сосна, д. 30, с. 1».
  // Это разные адреса. Либо у Поляны две площадки, либо справочник устарел.
  POLYANA_MSK: 'LOC-POLYANA',
};

// Первое плечо КВ: Москва, но какая из двух точек — зависит от условий,
// которые пока не формализованы. Не выбирать молча: выбор меняет Direction,
// Direction тянет тариф, тариф — цену плеча.
const MSK_HUB: LocationChoice = {
  oneOf: [LOC.RC_MSK_BIRYULEVO, LOC.KD_MSK_SEVER],
  resolveBy: 'MANUAL',
  note: 'РЦ Бирюлёво или КД Север. Правило выбора не определено — требует подтверждения оператором.',
};

// ─────────────────────────────────────────────────────────────────────────────
// ВАРИАНТЫ ПРАВИЛА ПЛАТЕЛЬЩИКА (КВ) — выбрать один, остальные оставить для сверки
// ─────────────────────────────────────────────────────────────────────────────

export const KV_PAYER_VARIANTS = {
  // A. Платит контрагент-отправитель письма (текущее поведение кода: payerId = customerId).
  //    Юнит-экономика: вся выручка по файлу падает на одно юрлицо.
  A_CONTRACTOR: { mode: 'contractor' } as PartyRule,

  // B. Каждое юрлицо платит за свой груз. Требует splitBy: ['city','brand'].
  //    Юнит-экономика: выручка разносится по трём юрлицам. Наиболее вероятный вариант,
  //    если с каждым заключён отдельный договор.
  B_BY_BRAND: { mode: 'byBrand' } as PartyRule,

  // C. Платит одно фиксированное юрлицо за всех, независимо от бренда груза.
  //    Заполнить код, если такой договор есть.
  C_FIXED: { mode: 'fixed', customerCode: 'KV' } as PartyRule,
};

// ─────────────────────────────────────────────────────────────────────────────
// ПРАВИЛА
// ─────────────────────────────────────────────────────────────────────────────

export const IMPORT_RULES: Record<string, ImportRule> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ПОЛЯНА — по реальному PDF от 29.07.2026. Один файл = одна заявка, прямое плечо.
  // ═══════════════════════════════════════════════════════════════════════════
  'polyana': {
    splitBy: ['city'],
    pickupLocationCode: LOC.POLYANA_MSK,
    parties: {
      customer: { mode: 'contractor' },
      payer: { mode: 'contractor' },
      shipper: { mode: 'contractor' },
      consignee: { mode: 'byDestination' },
    },
    legs: {
      '*': [{ from: '$PICKUP', to: '$DESTINATION' }],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // КОРОЛЕВСКИЙ ВКУС
  // Маршрут: производство → Москва (РЦ Бирюлёво ИЛИ КД Север) → КД Казань → город.
  // Три юрлица-грузоотправителя, каждое возит в каждый город.
  // ═══════════════════════════════════════════════════════════════════════════
  'korolevsky-vkus': {
    // Три юрлица подтверждены → разделять надо и по бренду, иначе в одной заявке
    // окажутся грузы разных юрлиц и разнести плательщика будет некуда.
    splitBy: ['city', 'brand'],

    pickupLocationCode: LOC.KV_PROIZVODSTVO,

    parties: {
      customer: { mode: 'contractor' },
      payer: KV_PAYER_VARIANTS.B_BY_BRAND,  // ← ПЕРЕКЛЮЧАТЬ ЗДЕСЬ
      shipper: { mode: 'byBrand' },         // грузоотправитель = юрлицо бренда, подтверждено
      consignee: { mode: 'byDestination' },
    },

    // Бренд из ParsedCargoLine.rawName → Customer.code.
    // ВНИМАНИЕ: «Перспективы» в справочнике контрагентов НЕТ. Её нужно завести
    // до запуска импорта, иначе грузы этого юрлица не разнесутся.
    brandMap: {
      'ресторан дома': 'RD',              // Ресторан Дома
      'королевский вкус': 'KV',           // КОРОЛЕВСКИЙ ВКУС
      'перспектива': '???НЕТ_В_СПРАВОЧНИКЕ',
    },

    // Точки назначения резолвятся по имени «Самокат ГОРОД» через locationResolver:
    // Уфа → LOC-UFA, Самара → LOC-SMR, Ижевск → LOC-IZH, Казань → LOC-KZN. Все PARTNER.
    legs: {
      'Уфа': [
        { from: '$PICKUP', to: MSK_HUB },
        { from: MSK_HUB, to: LOC.KD_KAZAN },
        { from: LOC.KD_KAZAN, to: '$DESTINATION' },
      ],
      'Самара': [
        { from: '$PICKUP', to: MSK_HUB },
        { from: MSK_HUB, to: LOC.KD_KAZAN },
        { from: LOC.KD_KAZAN, to: '$DESTINATION' },
      ],
      'Ижевск': [
        { from: '$PICKUP', to: MSK_HUB },
        { from: MSK_HUB, to: LOC.KD_KAZAN },
        { from: LOC.KD_KAZAN, to: '$DESTINATION' },
      ],

      // ??? ПРОВЕРИТЬ. КД Казань (LOC-KZN-CD, Васильченко 20Д) и Самокат Казань
      // (LOC-KZN, Аграрная 2) — разные точки в одном городе, так что третье плечо
      // осмысленно. Подтвердить, что груз действительно идёт через КД, а не напрямую.
      'Казань': [
        { from: '$PICKUP', to: MSK_HUB },
        { from: MSK_HUB, to: LOC.KD_KAZAN },
        { from: LOC.KD_KAZAN, to: '$DESTINATION' },
      ],
    },

    // Пока не определены правило выбора московской точки и плательщик —
    // заявки создаются, но требуют подтверждения оператором.
    requiresReview: true,
  },
};

export function getImportRule(parserKey: string | null | undefined): ImportRule | null {
  if (!parserKey) return null;
  return IMPORT_RULES[parserKey] ?? null;
}
