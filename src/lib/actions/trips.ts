'use server';

import { prisma } from '@/lib/prisma';
import { serialize } from '@/lib/serialize';
import { requireAuth, requireRole, requirePermission, getActorId, getCurrentUser, tripTypeScopeFor, canEditTripType, RoleName } from '@/lib/authz';
import { revalidatePath } from 'next/cache';

type TripStatus = 'DRAFT' | 'PLANNED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

const tripInclude = {
  origin: true,
  destination: true,
  route: true,
  vehicle: { include: { vehicleType: true } },
  vehicleType: true,
  driver: true,
  carrier: true,
  vertical: true,
  shipper: true,
  consignee: true,
  payer: true,
};

// ============ List / Get ============
export async function getTrips(filters?: {
  status?: TripStatus;
  tripType?: 'OWN' | 'LAAS' | 'CONSOLIDATED';
  dateFrom?: string;
  dateTo?: string;
  carrierId?: string;
  shipperId?: string;
  consigneeId?: string;
  payerId?: string;
}) {
  const user = await requireAuth();
  const scope = tripTypeScopeFor(user);
  const where: any = { ...scope };
  if (filters?.status) where.status = filters.status;
  if (filters?.tripType) where.tripType = filters.tripType;
  if (filters?.carrierId) where.carrierId = filters.carrierId;
  if (filters?.shipperId) where.shipperId = filters.shipperId;
  if (filters?.consigneeId) where.consigneeId = filters.consigneeId;
  if (filters?.payerId) where.payerId = filters.payerId;
  if (filters?.dateFrom || filters?.dateTo) {
    where.plannedDeparture = {};
    if (filters.dateFrom) where.plannedDeparture.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.plannedDeparture.lte = new Date(filters.dateTo);
  }
  const result = await prisma.trip.findMany({
    where,
    include: { ...tripInclude, cargoUnits: { include: { requestCargoLeg: { include: { pickupLocation: true, dropoffLocation: true } } } } },
    orderBy: { plannedDeparture: 'desc' },
  });
  return serialize(result);
}

export async function getTrip(id: string) {
  await requireAuth();
  const result = await prisma.trip.findUnique({
    where: { id },
    include: {
      ...tripInclude,
      cargoUnits: {
        include: {
          vertical: true, customer: true, shipper: true, request: true,
          requestCargoLeg: { include: { pickupLocation: true, dropoffLocation: true } },
        },
      },
      qualityEvents: { orderBy: { createdAt: 'desc' } },
    },
  });
  return serialize(result);
}

// ============ tripNumber generator ============
async function nextTripNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `TRIP-${ymd}-`;
  const last = await prisma.trip.findFirst({
    where: { tripNumber: { startsWith: prefix } },
    orderBy: { tripNumber: 'desc' },
  });
  let n = 1;
  if (last) {
    const m = last.tripNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1]) + 1;
  }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ============ Create / Update / Delete ============
const TRIP_W: RoleName[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];

export async function createTrip(input: any) {
  const user = await requireRole(TRIP_W);
  const { cargoUnits = [], ...data } = input;
  if (!canEditTripType(user, data.tripType)) throw new Error('Нет прав на рейсы этого типа');
  const actor = await getActorId();
  const tripNumber = await nextTripNumber();
  const trip = await prisma.trip.create({
    data: {
      ...data,
      tripNumber,
      status: 'DRAFT',
      createdById: actor,
      updatedById: actor,
      cargoUnits: cargoUnits.length
        ? { create: cargoUnits.map((c: any) => ({ ...c, createdById: actor, updatedById: actor })) }
        : undefined,
    },
  });
  revalidatePath('/operations/trips');
  return trip;
}

export async function updateTrip(id: string, input: any) {
  const user = await requireRole(TRIP_W);
  const { cargoUnits, ...data } = input;
  const existing = await prisma.trip.findUnique({ where: { id } });
  if (!existing) throw new Error('Рейс не найден');
  if (!canEditTripType(user, (data.tripType ?? existing.tripType))) throw new Error('Нет прав на рейсы этого типа');
  const actor = await getActorId();

  await prisma.trip.update({ where: { id }, data: { ...data, updatedById: actor } });

  // Грузы НЕ затираем: добавляем только новые ручные грузы (привязка/удаление — точечно)
  if (Array.isArray(cargoUnits) && cargoUnits.length) {
    await prisma.tripCargoUnit.createMany({
      data: cargoUnits.map((c: any) => ({ ...c, tripId: id, createdById: actor, updatedById: actor })),
    });
  }
  await recalcAllocation(id);
  revalidatePath('/operations/trips');
  return prisma.trip.findUnique({ where: { id } });
}

