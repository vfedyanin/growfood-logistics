// OCR PDF → текст через Google Cloud Vision (files:annotate, DOCUMENT_TEXT_DETECTION).
// Vision распознаёт PDF напрямую — не нужен рендер PDF→PNG и локальный OCR-движок.
// Ключ: env GOOGLE_VISION_API_KEY (API key проекта Google Cloud с включённым Vision API).

const VISION_URL = 'https://vision.googleapis.com/v1/files:annotate';

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

  const res = await fetch(`${VISION_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
