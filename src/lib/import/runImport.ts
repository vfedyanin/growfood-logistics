// Полный конвейер импорта: PDF-буфер → OCR → парсер по ключу → создание заявок.
import { ocrPdf } from './ocr';
import { getParser } from './parsers';
import { createRequestsFromParsed, type ImportResult } from './createRequests';

export type RunImportResult = ImportResult & { ocrChars: number; parserKey: string };

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
