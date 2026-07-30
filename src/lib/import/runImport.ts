// Полный конвейер импорта: PDF-буфер → OCR → парсер по ключу → создание заявок.
import { ocrPdf } from './ocr';
import { getParser } from './parsers';
import { createRequestsFromParsed, type ImportResult } from './createRequests';

export type RunImportResult = ImportResult & { ocrChars: number; parserKey: string };

// Итоговый статус прогона для лога.
export function importStatus(r: ImportResult): 'SUCCESS' | 'PARTIAL' | 'EMPTY' | 'DUPLICATES' | 'ERROR' {
  const created = r.created.length;
  const hasErrors = r.errors.length > 0;
  if (created > 0 && hasErrors) return 'PARTIAL';
  if (created > 0) return 'SUCCESS';
  if (hasErrors) return 'ERROR';
  if (r.skipped.length > 0) return 'DUPLICATES'; // заявки были, но все — дубли/пропуски
  return 'EMPTY';
}

export async function importPdf(
  pdfBuffer: Buffer,
  parserKey: string,
  opts: { dryRun?: boolean; systemActorId?: string | null } = {},
): Promise<RunImportResult> {
  const parser = getParser(parserKey);
  if (!parser) {
    return { parserKey, ocrChars: 0, created: [], skipped: [], errors: [`Парсер «${parserKey}» не зарегистрирован`], warnings: [] };
  }
  const text = await ocrPdf(pdfBuffer);
  const parsed = parser(text);
  const result = await createRequestsFromParsed(parsed, opts);
  return { ...result, parserKey, ocrChars: text.length };
}
