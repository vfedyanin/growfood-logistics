// OCR PDF → текст через Google Cloud Vision (files:annotate, DOCUMENT_TEXT_DETECTION).
// Vision распознаёт PDF напрямую — не нужен рендер PDF→PNG и локальный OCR-движок.
// Ключ: env GOOGLE_VISION_API_KEY (API key проекта Google Cloud с включённым Vision API).

const VISION_URL = 'https://vision.googleapis.com/v1/files:annotate';
const MAX_ATTEMPTS = 3; // сетевой сбой (запрос не дошёл): повторяем с нарастающей паузой

// POST в Vision с повтором ТОЛЬКО при сетевой ошибке (fetch бросил исключение —
// запрос не дошёл до Google). HTTP-ответы (в т.ч. 4xx/5xx) не ретраим — их разбирает вызывающий.
async function postVision(apiKey: string, body: unknown): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetch(`${VISION_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 700 * 2 ** (attempt - 1)));
    }
  }
  const cause = (lastErr as any)?.cause?.code || (lastErr as any)?.message || String(lastErr);
  throw new Error(`Google Vision: не удалось соединиться после ${MAX_ATTEMPTS} попыток (сетевой сбой: ${cause}). Проверьте доступ к googleapis.com.`);
}

export async function ocrPdf(pdfBuffer: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new Error('OCR не настроен: не задан GOOGLE_VISION_API_KEY');

  const body = {
    requests: [
      {
        inputConfig: { mimeType: 'application/pdf', content: pdfBuffer.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      },
    ],
  };

  const res = await postVision(apiKey, body);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Google Vision ${res.status}: ${t.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const fileResp = json?.responses?.[0];
  if (fileResp?.error) throw new Error(`Google Vision: ${fileResp.error.message || 'ошибка распознавания'}`);

  // files:annotate возвращает по-страничные ответы в responses[0].responses[]
  const pages: any[] = fileResp?.responses || [];
  return pages.map((p) => p?.fullTextAnnotation?.text || '').join('\n');
}
