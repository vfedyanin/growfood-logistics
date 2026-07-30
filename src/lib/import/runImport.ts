// Полный конвейер импорта: файл → текст (OCR PDF или извлечение docx) → парсер по
// ключу → создание заявок.
import { ocrPdf } from './ocr';
import { extractDocxText } from './docx';
import { getParser } from './parsers';
import { createRequestsFromParsed, type ImportResult } from './createRequests';

export type RunImportResult = ImportResult & { ocrChars: number; parserKey: string };

// Общая часть: текст → парсер → заявки. ocrChars = длина текста (для лога).
async function importFromText(
  text: string,
  parserKey: string,
  opts: { dryRun?: boolean; systemActorId?: string | null },
): Promise<RunImportResult> {
  const parser = getParser(parserKey);
  if (!parser) {
    return { parserKey, ocrChars: 0, created: [], skipped: [], errors: [`Парсер «${parserKey}» не зарегистрирован`], warnings: [] };
  }
  const parsed = parser(text);
  const result = await createRequestsFromParsed(parsed, opts);
  return { ...result, parserKey, ocrChars: text.length };
}

// Итоговый статус прогона для лога.
export function importStatus(r: ImportResult): 'SUCCESS' | 'PARTIAL' | 'EMPTY' | 'ERROR' {
  const created = r.created.length;
  const hasErrors = r.errors.length > 0;
  if (created > 0 && hasErrors) return 'PARTIAL';
  if (created > 0) return 'SUCCESS';
  if (hasErrors) return 'ERROR';
  return 'EMPTY';
}

export async function importPdf(
  pdfBuffer: Buffer,
  parserKey: string,
  opts: { dryRun?: boolean; systemActorId?: string | null } = {},
): Promise<RunImportResult> {
  const text = await ocrPdf(pdfBuffer);
  return importFromText(text, parserKey, opts);
}

// Импорт из .docx: извлекаем текст (mammoth) → тот же парсер, что и для PDF.
export async function importDocx(
  docxBuffer: Buffer,
  parserKey: string,
  opts: { dryRun?: boolean; systemActorId?: string | null } = {},
): Promise<RunImportResult> {
  const text = await extractDocxText(docxBuffer);
  return importFromText(text, parserKey, opts);
}

// Диспетчер по типу файла (расширение/mime). Возвращает null для неизвестного типа.
export function isDocx(filename: string, mime?: string): boolean {
  return /\.docx$/i.test(filename) || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}
