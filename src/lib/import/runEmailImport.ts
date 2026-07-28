// Почтовый импорт: по контрагентам с включённым авто-импортом ищем письма с PDF
// после watermark, распознаём и создаём заявки. Дедуп по Gmail messageId (ImportLog.source).
import { prisma } from '@/lib/prisma';
import { fetchPdfEmails, gmailConfigured } from './gmail';
import { importPdf, importStatus } from './runImport';

export type EmailImportSummary = {
  configured: boolean;
  customersChecked: number;
  emailsFound: number;
  processed: number;
  createdRequests: number;
  logs: number;
  errors: string[];
};

export async function runEmailImport(opts: { trigger: 'CRON' | 'MANUAL'; systemActorId?: string | null }): Promise<EmailImportSummary> {
  const summary: EmailImportSummary = { configured: gmailConfigured(), customersChecked: 0, emailsFound: 0, processed: 0, createdRequests: 0, logs: 0, errors: [] };
  const actor = opts.systemActorId ?? null;

  if (!summary.configured) {
    summary.errors.push('Gmail не настроен (нет GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)');
    return summary;
  }

  const customers = await prisma.customer.findMany({
    where: { autoImportEnabled: true, email: { not: null }, parserKey: { not: null } },
    select: { id: true, name: true, email: true, parserKey: true, importSince: true },
  });

  for (const c of customers) {
    summary.customersChecked++;
    let emails;
    try {
      emails = await fetchPdfEmails(c.email!, c.importSince);
    } catch (e: any) {
      await prisma.importLog.create({ data: { trigger: opts.trigger, customerId: c.id, status: 'ERROR', stage: 'mail', message: `Ошибка подключения к почте: ${e?.message || e}`, createdById: actor } });
      summary.logs++;
      summary.errors.push(`${c.name}: почта — ${e?.message || e}`);
      continue;
    }
    summary.emailsFound += emails.length;

    for (const email of emails) {
      const src = `gmail:${email.messageId}`;
      const already = await prisma.importLog.findFirst({ where: { source: src, status: { in: ['SUCCESS', 'PARTIAL', 'EMPTY'] } }, select: { id: true } });
      if (already) continue; // уже обработано в прошлый прогон

      for (const pdf of email.pdfs) {
        summary.processed++;
        try {
          const res = await importPdf(pdf.data, c.parserKey!, { systemActorId: actor });
          const status = importStatus(res);
          await prisma.importLog.create({
            data: {
              trigger: opts.trigger, customerId: c.id, source: src,
              status, stage: res.ocrChars ? (res.created.length || res.skipped.length ? 'create' : 'parse') : 'ocr',
              ocrChars: res.ocrChars, createdCount: res.created.length, createdNumbers: res.created.map((x) => x.requestNumber),
              message: `Письмо «${email.subject || '—'}» (${pdf.filename}): создано ${res.created.length}, пропущено ${res.skipped.length}, ошибок ${res.errors.length}`,
              details: res as any, createdById: actor,
            },
          });
          summary.logs++;
          summary.createdRequests += res.created.length;
        } catch (e: any) {
          await prisma.importLog.create({ data: { trigger: opts.trigger, customerId: c.id, source: src, status: 'ERROR', stage: 'ocr', message: `Сбой обработки «${pdf.filename}»: ${e?.message || e}`, details: { fatalError: String(e?.message || e) }, createdById: actor } });
          summary.logs++;
          summary.errors.push(`${c.name}: ${pdf.filename} — ${e?.message || e}`);
        }
      }
    }
  }
  return summary;
}
