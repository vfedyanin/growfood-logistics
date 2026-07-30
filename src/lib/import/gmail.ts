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

// Предохранитель: сколько писем максимум обрабатываем за один прогон по контрагенту.
// Раньше стоял жёсткий maxResults=50 без пагинации — письма сверх окна терялись
// без следа. Теперь идём по страницам до этого потолка; если писем ещё больше —
// возвращаем truncated=true, и вызывающий пишет явное предупреждение в журнал.
export const MAX_MESSAGES_PER_RUN = 500;

export type FetchPdfEmailsResult = {
  emails: PdfEmail[];
  listed: number;      // сколько писем реально просмотрено (в пределах предохранителя)
  truncated: boolean;  // предохранитель сработал — остались непросмотренные письма
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
// Постранично (nextPageToken) до предохранителя MAX_MESSAGES_PER_RUN. Gmail отдаёт
// письма от новых к старым, поэтому при усечении непросмотренными остаются самые
// старые — вызывающий обязан это залогировать (см. runEmailImport).
export async function fetchPdfEmails(fromEmail: string, afterDate?: Date | null): Promise<FetchPdfEmailsResult> {
  const gmail = gmailClient();
  const q = [`from:${fromEmail}`, 'has:attachment', 'filename:pdf'];
  if (afterDate) q.push(`after:${Math.floor(afterDate.getTime() / 1000)}`);

  // 1) Собираем id всех подходящих писем по страницам — до предохранителя.
  const ids: string[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const list: any = await gmail.users.messages.list({ userId: 'me', q: q.join(' '), maxResults: 100, pageToken });
    for (const m of list.data.messages || []) if (m.id) ids.push(m.id);
    pageToken = list.data.nextPageToken || undefined;
  } while (pageToken && ids.length < MAX_MESSAGES_PER_RUN);
  // truncated: остались непросмотренные письма (есть ещё страница, либо на последней
  // странице перевалили за потолок).
  const truncated = Boolean(pageToken) || ids.length > MAX_MESSAGES_PER_RUN;
  const limitedIds = ids.slice(0, MAX_MESSAGES_PER_RUN);

  // 2) Для каждого письма тянем PDF-вложения.
  const result: PdfEmail[] = [];
  for (const id of limitedIds) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const headers = msg.data.payload?.headers || [];
    const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name)?.value || '';
    const dateMs = msg.data.internalDate ? Number(msg.data.internalDate) : null;

    const pdfs: { filename: string; data: Buffer }[] = [];
    const collect = async (part: any): Promise<void> => {
      if (!part) return;
      const filename = part.filename || '';
      const isPdf = /\.pdf$/i.test(filename) || part.mimeType === 'application/pdf';
      if (isPdf && part.body?.attachmentId) {
        const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: part.body.attachmentId });
        pdfs.push({ filename: filename || `${id}.pdf`, data: Buffer.from(att.data.data || '', 'base64url') });
      }
      for (const p of part.parts || []) await collect(p);
    };
    await collect(msg.data.payload);

    if (pdfs.length) result.push({ messageId: id, subject: header('subject'), from: header('from'), date: dateMs ? new Date(dateMs) : null, pdfs });
  }
  return { emails: result, listed: limitedIds.length, truncated };
}
