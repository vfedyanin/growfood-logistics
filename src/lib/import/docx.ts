// Извлечение текста из .docx (Word) для импорта заявок. Даёт предсказуемый
// линейный текст (аналогично OCR PDF), поэтому парсеры работают одинаково с
// обоими источниками. Библиотека mammoth — чистый JS, собирается на Vercel.
import mammoth from 'mammoth';

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  // Схлопываем пустые строки и тримим — компактный линейный текст.
  return value.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}