export async function deleteTrip(id: string) {
  await requireRole(TRIP_W);
  await prisma.tripCargoUnit.deleteMany({ where: { tripId: id } });
  await prisma.qualityEvent.deleteMany({ where: { tripId: id } });
  await prisma.trip.delete({ where: { id } });
  revalidatePath('/operations/trips');
}

// ============ Аллокация стоимости по лоткам ============
export async function recalcAllocation(tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { cargoUnits: true } });
  if (!trip) return;
  const cost = trip.actualCost ? Number(trip.actualCost) : 0;
  const totalTrays = trip.cargoUnits.reduce((s, c) => s + (c.traysCount || 0), 0);
  for (const c of trip.cargoUnits) {
    const share = totalTrays > 0 ? (c.traysCount || 0) / totalTrays : 0;
    await prisma.tripCargoUnit.update({
      where: { id: c.id },
      data: {
        costSharePct: totalTrays > 0 ? share : null,
        allocatedCost: cost > 0 && totalTrays > 0 ? Number((cost * share).toFixed(2)) : null,
      },
    });
  }
}

// ============ State machine ============
const ALLOWED: Record<TripStatus, TripStatus[]> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PLANNED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
const ROLES_FOR: Record<string, RoleName[]> = {
  PLANNED: ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'],
  IN_TRANSIT: ['WAREHOUSE_OPERATOR', 'LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'],
  COMPLETED: ['RECEIVER_OPERATOR', 'LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'],
  CANCELLED: ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'],
};

function assertTransition(from: TripStatus, to: TripStatus) {
  if (!ALLOWED[from]?.includes(to)) throw new Error(`Недопустимый переход ${from} → ${to}`);
}
function assertRequiredForPlanned(t: any) {
  const need = ['originId', 'destinationId', 'plannedDeparture', 'plannedArrival', 'vehicleId', 'carrierId', 'shipperId', 'consigneeId', 'payerId'];
  const miss = need.filter((k) => !t[k]);
  if (miss.length) throw new Error('Для перевода в «Запланирован» заполните: ' + miss.join(', '));
}

export async function changeTripStatus(id: string, to: TripStatus) {
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new Error('Рейс не найден');
  assertTransition(trip.status as TripStatus, to);
  await requireRole(ROLES_FOR[to]);
  const user = await getCurrentUser();
  if (user && !canEditTripType(user, trip.tripType as any)) throw new Error('Нет прав на рейсы этого типа');

  if (to === 'PLANNED') assertRequiredForPlanned(trip);
  if (to === 'IN_TRANSIT' && !trip.actualDeparture) throw new Error('Сначала зафиксируйте фактическое отправление');
  if (to === 'COMPLETED' && (!trip.actualArrival || trip.actualPallets == null)) throw new Error('Сначала зафиксируйте приёмку (прибытие и факт. паллеты)');

  const actor = await getActorId();
  await prisma.trip.update({ where: { id }, data: { status: to, updatedById: actor } });
  if (to === 'COMPLETED') await recalcAllocation(id);
  revalidatePath('/operations/trips');
}

// Фиксация отправления (склад): ставит факт + переводит в IN_TRANSIT
export async function recordDeparture(id: string, data: { actualDeparture: string }) {
  await requireRole(['WAREHOUSE_OPERATOR', 'LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER']);
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new Error('Рейс не найден');
  if (trip.status !== 'PLANNED') throw new Error('Отправление можно зафиксировать только для запланированного рейса');
  const actor = await getActorId();
  await prisma.trip.update({ where: { id }, data: { actualDeparture: new Date(data.actualDeparture), status: 'IN_TRANSIT', updatedById: actor } });
  revalidatePath('/operations/trips');
}

