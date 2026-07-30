// Почтовый импорт: по контрагентам с включённым авто-импортом ищем письма с PDF
// после watermark, распознаём и создаём заявки. Дедуп по Gmail messageId (ImportLog.source).
import { prisma } from '@/lib/prisma';
import { fetchPdfEmails, gmailConfigured, MAX_MESSAGES_PER_RUN } from './gmail';
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
    let fetched;
    try {
      fetched = await fetchPdfEmails(c.email!, c.importSince);
    } catch (e: any) {
      await prisma.importLog.create({ data: { trigger: opts.trigger, customerId: c.id, status: 'ERROR', stage: 'mail', message: `Ошибка подключения к почте: ${e?.message || e}`, createdById: actor } });
      summary.logs++;
      summary.errors.push(`${c.name}: почта — ${e?.message || e}`);
      continue;
    }
    const { emails, truncated, listed } = fetched;
    summary.emailsFound += emails.length;

    // Задача 1: сработал предохранитель — часть писем (самые старые) не просмотрена.
    // Молчать нельзя: пишем явную ошибку в журнал, чтобы оператор увидел и сдвинул importSince.
    if (truncated) {
      await prisma.importLog.create({ data: {
        trigger: opts.trigger, customerId: c.id, status: 'ERROR', stage: 'mail',
        message: `Писем больше предохранителя (${MAX_MESSAGES_PER_RUN}): просмотрены только первые ${listed} (новейшие). Более старые письма НЕ обработаны — сдвиньте importSince ближе или разберите вручную.`,
        createdById: actor,
      } });
      summary.logs++;
      summary.errors.push(`${c.name}: писем больше ${MAX_MESSAGES_PER_RUN} — часть не просмотрена`);
    }

    for (const email of emails) {
      for (const pdf of email.pdfs) {
        summary.processed++;
        // Задача 3: ключ дедупа — письмо+файл. Раньше ключ был на всё письмо, и при
        // нескольких PDF второй/третий терялись, если прогон падал на первом.
        const src = `gmail:${email.messageId}:${pdf.filename}`;
        const legacySrc = `gmail:${email.messageId}`; // старый формат ключа (на всё письмо)
        // «Уже обработано» — только доведённое (SUCCESS/PARTIAL). EMPTY убрали: раньше
        // пустой/полностью-дублированный прогон помечал письмо обработанным навсегда и
        // оно больше не проверялось. Старый ключ учитываем, чтобы уже обработанные
        // письма не поехали заново (без миграции значений source).
        const already = await prisma.importLog.findFirst({
          where: { source: { in: [src, legacySrc] }, status: { in: ['SUCCESS', 'PARTIAL'] } },
          select: { id: true },
        });
        if (already) continue;
        try {
          const res = await importPdf(pdf.data, c.parserKey!, { systemActorId: actor });
          const status = importStatus(res);
          // Задача 3 (различение): «пусто» vs «всё ушло в дубли/пропуски» — в тексте лога.
          const allSkipped = res.created.length === 0 && res.errors.length === 0 && res.skipped.length > 0;
          await prisma.importLog.create({
            data: {
              trigger: opts.trigger, customerId: c.id, source: src,
              status, stage: res.ocrChars ? (res.created.length || res.skipped.length ? 'create' : 'parse') : 'ocr',
              ocrChars: res.ocrChars, createdCount: res.created.length, createdNumbers: res.created.map((x) => x.requestNumber),
              message: `Письмо «${email.subject || '—'}» (${pdf.filename}): создано ${res.created.length}, ${allSkipped ? `все ${res.skipped.length} — дубли/пропуски` : `пропущено ${res.skipped.length}`}, ошибок ${res.errors.length}`,
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
