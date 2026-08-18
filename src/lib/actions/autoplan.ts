'use server';

// Автоматическое распределение плеч по рейсам.
//
// Расчёт и запись РАЗДЕЛЕНЫ намеренно: computeAutoPlan только читает и возвращает
// раскладку, applyAutoPlan её фиксирует. Так можно показать разбивку до того, как
// в базе появятся рейсы, и так же устроена проверка на реальных данных.
//
// Что берём: плечи с датой забора в этот день, ещё не привязанные к рейсу.
// Уже привязанные не трогаем — распределение идёт не с нуля.
//
// Чего НЕ берём (по решению заказчика это не сбой, а нормальный остаток логисту):
//   плечи без направления, направления без перевозчика, направления без режима.

import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, getActorId, RoleName } from '@/lib/authz';
import { revalidatePath } from 'next/cache';
import { nextTripNumber, tcuFromCargo } from '@/lib/tripFactory';
import { packLegs, type VehicleOption, type PackedTruck } from '@/lib/autoplanCore';

const W: RoleName[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];

export type SkipReason =
  | 'NO_DIRECTION'   // у плеча не заполнено направление
  | 'NO_CARRIER'     // у направления не задан перевозчик
  | 'NOT_CONFIGURED' // у направления не задан режим набивки
  | 'NO_TARIFF';     // у перевозчика нет действующего тарифа на это направление

export type PlannedTrip = PackedTruck & {
  directionId: string;
  directionCode: string;
  carrierId: string;
  carrierName: string;
  plannedDeparture: Date | null;
  plannedArrival: Date | null;
};

export type AutoPlanResult = {
  date: string;
  trips: PlannedTrip[];
  skipped: { reason: SkipReason; directionCode: string | null; legs: number; pallets: number }[];
  /** Всего непривязанных плеч на день и сколько из них без направления —
   *  счётчик в планировании показывает оба числа, иначе он всегда красный. */
  unassignedLegs: number;
  legsWithoutDirection: number;
};

/**
 * Типы ТС, доступные перевозчику на направлении, с вместимостью.
 *
 * Тариф относится к направлению, если у него стоит это направление ЛИБО совпадает
 * пара точек «забор → выгрузка»: в базе 107 из 121 тарифа перевозчиков ключуются
 * парой, а не направлением. Так же ключует карточка договора перевозчика.
 *
 * ВЕРСИОННОСТЬ. `validTo` не заполнен ни у одного тарифа перевозчика (0 из 125),
 * поэтому «действующий» определяется ТОЛЬКО по `validFrom`: внутри одного ключа
 * действует весь набор строк с самой поздней датой, а предыдущие даты — история.
 * Так считает карточка договора (`dateGroups[0] = актуальный`), и так же надо
 * здесь, иначе в подбор попадают закрытые типы машин: у Трансхолода версия от
 * 20.06 содержит только VT-10 и VT-18, а VT-20 остался в версии от 01.03 —
 * брать его нельзя, хотя `validTo` у него пуст.
 *
 * Вместимость берём из справочника типов — в тарифе её нет.
 */
