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
  /** Сколько из плеч рейса — заборные (производство → хаб, входят в тариф). */
  pickupLegs: number;
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

export async function computeAutoPlan(dateISO: string): Promise<AutoPlanResult> {

  const day = new Date(dateISO.slice(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(day.getTime() + 86400000);

  const legs = await prisma.requestCargoLeg.findMany({
    where: { plannedPickup: { gte: day, lt: dayEnd }, tripCargoUnitId: null },
    select: {
      id: true, directionId: true, legOrder: true, plannedPickup: true, plannedDropoff: true,
      pickupLocationId: true, dropoffLocationId: true, requestCargoId: true,
      cargo: { select: { pallets: true } },
    },
  });

  const skipped: AutoPlanResult['skipped'] = [];
  const add = (reason: SkipReason, directionCode: string | null, items: { pallets: number }[]) => {
    skipped.push({ reason, directionCode, legs: items.length, pallets: items.reduce((s, i) => s + i.pallets, 0) });
  };

  const noDir = legs.filter((l) => !l.directionId);
  if (noDir.length) add('NO_DIRECTION', null, noDir.map((l) => ({ pallets: l.cargo.pallets ?? 0 })));

  // Все направления разом: нужны настройки (перевозчик, режим) и правило
  // «чей рейс забирает груз с производства».
  const allDirs = await prisma.direction.findMany({
    select: {
      id: true, code: true, originId: true, destinationId: true,
      splitMode: true, carrierId: true, pickupViaDirectionId: true,
      carrier: { select: { name: true } },
      stops: { select: { locationId: true, position: true } },
    },
  });
  const dirById = new Map(allDirs.map((d) => [d.id, d]));
  const configured = (id: string | null | undefined) => {
    const d = id ? dirById.get(id) : undefined;
    return !!(d && d.carrierId && d.splitMode);
  };

  // ЗАБОРНОЕ ПЛЕЧО — плечо, у которого своё направление НЕ настроено (внутренние
  // перевалки вроде MSK-MSK: перевозчика там нет и быть не должно), но в том же
  // грузе есть следующее плечо с настроенным направлением. Такое плечо не
  // самостоятельная перевозка: производство → хаб входит в тариф магистрали.
  //
  // Куда его класть, задаёт направление магистрали своим pickupViaDirectionId:
  // «Казань → забор везёт MSK-NN-5KA», «Воронеж → MSK-NN». Пусто — свой рейс.
  // Правило в данных, поэтому смена объёмов лечится справочником, а не кодом.
  const nextLegDir = new Map<string, string | null>(); // legId → направление следующего плеча
  const cargoIds = Array.from(new Set(legs.map((l) => l.requestCargoId)));
  if (cargoIds.length) {
    const sameCargoLegs = await prisma.requestCargoLeg.findMany({
      where: { requestCargoId: { in: cargoIds } },
      select: { id: true, requestCargoId: true, legOrder: true, directionId: true },
      orderBy: { legOrder: 'asc' },
    });
    const byCargo = new Map<string, typeof sameCargoLegs>();
    for (const l of sameCargoLegs) {
      if (!byCargo.has(l.requestCargoId)) byCargo.set(l.requestCargoId, []);
      byCargo.get(l.requestCargoId)!.push(l);
    }
    for (const l of legs) {
      const chain = byCargo.get(l.requestCargoId) ?? [];
      const next = chain.find((x) => x.legOrder > (l.legOrder ?? 0));
      nextLegDir.set(l.id, next?.directionId ?? null);
    }
  }

  /** Направление рейса, в который плечо должно попасть, и признак «это забор». */
  const targetOf = (l: (typeof legs)[number]): { dirId: string | null; isPickup: boolean } => {
    if (configured(l.directionId)) return { dirId: l.directionId!, isPickup: false };
    const nextDir = nextLegDir.get(l.id) ?? null;
    if (!configured(nextDir)) return { dirId: l.directionId ?? null, isPickup: false };
    const magistral = dirById.get(nextDir!)!;
    const via = magistral.pickupViaDirectionId;
    return { dirId: configured(via) ? via! : magistral.id, isPickup: true };
  };

  const byDirection = new Map<string, typeof legs>();
  const pickupLegIds = new Set<string>();
  for (const l of legs) {
    if (!l.directionId) continue;
    const t = targetOf(l);
    if (!t.dirId) continue;
    if (t.isPickup) pickupLegIds.add(l.id);
    if (!byDirection.has(t.dirId)) byDirection.set(t.dirId, []);
    byDirection.get(t.dirId)!.push(l);
  }

  const trips: PlannedTrip[] = [];

  for (const [directionId, dirLegs] of Array.from(byDirection.entries())) {
    const dir = dirById.get(directionId);
    if (!dir) continue;

    // ВМЕСТИМОСТЬ СЧИТАЕМ ПО УЧАСТКАМ МАРШРУТА, а не суммой паллет рейса.
    // Забор выгружается в хабе, и дальше машина едет уже без него: на плечах
    // Йуми→КД Север и КД Север→Пятёрочка грузы РАЗНЫЕ, они не складываются.
    // Суммой мы завышали бы загрузку и заказывали лишние машины.
    // Нагрузка рейса = максимум по участкам маршрута направления.
    const posOf = new Map(dir.stops.map((s) => [s.locationId, s.position]));
    const legSpan = (l: (typeof legs)[number]) => {
      const a = l.pickupLocationId ? posOf.get(l.pickupLocationId) : undefined;
      const b = l.dropoffLocationId ? posOf.get(l.dropoffLocationId) : undefined;
      return a != null && b != null && a < b ? { from: a, to: b } : null;
    };
    /** Пиковая загрузка набора плеч с учётом того, где груз входит и выходит. */
    const peakLoad = (chosen: (typeof legs)[number][]) => {
      const spans = chosen.map((l) => ({ span: legSpan(l), p: l.cargo.pallets ?? 0 }));
      // Маршрут не заведён или точки вне него — считаем по-старому, суммой:
      // без порядка точек участков нет, и занижать нагрузку опаснее, чем завышать.
      if (spans.some((s) => !s.span)) return spans.reduce((s, x) => s + x.p, 0);
      const edges = Array.from(new Set(spans.flatMap((s) => [s.span!.from, s.span!.to]))).sort((a, b) => a - b);
      let peak = 0;
      for (let i = 0; i < edges.length - 1; i++) {
        const load = spans
          .filter((s) => s.span!.from <= edges[i] && s.span!.to >= edges[i + 1])
          .reduce((s, x) => s + x.p, 0);
        if (load > peak) peak = load;
      }
      return peak;
    };

    const items = dirLegs.map((l) => ({ legId: l.id, pallets: l.cargo.pallets ?? 0 }));

    if (!dir.carrierId) { add('NO_CARRIER', dir.code, items); continue; }
    if (!dir.splitMode) { add('NOT_CONFIGURED', dir.code, items); continue; }

    const vehicles = await activeVehicleTypesForDirection(dir, dir.carrierId, day);
    if (!vehicles.length) { add('NO_TARIFF', dir.code, items); continue; }

    // Набивка идёт по паллетам (как раньше), а вместимость проверяется по пиковой
    // загрузке: собранную машину пересчитываем участками и подбираем тип ТС уже
    // под пик. Без этого забор, который выходит в хабе, тянул бы за собой лишние
    // машины.
    const asc = [...vehicles].sort((a, b) => a.capacity - b.capacity);
    for (const truck of packLegs(items, vehicles, dir.splitMode)) {
      const mine = dirLegs.filter((l) => truck.legIds.includes(l.id));
      const peak = peakLoad(mine);
      const fit = asc.find((v) => v.capacity >= peak) ?? asc[asc.length - 1];
      const pickups = mine.map((l) => l.plannedPickup).filter(Boolean) as Date[];
      const dropoffs = mine.map((l) => l.plannedDropoff).filter(Boolean) as Date[];
      trips.push({
        ...truck,
        vehicleTypeCode: fit.code,
        capacity: fit.capacity,
        pallets: peak,
        overload: peak > fit.capacity,
        pickupLegs: truck.legIds.filter((id) => pickupLegIds.has(id)).length,
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
    const dir = await prisma.direction.findUnique({
      where: { id: t.directionId },
      select: { originId: true, destinationId: true, distanceKm: true },
    });
    if (!dir?.originId || !dir?.destinationId) continue; // без точек рейс не создать

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
    // (направление/пара точек), что и подбор машины. Раньше автоплан оставлял
    // actualCost пустым, и рейсы шли без денег. На дату выезда, иначе на день плана.
    const costDate = t.plannedDeparture ?? new Date(dateISO.slice(0, 10) + 'T00:00:00.000Z');
    const actualCost = await activeCarrierTripCost(
      { id: t.directionId, originId: dir.originId, destinationId: dir.destinationId, distanceKm: dir.distanceKm != null ? Number(dir.distanceKm) : null },
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
        originId: dir.originId,
        destinationId: dir.destinationId,
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
