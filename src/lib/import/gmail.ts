// Клиент Gmail API (read-only). OAuth2 refresh-token из env почтового ящика hello@gf-log.ru.
// Ищет письма от заданного отправителя с PDF-вложениями после watermark-даты.
import { google } from 'googleapis';

export type PdfEmail = {
  messageId: string;
  subject: string;
  from: string;
  date: Date | null;
  pdfs: { filename: string; data: Buffer }[];
};

export function gmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
}

function gmailClient() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail не настроен: заданы не все GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN');
  }
  const oauth2 = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

// Письма от fromEmail с PDF-вложениями, полученные после afterDate (watermark).
export async function fetchPdfEmails(fromEmail: string, afterDate?: Date | null): Promise<PdfEmail[]> {
  const gmail = gmailClient();
  const q = [`from:${fromEmail}`, 'has:attachment', 'filename:pdf'];
  if (afterDate) q.push(`after:${Math.floor(afterDate.getTime() / 1000)}`);
  const list = await gmail.users.messages.list({ userId: 'me', q: q.join(' '), maxResults: 50 });
  const messages = list.data.messages || [];
  const result: PdfEmail[] = [];

  for (const m of messages) {
    if (!m.id) continue;
    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const headers = msg.data.payload?.headers || [];
    const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name)?.value || '';
    const dateMs = msg.data.internalDate ? Number(msg.data.internalDate) : null;

    const pdfs: { filename: string; data: Buffer }[] = [];
    const collect = async (part: any): Promise<void> => {
      if (!part) return;
      const filename = part.filename || '';
      const isPdf = /\.pdf$/i.test(filename) || part.mimeType === 'application/pdf';
      if (isPdf && part.body?.attachmentId) {
        const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId: m.id!, id: part.body.attachmentId });
        pdfs.push({ filename: filename || `${m.id}.pdf`, data: Buffer.from(att.data.data || '', 'base64url') });
      }
      for (const p of part.parts || []) await collect(p);
    };
    await collect(msg.data.payload);

    if (pdfs.length) result.push({ messageId: m.id, subject: header('subject'), from: header('from'), date: dateMs ? new Date(dateMs) : null, pdfs });
  }
  return result;
}
