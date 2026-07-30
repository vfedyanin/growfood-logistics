'use server';

import { prisma } from '@/lib/prisma';
import { requireRole, requireAuth, getActorId, RoleName } from '@/lib/authz';
import { serialize } from '@/lib/serialize';
import { revalidatePath } from 'next/cache';
import { importPdf, importStatus } from '@/lib/import/runImport';
import type { RunImportResult } from '@/lib/import/runImport';
import { runEmailImport } from '@/lib/import/runEmailImport';

const W: RoleName[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];

// Список контрагентов, у которых задан парсер (для формы ручной загрузки).
export async function getImportCustomers() {
  await requireAuth();
  const rows = await prisma.customer.findMany({
    where: { parserKey: { not: null } },
    select: { id: true, name: true, email: true, parserKey: true, autoImportEnabled: true, importSince: true },
    orderBy: { name: 'asc' },
  });
  return serialize(rows);
}

// Журнал прогонов импорта.
export async function getImportLogs(limit = 50) {
  await requireAuth();
  const rows = await prisma.importLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { customer: { select: { name: true } } },
  });
  return serialize(rows);
}

// Ручной запуск проверки почты (та же логика, что и крон) — по кнопке оператора.
export async function runEmailImportNow() {
  await requireRole(W);
  const actor = await getActorId();
  const summary = await runEmailImport({ trigger: 'MANUAL', systemActorId: actor });
  revalidatePath('/import-log');
  return summary;
}

// Ручной запуск: загрузка PDF оператором → OCR → парсинг → создание заявок + запись в лог.
export async function runManualImport(formData: FormData) {
  await requireRole(W);
  const actor = await getActorId();
  const customerId = String(formData.get('customerId') || '');
  const file = formData.get('file') as File | null;
  if (!customerId) throw new Error('Не выбран контрагент');
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Не приложен файл');

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, parserKey: true } });
  if (!customer) throw new Error('Контрагент не найден');
  if (!customer.parserKey) throw new Error(`У контрагента «${customer.name}» не задан парсер PDF`);

  const buffer = Buffer.from(await file.arrayBuffer());

  let result: RunImportResult | null = null;
  let logStatus: 'SUCCESS' | 'PARTIAL' | 'EMPTY' | 'DUPLICATES' | 'ERROR' = 'ERROR';
  let stage: string | null = 'create';
  let message = '';
  let fatalError: string | null = null;
  try {
    result = await importPdf(buffer, customer.parserKey, { systemActorId: actor });
    logStatus = importStatus(result);
    message = `Создано ${result.created.length}, пропущено ${result.skipped.length}, ошибок ${result.errors.length}, предупреждений ${result.warnings.length}`;
    stage = result.ocrChars ? (result.created.length || result.skipped.length ? 'create' : 'parse') : 'ocr';
  } catch (e: any) {
    fatalError = e?.message || 'Ошибка OCR/парсинга';
    stage = 'ocr';
    message = `Сбой обработки: ${fatalError}`;
  }

  const log = await prisma.importLog.create({
    data: {
      trigger: 'MANUAL',
      customerId: customer.id,
      source: file.name || null,
      status: logStatus,
      stage,
      ocrChars: result?.ocrChars ?? null,
      createdCount: result?.created.length ?? 0,
      createdNumbers: result?.created.map((c) => c.requestNumber) ?? [],
      message,
      details: (fatalError ? { fatalError } : (result as any)) ?? undefined,
      createdById: actor,
    },
    select: { id: true },
  });

  revalidatePath('/import-log');
  revalidatePath('/requests');
  return { logId: log.id, status: logStatus, message, created: result?.created ?? [], skipped: result?.skipped ?? [], errors: result?.errors ?? (fatalError ? [fatalError] : []), warnings: result?.warnings ?? [] };
}