async function vehicleOptions(
  direction: { id: string; originId: string | null; destinationId: string | null },
  carrierId: string,
  on: Date,
): Promise<VehicleOption[]> {
  const pair =
    direction.originId && direction.destinationId
      ? [{ originLocationId: direction.originId, destinationLocationId: direction.destinationId }]
      : [];

  const tariffs = await prisma.tariff.findMany({
    where: {
      carrierContract: { carrierId },
      vehicleTypeCode: { not: null },
      validFrom: { lte: on },
      OR: [{ validTo: null }, { validTo: { gte: on } }],
      AND: [{ OR: [{ directionId: direction.id }, ...pair] }],
    },
    select: {
      vehicleTypeCode: true,
      validFrom: true,
      directionId: true,
      originLocationId: true,
      destinationLocationId: true,
      vehicleType: { select: { capacityPallets: true } },
    },
  });

  // Ключ как в карточке договора: направление, иначе пара точек.
  const keyOf = (t: (typeof tariffs)[number]) =>
    t.directionId ?? `${t.originLocationId ?? ''}_${t.destinationLocationId ?? ''}`;

  // По каждому ключу оставляем только строки с самой поздней датой начала.
  const latestByKey = new Map<string, number>();
  for (const t of tariffs) {
    const k = keyOf(t);
    const ts = t.validFrom.getTime();
    if (!latestByKey.has(k) || ts > latestByKey.get(k)!) latestByKey.set(k, ts);
  }

  const byCode = new Map<string, number>();
  for (const t of tariffs) {
    if (t.validFrom.getTime() !== latestByKey.get(keyOf(t))) continue; // историческая версия
    const cap = t.vehicleType?.capacityPallets;
    if (!t.vehicleTypeCode || !cap) continue; // без вместимости тип бесполезен
    byCode.set(t.vehicleTypeCode, cap);
  }
  return Array.from(byCode.entries()).map(([code, capacity]) => ({ code, capacity }));
}

