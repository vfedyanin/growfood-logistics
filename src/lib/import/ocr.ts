// OCR PDF → текст. PDF рендерится в PNG (pdf-to-png-converter → @napi-rs/canvas),
// затем распознаётся Tesseract.js (рус). Скан-документы (без текстового слоя).
import { pdfToPng } from 'pdf-to-png-converter';
import { createWorker } from 'tesseract.js';

// viewportScale 3.0 ≈ 300 DPI — баланс точности OCR и памяти/времени.
const VIEWPORT_SCALE = 3.0;

export async function ocrPdf(pdfBuffer: Buffer): Promise<string> {
  const pages = await pdfToPng(pdfBuffer, { viewportScale: VIEWPORT_SCALE });
  // langPath/cachePath через env — чтобы на Vercel бандлить rus.traineddata локально,
  // а не тянуть с CDN в рантайме (по умолчанию tesseract.js грузит с CDN).
  const worker = await createWorker('rus', 1, {
    langPath: process.env.TESSERACT_LANG_PATH || undefined,
    cachePath: process.env.TESSERACT_CACHE_PATH || undefined,
  });
  try {
    let text = '';
    for (const page of pages) {
      if (!page.content) continue;
      const { data } = await worker.recognize(page.content);
      text += data.text + '\n';
    }
    return text;
  } finally {
    await worker.terminate();
  }
}
