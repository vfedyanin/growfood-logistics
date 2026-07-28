// OCR PDF → текст. PDF рендерится в PNG (pdf-to-png-converter → @napi-rs/canvas),
// затем распознаётся Tesseract.js (рус). Скан-документы (без текстового слоя).
import { pdfToPng } from 'pdf-to-png-converter';
import { createWorker } from 'tesseract.js';
import * as canvasNapi from '@napi-rs/canvas';

// viewportScale 3.0 ≈ 300 DPI — баланс точности OCR и памяти/времени.
const VIEWPORT_SCALE = 3.0;

// pdfjs (внутри pdf-to-png-converter) при рендере использует DOM-глобалы (DOMMatrix и др.),
// которых нет в Node/serverless-рантайме Vercel («DOMMatrix is not defined»). Полифиллим из
// @napi-rs/canvas до рендера. Локально в чистом Node подхватывалось иначе, в бандле Next — нет.
function ensureDomGlobals() {
  const g = globalThis as any;
  for (const key of ['DOMMatrix', 'Path2D', 'ImageData', 'DOMPoint', 'DOMRect'] as const) {
    if (typeof g[key] === 'undefined' && (canvasNapi as any)[key]) g[key] = (canvasNapi as any)[key];
  }
}

export async function ocrPdf(pdfBuffer: Buffer): Promise<string> {
  ensureDomGlobals();
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
