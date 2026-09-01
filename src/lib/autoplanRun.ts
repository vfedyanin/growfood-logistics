// Автоматическое распределение плеч по рейсам — ЯДРО, без проверок прав.
//
// Модуль намеренно НЕ 'use server': его вызывает и серверное действие (там роль
// проверяется), и ночной cron-эндпоинт, у которого сессии нет вовсе. Если держать
// это в файле с 'use server', любой экспорт стал бы серверным действием,
// доступным из браузера без авторизации.
//
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
import { nextTripNumber, tcuFromCargo, tripVerticalsFrom, tripTypeFromVerticals } from '@/lib/tripFactory';
import { packLegs, type PackedTruck } from '@/lib/autoplanCore';
// Отбор действующих тарифов перевозчика — общий модуль: этой же логикой
// проверяется карточка направления при сохранении.
import { activeVehicleTypesForDirection, activeCarrierTripCost } from '@/lib/carrierTariff';

export type SkipReason =
  | 'NO_DIRECTION'   // у плеча не заполнено направление
  | 'NO_CARRIER'     // у направления не задан перевозчик
  | 'NOT_CONFIGURED' // у направления не задан режим набивки
  | 'NO_TARIFF';     // у перевозчика нет действующего тарифа на это направление

export type PlannedTrip = PackedTruck & {
  // Откуда рейс: TEMPLATE — из жёсткого шаблона рейса (первый проход);
  // DIRECTION — из старого автоплана по направлению (второй проход, по остатку).
  source: 'TEMPLATE' | 'DIRECTION';
  templateId?: string;
  // Подпись для отчёта: код направления либо имя шаблона.
  directionCode: string;
  // У шаблонного рейса своего направления может не быть — точки берём из слотов.
  directionId: string | null;
  originId: string | null;
  destinationId: string | null;
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

export async function computeAutoPlan(dateISO: string): Promise<AutoPlanResult> {

  const day = new Date(dateISO.slice(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(day.getTime() + 86400000);

  const legs = await prisma.requestCargoLeg.findMany({
    where: { plannedPickup: { gte: day, lt: dayEnd }, tripCargoUnitId: null },
    select: {
      id: true, directionId: true, pickupLocationId: true, dropoffLocationId: true,
      plannedPickup: true, plannedDropoff: true,
      cargo: { select: { pallets: true } },
    },
  });

  const skipped: AutoPlanResult['skipped'] = [];
  const add = (reason: SkipReason, directionCode: string | null, items: { pallets: number }[]) => {
    skipped.push({ reason, directionCode, legs: items.length, pallets: items.reduce((s, i) => s + i.pallets, 0) });
  };

  const trips: PlannedTrip[] = [];

  // ── ПРОХОД 1: жёсткие шаблоны рейсов ────────────────────────────────────────
  // Шаблон = одна машина с фиксированным набором плеч. Плечо садится в слот при
  // совпадении ОБЕИХ точек (забор+выгрузка). Матч жадный и одноразовый: плечо,
  // занятое шаблоном, из общего пула убирается и во второй проход не идёт.
  const consumed = new Set<string>();
  const palletsOf = (l: (typeof legs)[number]) => l.cargo.pallets ?? 0;

  const templates = await prisma.tripPlanTemplate.findMany({
    where: { isActive: true },
    include: {
      carrier: { select: { name: true } },
      vehicleType: { select: { capacityPallets: true } },
      legs: { orderBy: { position: 'asc' } },
    },
  });

  for (const tpl of templates) {
    if (!tpl.legs.length) continue;
    const mine: typeof legs = [];
    for (const slot of tpl.legs) {
      for (const l of legs) {
        if (consumed.has(l.id)) continue;
        if (l.pickupLocationId === slot.pickupLocationId && l.dropoffLocationId === slot.dropoffLocationId) {
          mine.push(l);
          consumed.add(l.id);
        }
      }
    }
    if (!mine.length) continue; // сегодня для этой машины груза нет — рейс не создаём

    const pallets = mine.reduce((s, l) => s + palletsOf(l), 0);
    const capacity = tpl.vehicleType.capacityPallets ?? pallets;
    const firstSlot = tpl.legs[0];
    const lastSlot = tpl.legs[tpl.legs.length - 1];
    const pickups = mine.map((l) => l.plannedPickup).filter(Boolean) as Date[];
    const dropoffs = mine.map((l) => l.plannedDropoff).filter(Boolean) as Date[];

    trips.push({
      source: 'TEMPLATE',
      templateId: tpl.id,
      directionCode: tpl.name,
      directionId: null,
      originId: firstSlot.pickupLocationId,
      destinationId: lastSlot.dropoffLocationId,
      carrierId: tpl.carrierId,
      carrierName: tpl.carrier.name,
      vehicleTypeCode: tpl.vehicleTypeCode,
      capacity,
      pallets,
      overload: pallets > capacity,
      legIds: mine.map((l) => l.id),
      plannedDeparture: pickups.length ? new Date(Math.min(...pickups.map((d) => d.getTime()))) : null,
      plannedArrival: dropoffs.length ? new Date(Math.max(...dropoffs.map((d) => d.getTime()))) : null,
    });
  }

  // ── ПРОХОД 2: старый автоплан по направлениям, по ОСТАВШИМСЯ плечам ──────────
  const rest = legs.filter((l) => !consumed.has(l.id));

  const noDir = rest.filter((l) => !l.directionId);
  if (noDir.length) add('NO_DIRECTION', null, noDir.map((l) => ({ pallets: l.cargo.pallets ?? 0 })));

  const byDirection = new Map<string, typeof legs>();
  for (const l of rest) {
    if (!l.directionId) continue;
    if (!byDirection.has(l.directionId)) byDirection.set(l.directionId, []);
    byDirection.get(l.directionId)!.push(l);
  }

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

    const vehicles = await activeVehicleTypesForDirection(dir, dir.carrierId, day);
    if (!vehicles.length) { add('NO_TARIFF', dir.code, items); continue; }

    for (const truck of packLegs(items, vehicles, dir.splitMode)) {
      const mine = dirLegs.filter((l) => truck.legIds.includes(l.id));
      const pickups = mine.map((l) => l.plannedPickup).filter(Boolean) as Date[];
      const dropoffs = mine.map((l) => l.plannedDropoff).filter(Boolean) as Date[];
      trips.push({
        ...truck,
        source: 'DIRECTION',
        directionId: dir.id,
        directionCode: dir.code,
        originId: dir.originId,
        destinationId: dir.destinationId,
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
    legsWithoutDirection: noDir.length, // без направления и не подобранные шаблоном
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
export async function applyAutoPlan(dateISO: string, actor: string | null) {
  const plan = await computeAutoPlan(dateISO);
  const created: string[] = [];

  for (const t of plan.trips) {
    // Точки рейса: у направления — из справочника, у шаблона — из слотов (лежат
    // в самом PlannedTrip). Без точек рейс не создать.
    let originId = t.originId;
    let destinationId = t.destinationId;
    let distanceKm: number | null = null;
    if (t.source === 'DIRECTION' && t.directionId) {
      const dir = await prisma.direction.findUnique({
        where: { id: t.directionId },
        select: { originId: true, destinationId: true, distanceKm: true },
      });
      originId = dir?.originId ?? null;
      destinationId = dir?.destinationId ?? null;
      distanceKm = dir?.distanceKm != null ? Number(dir.distanceKm) : null;
    }
    if (!originId || !destinationId) continue;

    // Вертикали берём по ВСЕМ плечам рейса, а не с первого: в одну машину
    // попадают заявки разных вертикалей (на боевых данных LAAS-LTL + PRIEM), и
    // тип «по первому плечу» вставал наугад — рейс с ласовым грузом помечался
    // OWN и пропадал у LAAS-менеджера.
    const legRows = await prisma.requestCargoLeg.findMany({
      where: { id: { in: t.legIds } },
      select: { cargo: { select: { request: { select: { verticalCode: true } } } } },
    });
    const verticalCodes = tripVerticalsFrom(legRows.map((l) => l.cargo.request.verticalCode));
    // Единственная вертикаль (MONO) — её же кладём в старое одиночное поле;
    // при MIX оно теряет смысл и остаётся пустым, перечисление живёт в verticalCodes.
    const verticalCode = verticalCodes.length === 1 ? verticalCodes[0] : null;

    // Стоимость по тарифу перевозчика — сразу при создании, тем же ключом
    // (направление/пара точек), что и подбор машины. У шаблонного рейса своего
    // направления нет — считаем по паре точек. Забор Йуми при этом обычно даёт
    // null: его стоимость внутри тарифа магистрали, отдельной ставки нет.
    const costDate = t.plannedDeparture ?? new Date(dateISO.slice(0, 10) + 'T00:00:00.000Z');
    const actualCost = await activeCarrierTripCost(
      { id: t.directionId ?? '', originId, destinationId, distanceKm },
      t.carrierId,
      t.vehicleTypeCode,
      t.pallets,
      costDate,
    );

    const trip = await prisma.trip.create({
      data: {
        tripNumber: await nextTripNumber(),
        tripType: tripTypeFromVerticals(verticalCodes),
        verticalCode,
        verticalCodes,
        directionId: t.directionId,
        originId,
        destinationId,
        carrierId: t.carrierId,
        vehicleTypeCode: t.vehicleTypeCode,
        plannedPallets: t.pallets,
        actualCost,
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

  return { ...plan, createdTripNumbers: created };
}