// Фиксация приёмки (получатель): факт прибытия + паллеты → COMPLETED
export async function recordArrival(id: string, data: { actualArrival: string; actualPallets: number; actualWeightKg?: number; discrepancyNote?: string }) {
  await requireRole(['RECEIVER_OPERATOR', 'LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER']);
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new Error('Рейс не найден');
  if (trip.status !== 'IN_TRANSIT') throw new Error('Приёмку можно зафиксировать только для рейса в пути');
  const actor = await getActorId();
  const notes = data.discrepancyNote ? `${trip.notes ? trip.notes + '\n' : ''}Расхождение при приёмке: ${data.discrepancyNote}` : trip.notes;
  await prisma.trip.update({
    where: { id },
    data: {
      actualArrival: new Date(data.actualArrival),
      actualPallets: data.actualPallets,
      actualWeightKg: data.actualWeightKg ?? trip.actualWeightKg,
      notes,
      status: 'COMPLETED',
      updatedById: actor,
    },
  });
  await recalcAllocation(id);
  revalidatePath('/operations/trips');
}

// Быстрое завершение из списка: задаёт факт (отправление при необходимости + прибытие)
// и переводит рейс сразу в COMPLETED. Доступно из PLANNED и IN_TRANSIT.
export async function completeTripQuick(
  id: string,
  data: { actualDeparture?: string; actualArrival: string; actualPallets: number; actualWeightKg?: number },
) {
  const user = await requireRole(['RECEIVER_OPERATOR', 'WAREHOUSE_OPERATOR', 'LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER']);
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new Error('Рейс не найден');
  if (!canEditTripType(user, trip.tripType as any)) throw new Error('Нет прав на рейсы этого типа');
  if (trip.status !== 'PLANNED' && trip.status !== 'IN_TRANSIT') {
    throw new Error('Быстрое завершение доступно для запланированных рейсов и рейсов в пути');
  }
  if (data.actualPallets == null) throw new Error('Укажите фактическое кол-во паллет');

  const actualDeparture = data.actualDeparture ? new Date(data.actualDeparture) : trip.actualDeparture;
  if (!actualDeparture) throw new Error('Укажите фактическое отправление');

  const actor = await getActorId();
  await prisma.trip.update({
    where: { id },
    data: {
      actualDeparture,
      actualArrival: new Date(data.actualArrival),
      actualPallets: data.actualPallets,
      actualWeightKg: data.actualWeightKg ?? trip.actualWeightKg,
      status: 'COMPLETED',
      updatedById: actor,
    },
  });
  await recalcAllocation(id);
  revalidatePath('/operations/trips');
}

// ============ Грузы рейса ============
export async function addTripCargoUnit(tripId: string, data: any) {
  await requirePermission('cargo.write');
  const actor = await getActorId();
  await prisma.tripCargoUnit.create({ data: { ...data, tripId, createdById: actor, updatedById: actor } });
  await recalcAllocation(tripId);
  revalidatePath('/operations/trips');
}
export async function updateTripCargoUnit(id: string, tripId: string, data: any) {
  await requirePermission('cargo.write');
  const actor = await getActorId();
  await prisma.tripCargoUnit.update({ where: { id }, data: { ...data, updatedById: actor } });
  await recalcAllocation(tripId);
  revalidatePath('/operations/trips');
}
export async function removeTripCargoUnit(id: string, tripId: string) {
  await requirePermission('cargo.write');
  await prisma.tripCargoUnit.delete({ where: { id } });
  await recalcAllocation(tripId);
  revalidatePath('/operations/trips');
}

// ============ События качества ============
export async function addQualityEvent(tripId: string, data: any) {
  await requirePermission('quality.write');
  const actor = await getActorId();
  await prisma.qualityEvent.create({
    data: {
      ...data,
      tripId,
      eventTime: data.eventTime ? new Date(data.eventTime) : null,
      reportedById: actor,
      createdById: actor,
      updatedById: actor,
    },
  });
  revalidatePath('/operations/trips');
}

