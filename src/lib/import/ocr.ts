// OCR PDF → текст. PDF рендерится в PNG (pdf-to-png-converter → @napi-rs/canvas),
// затем распознаётся Tesseract.js (рус). Скан-документы (без текстового слоя).
import { pdfToPng } from 'pdf-to-png-converter';
import { createWorker } from 'tesseract.js';
import * as canvasNapi from '@napi-rs/canvas';
import { createRequire } from 'node:module';

// viewportScale 3.0 ≈ 300 DPI — баланс точности OCR и памяти/времени.
const VIEWPORT_SCALE = 3.0;

// pdfjs (внутри pdf-to-png-converter) грузит свой worker динамическим import относительно
// pdf.mjs — трейсинг Next этот путь не видит, на Vercel «Cannot find module pdf.worker.mjs».
// Задаём GlobalWorkerOptions.workerSrc через СТАТИЧЕСКИЙ require.resolve: это (а) включает файл
// в трейс той же функции, что делает OCR, и (б) даёт корректный абсолютный путь в рантайме.
// pdf.mjs — ESM-синглтон, поэтому instance тот же, что использует pdf-to-png-converter.
let pdfWorkerReady = false;
async function ensurePdfWorker() {
  if (pdfWorkerReady) return;
  pdfWorkerReady = true;
  try {
    const req = createRequire(import.meta.url);
    const workerSrc = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (pdfjs?.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  } catch {
    // локально worker резолвится сам — не критично
  }
}

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
  await ensurePdfWorker();
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
