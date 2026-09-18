'use server';

// Приём заказов из 1С → заявки на перевозку (запись в БД). Чистый разбор строк
// выгрузки — в src/lib/ingest1c.ts; здесь только обращение к БД: разрешаем
// производителя/направление/шаблон и КЛОНИРУЕМ шаблон заявки той же логикой, что
// клик по ячейке планирования (createPlanningRequest). 1С даёт лишь СкладGUID,
// дату отгрузки на РЦ и количества; времена/окна/смещения дней берутся из шаблона.
//
// Идемпотентность — UPSERT по externalKey = «1c:СкладGUID|дата|ДоговорGUID».
// Заявку, уже ушедшую из статуса NEW (логист принял в работу), повторная выгрузка
// НЕ перетирает — только сообщает в отчёте.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole, RoleName } from '@/lib/authz';
import { recomputeRequestFinals } from '@/lib/pricing';
import { nextRequestNumber } from '@/lib/numbering';
import { revalidatePath } from 'next/cache';
import { planFrom1c, type OrderRow, type ProducerKey } from '@/lib/ingest1c';
import { fetchProductionOrders, get1cConfig, missing1cConfig } from '@/lib/onec';

const W: RoleName[] = ['LOGISTICS_MANAGER'];

// Ключи производителей → Customer.id. Id стабильны (ветки Neon форкнуты от прода,
// один сид). Если id не найдётся в БД — поставка уйдёт в отчёт с ошибкой, а не
// создаст мусорную заявку.
const PRODUCER_CUSTOMER: Record<Exclude<ProducerKey, 'SKIP'>, string> = {
  BIRYULEVO: 'cmsewlfjj0001esbil102wo2v',
  PRIEM: 'cmsewn0rh0003esbio1wswmey',
  FUDHOLDING: 'cmsewp5jw0005esbiffv12xdi',
  SENDWICH: 'cmsewpskh0007esbi18ff90ef',
};

// Перенос времени из шаблонного плеча на расчётную дату (как в planning.ts).
function withTime(base: Date | null, legDateRaw: string | null | undefined): Date | null {
  if (!base) return null;
  if (!legDateRaw) return base;
  const src = new Date(legDateRaw);
  if (isNaN(src.getTime())) return base;
  const result = new Date(base);
  result.setUTCHours(src.getUTCHours(), src.getUTCMinutes(), 0, 0);
  return result;
}
function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export type IngestOutcomeKind = 'created' | 'updated' | 'skipped_inwork' | 'skipped_producer' | 'error';
export type IngestOutcome = {
  key: string;
  rc: string;
  direction: string;
  deliveryDate: string;
  producer: ProducerKey;
  pallets: number;
  kind: IngestOutcomeKind;
  requestNumber?: string;
  message?: string;
};

// Откуда прогон: загрузка файла или забор из сервиса 1С. Пишется в журнал IngestRun.
export type IngestRunMeta = {
  source: 'FILE' | 'API_1C';
  fileName?: string;
  dateFrom?: string;
  dateTo?: string;
  fetched?: number;
};

/**
 * Приём выгрузки 1С. Не делает сети — принимает уже полученные строки. Возвращает
 * отчёт по каждой поставке (для просмотра логистом и как чек-лист «нет шаблона»).
 */
