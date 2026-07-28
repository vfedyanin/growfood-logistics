// Типы для импорта заявок из писем (PDF). Общие для парсеров, OCR и создателя заявок.

// Одна строка груза из PDF (бренд + «Самокат ГОРОД» + № заказа + вес + паллеты).
export type ParsedCargoLine = {
  rawName: string;            // как в документе: «Королевский Вкус, Самокат КАЗАНЬ»
  city: string;              // нормализованный город: «Казань»
  orderNumbers: string[];    // № заказа (УПД), напр. ['5988','5989']
  tempRegime?: string | null; // 'COOLED' | 'FROZEN' | 'AMBIENT'
  pallets?: number | null;
  weightKg?: number | null;
};

// Черновик одной заявки (по направлению/городу). Грузы города сливаются при создании.
export type ParsedRequestDraft = {
  city: string;                    // город назначения (норм.)
  destinationName: string;         // целевое имя точки: «Самокат Казань»
  deliveryDate?: string | null;    // ISO
  deliveryTimeFrom?: string | null; // 'HH:mm'
  deliveryTimeTo?: string | null;
  pickupDate?: string | null;      // ISO
  pickupTimeFrom?: string | null;
  pickupTimeTo?: string | null;
  pickupName: string;              // целевое имя точки забора: «Королевский Вкус (произв.)»
  pallets: number;                 // сумма паллет города
  weightKg?: number | null;        // сумма веса города
  tempRegime?: string | null;
  cargoLines: ParsedCargoLine[];
  notes: string;                   // бренды + № заказов
};

// Результат парсинга одного PDF.
export type ParsedImport = {
  clientInn?: string | null;
  clientName?: string | null;
  documentDate?: string | null;    // ISO — дата документа
  requests: ParsedRequestDraft[];  // одна на город назначения
  warnings: string[];              // предупреждения парсинга/OCR (в лог)
};

export type ParserFn = (ocrText: string) => ParsedImport;