// ============ Экономика рейса: себестоимость из тарифа перевозчика ============
export async function calculateTripEconomics(tripId: string) {
  await requireRole(TRIP_W);
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { route: true, vehicle: { include: { vehicleType: true } }, cargoUnits: { select: { pallets: true } } },
  });
  if (!trip) throw new Error('Рейс не найден');
  if (!trip.carrierId) throw new Error('У рейса не указан перевозчик');
  const vtCode = trip.vehicle?.vehicleTypeCode;
  if (!vtCode) throw new Error('У рейса не указано ТС — нужен тип ТС для подбора тарифа');

  const date = trip.plannedDeparture || trip.actualDeparture || new Date();
  const where: any = {
    carrierContract: { carrierId: trip.carrierId },
    vehicleTypeCode: vtCode,
    validFrom: { lte: date },
    AND: [{ OR: [{ validTo: null }, { validTo: { gte: date } }] }],
  };
  if (trip.routeId) where.AND.push({ OR: [{ routeId: trip.routeId }, { routeId: null }] });

  const tariffs = await prisma.tariff.findMany({ where, orderBy: { validFrom: 'desc' } });
  // приоритет: тариф под конкретный маршрут, затем «любой маршрут»
  const chosen = (trip.routeId && tariffs.find((t) => t.routeId === trip.routeId)) || tariffs.find((t) => t.routeId == null) || tariffs[0];
  if (!chosen) throw new Error('Не найден подходящий тариф перевозчика (договор/тип ТС/маршрут/дата)');

  const pallets = trip.actualPallets ?? trip.plannedPallets ?? trip.cargoUnits.reduce((s, c) => s + (c.pallets || 0), 0);
  const km = trip.route?.distanceKm ? Number(trip.route.distanceKm) : 0;

  let cost = 0;
  let basis = '';
  if (chosen.pricePerTrip != null) { cost = Number(chosen.pricePerTrip); basis = 'за рейс'; }
  else if (chosen.pricePerPallet != null) { cost = Number(chosen.pricePerPallet) * pallets; basis = `за паллету × ${pallets}`; }
  else if (chosen.pricePerKm != null) { cost = Number(chosen.pricePerKm) * km; basis = `за км × ${km}`; }
  else throw new Error('В подобранном тарифе не заданы цены');

  const actor = await getActorId();
  cost = Number(cost.toFixed(2));
  await prisma.trip.update({ where: { id: tripId }, data: { actualCost: cost, updatedById: actor } });
  await recalcAllocation(tripId);
  revalidatePath('/operations/trips');
  revalidatePath('/finance/trip-economics');
  return { cost, basis };
}

// Предрасчёт себестоимости по параметрам формы (без сохранения) — для кнопки «Рассчитать» в форме рейса
export async function previewTripEconomics(params: { carrierId?: string; vehicleId?: string; routeId?: string; plannedDeparture?: string; pallets?: number }) {
  await requireAuth();
  if (!params.carrierId) throw new Error('Укажите перевозчика');
  if (!params.vehicleId) throw new Error('Укажите ТС (нужен тип ТС для тарифа)');
  const vehicle = await prisma.vehicle.findUnique({ where: { id: params.vehicleId } });
  const vtCode = vehicle?.vehicleTypeCode;
  if (!vtCode) throw new Error('У выбранного ТС не задан тип');

  const date = params.plannedDeparture ? new Date(params.plannedDeparture) : new Date();
  let km = 0;
  if (params.routeId) { const route = await prisma.route.findUnique({ where: { id: params.routeId } }); km = route?.distanceKm ? Number(route.distanceKm) : 0; }

  const where: any = {
    carrierContract: { carrierId: params.carrierId },
    vehicleTypeCode: vtCode,
    validFrom: { lte: date },
    AND: [{ OR: [{ validTo: null }, { validTo: { gte: date } }] }],
  };
  if (params.routeId) where.AND.push({ OR: [{ routeId: params.routeId }, { routeId: null }] });

  const tariffs = await prisma.tariff.findMany({ where, orderBy: { validFrom: 'desc' } });
  const chosen = (params.routeId && tariffs.find((t) => t.routeId === params.routeId)) || tariffs.find((t) => t.routeId == null) || tariffs[0];
  if (!chosen) throw new Error('Не найден подходящий тариф перевозчика (договор/тип ТС/маршрут/дата)');

  const pallets = params.pallets || 0;
  let cost = 0;
  let basis = '';
  if (chosen.pricePerTrip != null) { cost = Number(chosen.pricePerTrip); basis = 'за рейс'; }
  else if (chosen.pricePerPallet != null) { cost = Number(chosen.pricePerPallet) * pallets; basis = `за паллету × ${pallets}`; }
  else if (chosen.pricePerKm != null) { cost = Number(chosen.pricePerKm) * km; basis = `за км × ${km}`; }
  else throw new Error('В подобранном тарифе не заданы цены');

  return { cost: Number(cost.toFixed(2)), basis };
}