export async function applyIngest(
  rows: OrderRow[],
  meta: IngestRunMeta = { source: 'FILE' },
): Promise<{ outcomes: IngestOutcome[] }> {
  const user = await requireRole(W);
  const actor = user.id;

  const deliveries = planFrom1c(rows);
  const outcomes: IngestOutcome[] = [];

  for (const d of deliveries) {
    const base = {
      key: d.key, rc: d.rc, direction: d.direction,
      deliveryDate: d.deliveryDate, producer: d.producer, pallets: d.pallets,
    };

    // производитель вне периметра / спорный без ответа — молча в отчёт, не в заявки
    if (d.producer === 'SKIP') {
      outcomes.push({ ...base, kind: 'skipped_producer', message: `Договор ${d.dogovor || d.dogovorGuid}: производитель не в периметре` });
      continue;
    }
    const producerId = PRODUCER_CUSTOMER[d.producer];

    try {
      const route = await prisma.direction.findUnique({
        where: { code: d.direction },
        select: { id: true, originId: true, destinationId: true },
      });
      if (!route) { outcomes.push({ ...base, kind: 'error', message: `Направление ${d.direction} не найдено` }); continue; }
      if (!route.destinationId) { outcomes.push({ ...base, kind: 'error', message: `У направления ${d.direction} не задана конечная точка` }); continue; }

      // Шаблон заявки: график производителя на этот РЦ (по конечной точке).
      const now = new Date();
      const sched = await prisma.directionSchedule.findFirst({
        where: {
          destinationLocationId: route.destinationId,
          requestTemplateId: { not: null },
          customerContract: { customerId: producerId },
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        orderBy: { validFrom: 'desc' },
        select: { requestTemplateId: true },
      });
      if (!sched?.requestTemplateId) {
        outcomes.push({ ...base, kind: 'error', message: `Нет шаблона заявки: ${d.producer} → ${d.rc}` });
        continue;
      }
      const tpl = await prisma.requestTemplate.findUnique({ where: { id: sched.requestTemplateId } });
      const tplData: any = tpl?.data ?? null;
      const tplLegs: any[] = ((tplData?.cargoes) || []).flatMap((c: any) => c.legs || []);
      if (!tplLegs.length) { outcomes.push({ ...base, kind: 'error', message: `Пустой шаблон: ${d.producer} → ${d.rc}` }); continue; }
      if (tplLegs.some((l) => !l.directionId)) { outcomes.push({ ...base, kind: 'error', message: `В шаблоне плечо без направления: ${d.producer} → ${d.rc}` }); continue; }

      // День X (забор/ячейка) = дата выгрузки на РЦ − максимальное смещение выгрузки.
      const maxDropoffOffset = tplLegs.reduce(
        (max: number | null, l: any) => (l.dropoffDayOffset != null ? Math.max(max ?? 0, Number(l.dropoffDayOffset)) : max),
        null as number | null,
      );
      const deliveryDateObj = new Date(d.deliveryDate + 'T00:00:00.000Z');
      const totalDays = maxDropoffOffset ?? 0;
      const pickupDateObj = addDays(deliveryDateObj, -totalDays);
      const externalKey = `1c:${d.key}`;

      // UPSERT по externalKey
      const existing = await prisma.customerRequest.findUnique({
        where: { externalKey },
        select: { id: true, requestNumber: true, status: true, cargoes: { select: { id: true } } },
      });
      if (existing) {
        if (existing.status !== 'NEW') {
          outcomes.push({ ...base, kind: 'skipped_inwork', requestNumber: existing.requestNumber, message: `Заявка ${existing.requestNumber} в статусе ${existing.status} — не перезаписываем` });
          continue;
        }
        // обновляем только количество (плечи/времена не трогаем)
        await prisma.customerRequest.update({ where: { id: existing.id }, data: { requestedPallets: d.pallets, updatedById: actor } });
        for (const c of existing.cargoes) {
          await prisma.requestCargo.update({ where: { id: c.id }, data: { pallets: d.pallets, updatedById: actor } });
        }
        await recomputeRequestFinals(existing.id);
        outcomes.push({ ...base, kind: 'updated', requestNumber: existing.requestNumber });
        continue;
      }

      // Создаём новую заявку клоном шаблона
      const requestNumber = await nextRequestNumber('REQ');
      const req = await prisma.customerRequest.create({
        data: {
          requestNumber,
          externalKey,
          source: 'API_1C',
          customerId: producerId,
          payerId: tplData?.payerId ?? null,
          shipperId: tplData?.shipperId ?? producerId,
          verticalCode: tplData?.verticalCode ?? 'GF-RETAIL',
          pickupLocationId: route.originId,
          deliveryLocationId: route.destinationId,
          pickupDate: pickupDateObj,
          deliveryDate: deliveryDateObj,
          requestDate: now,
          requestedPallets: d.pallets,
          status: 'NEW',
          notes: `Приём из 1С. СкладGUID ${d.key.split('|')[0]}, договор ${d.dogovor || d.dogovorGuid}. Заказы: ${d.sourceOrderGuids.length}.`,
          createdById: actor,
          updatedById: actor,
        },
      });

      for (const cargo of (tplData?.cargoes ?? [])) {
        const createdCargo = await prisma.requestCargo.create({
          data: {
            requestId: req.id,
            consigneeId: cargo.consigneeId ?? null,
            consigneeLocationId: cargo.consigneeLocationId ?? route.destinationId,
            unitType: cargo.unitType ?? 'PALLET',
            pallets: d.pallets,
            traysCount: cargo.traysCount ?? null,
            weightKg: cargo.weightKg ?? null,
            productCategory: cargo.productCategory ?? null,
            tempRegime: cargo.tempRegime ?? null,
            pricingMode: cargo.pricingMode ?? 'CARGO',
            notes: cargo.notes ?? null,
            createdById: actor,
            updatedById: actor,
          },
        });
        const legs: any[] = cargo.legs ?? [];
        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i];
          const isFirst = i === 0;
          const isLast = i === legs.length - 1;
          const pOff = leg.pickupDayOffset;
          const dOff = leg.dropoffDayOffset;
          const pickupBase = pOff != null ? addDays(pickupDateObj, Number(pOff)) : isFirst ? pickupDateObj : null;
          const dropoffBase = dOff != null ? addDays(pickupDateObj, Number(dOff)) : isLast ? deliveryDateObj : null;
          await prisma.requestCargoLeg.create({
            data: {
              requestCargoId: createdCargo.id,
              legOrder: i + 1,
              pickupLocationId: leg.pickupLocationId ?? null,
              dropoffLocationId: leg.dropoffLocationId ?? null,
              directionId: leg.directionId ?? null,
              plannedPickup: withTime(pickupBase, leg.plannedPickupFrom ?? leg.plannedPickup),
              plannedPickupTo: leg.plannedPickupTo ?? null,
              plannedDropoff: withTime(dropoffBase, leg.plannedDropoffFrom ?? leg.plannedDropoff),
              plannedDropoffTo: leg.plannedDropoffTo ?? null,
              createdById: actor,
              updatedById: actor,
            },
          });
        }
      }

      await recomputeRequestFinals(req.id);
      outcomes.push({ ...base, kind: 'created', requestNumber });
    } catch (e: any) {
      outcomes.push({ ...base, kind: 'error', message: String(e?.message ?? e) });
    }
  }

  // Журнал прогона: счётчики + весь отчёт целиком, чтобы открыть загрузку позже.
  const count = (k: IngestOutcomeKind) => outcomes.filter((o) => o.kind === k).length;
  try {
    await prisma.ingestRun.create({
      data: {
        createdById: actor,
        createdByName: user.name ?? user.email ?? null,
        source: meta.source,
        dateFrom: meta.dateFrom ?? null,
        dateTo: meta.dateTo ?? null,
        fileName: meta.fileName ?? null,
        fetched: meta.fetched ?? rows.length,
        created: count('created'),
        updated: count('updated'),
        skippedInwork: count('skipped_inwork'),
        skippedProducer: count('skipped_producer'),
        errors: count('error'),
        outcomes: outcomes as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // журнал не должен ронять сам приём — заявки уже созданы
  }

  revalidatePath('/operations/planning');
  revalidatePath('/requests');
  revalidatePath('/operations/import-1c');
  return { outcomes };
}

/** Настроен ли HTTP-забор из 1С (заданы переменные окружения). Для UI-подсказки. */
export async function is1cConfigured(): Promise<boolean> {
  await requireRole(W);
  return get1cConfig() != null;
}

/** Какие переменные окружения 1С не заданы (для диагностики на странице приёма). */
export async function missing1cEnv(): Promise<string[]> {
  await requireRole(W);
  return missing1cConfig();
}

export type IngestRunSummary = {
  id: string;
  createdAt: string;
  createdByName: string | null;
  source: 'FILE' | 'API_1C';
  dateFrom: string | null;
  dateTo: string | null;
  fileName: string | null;
  fetched: number;
  created: number;
  updated: number;
  skippedInwork: number;
  skippedProducer: number;
  errors: number;
};

/** Журнал прогонов приёма 1С (новые сверху). Для страницы «Приём заказов 1С». */
export async function listIngestRuns(limit = 50): Promise<IngestRunSummary[]> {
  await requireRole(W);
  const runs = await prisma.ingestRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, createdAt: true, createdByName: true, source: true,
      dateFrom: true, dateTo: true, fileName: true, fetched: true,
      created: true, updated: true, skippedInwork: true, skippedProducer: true, errors: true,
    },
  });
  return runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Полный отчёт одного прогона (тот же IngestOutcome[], что был при загрузке). */
export async function getIngestRunOutcomes(id: string): Promise<IngestOutcome[]> {
  await requireRole(W);
  const run = await prisma.ingestRun.findUnique({ where: { id }, select: { outcomes: true } });
  return (run?.outcomes as unknown as IngestOutcome[]) ?? [];
}

/**
 * Забор из GET-сервиса 1С за период [dateFrom, dateTo] (YYYY-MM-DD) и приём в заявки.
 * Даёт HTTP-запрос к 1С (работает только из задеплоенного окружения с доступом к
 * сервису), затем тот же applyIngest. Возвращает и число полученных строк.
 */
export async function ingestFrom1c(dateFrom: string, dateTo: string): Promise<{ fetched: number; outcomes: IngestOutcome[] }> {
  await requireRole(W);
  const rows = await fetchProductionOrders(dateFrom, dateTo);
  const { outcomes } = await applyIngest(rows, { source: 'API_1C', dateFrom, dateTo, fetched: rows.length });
  return { fetched: rows.length, outcomes };
}