export async function computeAutoPlan(dateISO: string): Promise<AutoPlanResult> {
  await requireAuth();

  const day = new Date(dateISO.slice(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(day.getTime() + 86400000);

  const legs = await prisma.requestCargoLeg.findMany({
    where: { plannedPickup: { gte: day, lt: dayEnd }, tripCargoUnitId: null },
    select: {
      id: true, directionId: true, plannedPickup: true, plannedDropoff: true,
      cargo: { select: { pallets: true } },
    },
  });

  const skipped: AutoPlanResult['skipped'] = [];
  const add = (reason: SkipReason, directionCode: string | null, items: { pallets: number }[]) => {
    skipped.push({ reason, directionCode, legs: items.length, pallets: items.reduce((s, i) => s + i.pallets, 0) });
  };

  const noDir = legs.filter((l) => !l.directionId);
  if (noDir.length) add('NO_DIRECTION', null, noDir.map((l) => ({ pallets: l.cargo.pallets ?? 0 })));

  const byDirection = new Map<string, typeof legs>();
  for (const l of legs) {
    if (!l.directionId) continue;
    if (!byDirection.has(l.directionId)) byDirection.set(l.directionId, []);
    byDirection.get(l.directionId)!.push(l);
  }

  const trips: PlannedTrip[] = [];

  for (const [directionId, dirLegs] of Array.from(byDirection.entries())) {
    const dir = await prisma.direction.findUnique({
      where: { id: directionId },
      select: {
        id: true, code: true, originId: true, destinationId: true,
        splitMode: true, carrierId: true, carrier: { select: { name: true } },
      },
    });
    if (!dir) continue;
    const items = dirLegs.map((l) => ({ legId: l.id, pallets: l.cargo.pallets ?? 0 }));

    if (!dir.carrierId) { add('NO_CARRIER', dir.code, items); continue; }
    if (!dir.splitMode) { add('NOT_CONFIGURED', dir.code, items); continue; }

    const vehicles = await vehicleOptions(dir, dir.carrierId, day);
    if (!vehicles.length) { add('NO_TARIFF', dir.code, items); continue; }

    for (const truck of packLegs(items, vehicles, dir.splitMode)) {
      const mine = dirLegs.filter((l) => truck.legIds.includes(l.id));
      const pickups = mine.map((l) => l.plannedPickup).filter(Boolean) as Date[];
      const dropoffs = mine.map((l) => l.plannedDropoff).filter(Boolean) as Date[];
      trips.push({
        ...truck,
        directionId: dir.id,
        directionCode: dir.code,
        carrierId: dir.carrierId,
        carrierName: dir.carrier?.name ?? '',
        plannedDeparture: pickups.length ? new Date(Math.min(...pickups.map((d) => d.getTime()))) : null,
        plannedArrival: dropoffs.length ? new Date(Math.max(...dropoffs.map((d) => d.getTime()))) : null,
      });
    }
  }

  return {
    date: dateISO.slice(0, 10),
    trips,
    skipped,
    unassignedLegs: legs.length,
    legsWithoutDirection: noDir.length,
  };
}

/**
 * Счётчик нераспределённых плеч по дням недели для сетки планирования.
 *
 * Два числа на день намеренно: плеч без направления в базе больше двух третей,
 * и одним числом счётчик был бы красным всегда. `total - noDirection` — то, что
 * автоматика должна была разложить, вот это и есть сигнал.
 */
export async function getUnassignedByDay(weekStartISO: string) {
  await requireAuth();
  const weekStart = new Date(weekStartISO.slice(0, 10) + 'T00:00:00.000Z');
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

  const legs = await prisma.requestCargoLeg.findMany({
    where: { plannedPickup: { gte: weekStart, lt: weekEnd }, tripCargoUnitId: null },
    select: { plannedPickup: true, directionId: true, cargo: { select: { pallets: true } } },
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * 86400000);
    return { date: d.toISOString().slice(0, 10), total: 0, noDirection: 0, pallets: 0 };
  });
  for (const l of legs) {
    if (!l.plannedPickup) continue;
    const key = l.plannedPickup.toISOString().slice(0, 10);
    const slot = days.find((d) => d.date === key);
    if (!slot) continue;
    slot.total++;
    slot.pallets += l.cargo.pallets ?? 0;
    if (!l.directionId) slot.noDirection++;
  }
  return days;
}

/** Считает и сразу создаёт рейсы. Возвращает то же, что расчёт, плюс номера рейсов. */
export async function applyAutoPlan(dateISO: string) {
  await requireRole(W);
  const actor = await getActorId();
  const plan = await computeAutoPlan(dateISO);
  const created: string[] = [];

  for (const t of plan.trips) {
    const dir = await prisma.direction.findUnique({
      where: { id: t.directionId },
      select: { originId: true, destinationId: true },
    });
    if (!dir?.originId || !dir?.destinationId) continue; // без точек рейс не создать

    // Вертикаль и стороны берём из первой заявки рейса: у рейса они одни.
    const first = await prisma.requestCargoLeg.findUnique({
      where: { id: t.legIds[0] },
      select: { cargo: { select: { request: { select: { verticalCode: true } } } } },
    });
    const verticalCode = first?.cargo.request.verticalCode ?? null;

    const trip = await prisma.trip.create({
      data: {
        tripNumber: await nextTripNumber(),
        tripType: verticalCode === 'LAAS' ? 'LAAS' : 'OWN',
        verticalCode,
        directionId: t.directionId,
        originId: dir.originId,
        destinationId: dir.destinationId,
        carrierId: t.carrierId,
        vehicleTypeCode: t.vehicleTypeCode,
        plannedPallets: t.pallets,
        plannedDeparture: t.plannedDeparture,
        plannedArrival: t.plannedArrival,
        status: 'DRAFT',
        createdById: actor,
        updatedById: actor,
      },
    });
    created.push(trip.tripNumber);

    for (const legId of t.legIds) {
      const leg = await prisma.requestCargoLeg.findUnique({
        where: { id: legId },
        include: { cargo: { include: { request: true } } },
      });
      if (!leg || leg.tripCargoUnitId) continue; // кто-то успел привязать — не спорим
      const tcu = await prisma.tripCargoUnit.create({
        data: { ...tcuFromCargo(leg.cargo.request, leg.cargo, actor), tripId: trip.id },
      });
      await prisma.requestCargoLeg.update({
        where: { id: legId },
        data: { tripCargoUnitId: tcu.id, updatedById: actor },
      });
    }
  }

  revalidatePath('/operations/trips');
  revalidatePath('/operations/cargo');
  revalidatePath('/operations/planning');
  return { ...plan, createdTripNumbers: created };
}
