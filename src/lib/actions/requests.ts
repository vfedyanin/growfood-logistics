'use server';

import { prisma } from '@/lib/prisma';
import { serialize } from '@/lib/serialize';
import { requireAuth, requireRole, getActorId, RoleName } from '@/lib/authz';
import { revalidatePath } from 'next/cache';

type RequestStatus = 'NEW' | 'CONFIRMED' | 'IN_PLANNING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

const W: RoleName[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];
const W_FIN: RoleName[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER', 'ACCOUNTANT'];

const reqInclude = {
  customer: true, payer: true, vertical: true, shipper: true, consignee: true,
  pickupLocation: true, deliveryLocation: true,
};
const legInclude = { pickupLocation: true, dropoffLocation: true, tripCargoUnit: { include: { trip: true } } };
const cargoInclude = { consignee: true, consigneeLocation: true, legs: { include: legInclude, orderBy: { legOrder: 'asc' as const } } };

const num = (v: any) => (v != null ? Number(v) : 0);
const legFinal = (l: any) => (l.cost != null || l.discount != null ? num(l.cost) - num(l.discount) : null);

function legCreateData(l: any, order: number, actor: string | null) {
  return {
    legOrder: order,
    pickupLocationId: l.pickupLocationId || null,
    dropoffLocationId: l.dropoffLocationId || null,
    plannedPickup: l.plannedPickup ? new Date(l.plannedPickup) : null,
    plannedPickupTo: l.plannedPickupTo || null,
    plannedDropoff: l.plannedDropoff ? new Date(l.plannedDropoff) : null,
    plannedDropoffTo: l.plannedDropoffTo || null,
    cost: l.cost ?? null,
    discount: l.discount ?? null,
    finalCost: legFinal(l),
    createdById: actor,
    updatedById: actor,
  };
}
function cargoFinal(c: any): number | null {
  if (c.pricingMode === 'LEG') return (c.legs || []).reduce((s: number, l: any) => s + num(legFinal(l)), 0);
  return c.cost != null || c.discount != null ? num(c.cost) - num(c.discount) : null;
}
function cargoScalar(c: any, actor: string | null) {
  const mode = c.pricingMode || 'CARGO';
  return {
    consigneeId: c.consigneeId || null,
    consigneeLocationId: c.consigneeLocationId || null,
    unitType: c.unitType || 'PALLET',
    pallets: c.pallets ?? null,
    traysCount: c.traysCount ?? null,
    weightKg: c.weightKg ?? null,
    productCategory: c.productCategory || null,
    tempRegime: c.tempRegime || null,
    pricingMode: mode,
    cost: mode === 'CARGO' ? (c.cost ?? null) : null,
    discount: mode === 'CARGO' ? (c.discount ?? null) : null,
    finalCost: cargoFinal(c),
    notes: c.notes || null,
    createdById: actor,
    updatedById: actor,
  };
}
function cargoCreateData(c: any, actor: string | null) {
  return {
    ...cargoScalar(c, actor),
    legs: { create: (c.legs || []).map((l: any, i: number) => legCreateData(l, i + 1, actor)) },
  };
}
async function recomputeCargoFinal(cargoId: string) {
  const c = await prisma.requestCargo.findUnique({ where: { id: cargoId }, include: { legs: true } });
  if (!c) return;
  const final = c.pricingMode === 'LEG'
    ? c.legs.reduce((s, l) => s + num(l.finalCost), 0)
    : (c.cost != null || c.discount != null ? num(c.cost) - num(c.discount) : null);
  await prisma.requestCargo.update({ where: { id: cargoId }, data: { finalCost: final } });
}

// ============ List / Get ============
export async function getRequests(filters?: { status?: RequestStatus; customerId?: string; dateFrom?: string; dateTo?: string }) {
  await requireAuth();
  const where: any = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.customerId) where.customerId = filters.customerId;
  if (filters?.dateFrom || filters?.dateTo) {
    where.requestDate = {};
    if (filters.dateFrom) where.requestDate.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.requestDate.lte = new Date(filters.dateTo);
  }
  const result = await prisma.customerRequest.findMany({
    where,
    include: { ...reqInclude, cargoes: { include: cargoInclude }, invoices: true },
    orderBy: { createdAt: 'desc' },
  });
  return serialize(result);
}

export async function getRequest(id: string) {
  await requireAuth();
  const result = await prisma.customerRequest.findUnique({
    where: { id },
    include: { ...reqInclude, cargoes: { include: cargoInclude, orderBy: { createdAt: 'asc' } }, invoices: true },
  });
  return serialize(result);
}

export async function getCustomerVerticalCode(customerId: string) {
  await requireAuth();
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { verticalCode: true } });
  return c?.verticalCode || null;
}

async function nextNumber(prefix: string): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const full = `${prefix}-${ymd}-`;
  const last = await prisma.customerRequest.findFirst({ where: { requestNumber: { startsWith: full } }, orderBy: { requestNumber: 'desc' } });
  let n = 1;
  if (last) { const m = last.requestNumber.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  return `${full}${String(n).padStart(3, '0')}`;
}

// ============ Create / Update / Delete ============
export async function createRequest(input: any) {
  await requireRole(W);
  const actor = await getActorId();
  const { cargoes = [], ...data } = input;
  const requestNumber = await nextNumber('REQ');
  const r = await prisma.customerRequest.create({
    data: {
      ...data,
      requestNumber,
      requestDate: data.requestDate ? new Date(data.requestDate) : new Date(),
      requestedDate: data.requestedDate ? new Date(data.requestedDate) : null,
      pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
      status: 'NEW',
      createdById: actor,
      updatedById: actor,
      cargoes: cargoes.length ? { create: cargoes.map((c: any) => cargoCreateData(c, actor)) } : undefined,
    },
  });
  revalidatePath('/requests');
  return r;
}

export async function updateRequest(id: string, input: any) {
  await requireRole(W);
  const actor = await getActorId();
  const { cargoes, ...data } = input; // грузы редактируются отдельно
  await prisma.customerRequest.update({
    where: { id },
    data: {
      ...data,
      requestDate: data.requestDate ? new Date(data.requestDate) : null,
      requestedDate: data.requestedDate ? new Date(data.requestedDate) : null,
      pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
      updatedById: actor,
    },
  });
  revalidatePath('/requests');
}

export async function deleteRequest(id: string) {
  await requireRole(W);
  await prisma.invoice.deleteMany({ where: { requestId: id } });
  await prisma.customerRequest.delete({ where: { id } }); // cascade cargoes → legs
  revalidatePath('/requests');
}

// ============ Грузы заявки (+ плечи) ============
export async function addRequestCargo(requestId: string, data: any) {
  await requireRole(W);
  const actor = await getActorId();
  const c = await prisma.requestCargo.create({ data: { ...cargoCreateData(data, actor), requestId } });
  await recomputeCargoFinal(c.id);
  revalidatePath('/requests');
}
export async function updateRequestCargo(id: string, data: any) {
  await requireRole(W);
  const actor = await getActorId();
  const { legs = [], ...rest } = data;
  const sc = cargoScalar(rest, actor);
  delete (sc as any).createdById;
  await prisma.requestCargo.update({ where: { id }, data: sc });
  // Плечи: пересоздаём только непривязанные к рейсу; привязанные сохраняем
  await prisma.requestCargoLeg.deleteMany({ where: { requestCargoId: id, tripCargoUnitId: null } });
  if (legs.length) {
    const existingMax = await prisma.requestCargoLeg.aggregate({ where: { requestCargoId: id }, _max: { legOrder: true } });
    let order = (existingMax._max.legOrder || 0);
    for (const l of legs) { order += 1; await prisma.requestCargoLeg.create({ data: { ...legCreateData(l, order, actor), requestCargoId: id } }); }
  }
  await recomputeCargoFinal(id);
  revalidatePath('/requests');
  revalidatePath('/operations/cargo');
}
export async function removeRequestCargo(id: string) {
  await requireRole(W);
  const assigned = await prisma.requestCargoLeg.count({ where: { requestCargoId: id, tripCargoUnitId: { not: null } } });
  if (assigned > 0) throw new Error('У груза есть плечи, привязанные к рейсам — сначала отвяжите их');
  await prisma.requestCargo.delete({ where: { id } }); // cascade legs
  revalidatePath('/requests');
  revalidatePath('/operations/cargo');
}

// ============ Счёт из заявки ============
export async function createInvoiceFromRequest(requestId: string) {
  await requireRole(W_FIN);
  const actor = await getActorId();
  const req = await prisma.customerRequest.findUnique({ where: { id: requestId }, include: { cargoes: true } });
  if (!req) throw new Error('Заявка не найдена');
  const amount = req.cargoes.reduce((s, c) => s + num(c.finalCost), 0);
  if (amount <= 0) throw new Error('Сумма итоговых стоимостей грузов равна нулю');
  const invoiceNumber = await nextNumber('INV');
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber, invoiceDate: new Date(), direction: 'OUTGOING',
      customerId: req.payerId || req.customerId, requestId: req.id,
      amount, total: amount, status: 'ISSUED', createdById: actor, updatedById: actor,
    },
  });
  revalidatePath('/requests');
  return { invoiceNumber: inv.invoiceNumber, amount };
}

// ============ Плечо → рейс ============
function tcuFromCargo(req: any, cargo: any, actor: string | null) {
  return {
    verticalCode: req.verticalCode || null,
    customerId: cargo.consigneeId || req.consigneeId || req.customerId,
    shipperId: req.shipperId || null,
    unitType: cargo.unitType || 'PALLET',
    pallets: cargo.pallets ?? null,
    traysCount: cargo.traysCount ?? null,
    weightKg: cargo.weightKg ?? null,
    productCategory: cargo.productCategory || null,
    tempRegime: cargo.tempRegime || null,
    requestId: req.id,
    createdById: actor,
    updatedById: actor,
  };
}

export async function addCargoLegToTrip(legId: string, tripId: string) {
  await requireRole(W);
  const actor = await getActorId();
  const leg = await prisma.requestCargoLeg.findUnique({ where: { id: legId }, include: { cargo: { include: { request: true } } } });
  if (!leg) throw new Error('Плечо груза не найдено');
  if (leg.tripCargoUnitId) throw new Error('Плечо уже привязано к рейсу');
  const tcu = await prisma.tripCargoUnit.create({ data: { ...tcuFromCargo(leg.cargo.request, leg.cargo, actor), tripId } });
  await prisma.requestCargoLeg.update({ where: { id: legId }, data: { tripCargoUnitId: tcu.id, updatedById: actor } });
  revalidatePath('/requests'); revalidatePath('/operations/trips'); revalidatePath('/operations/cargo');
}

async function nextTripNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `TRIP-${ymd}-`;
  const last = await prisma.trip.findFirst({ where: { tripNumber: { startsWith: prefix } }, orderBy: { tripNumber: 'desc' } });
  let n = 1;
  if (last) { const m = last.tripNumber.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// Создаёт рейс и переносит ВСЕ непривязанные плечи заявки в него
export async function createTripFromRequest(requestId: string) {
  await requireRole(W);
  const actor = await getActorId();
  const req = await prisma.customerRequest.findUnique({
    where: { id: requestId },
    include: { cargoes: { include: { legs: true } } },
  });
  if (!req) throw new Error('Заявка не найдена');
  const legs: any[] = [];
  for (const c of req.cargoes) for (const l of c.legs) if (!l.tripCargoUnitId) legs.push({ leg: l, cargo: c });
  if (!legs.length) throw new Error('Нет непривязанных плеч для переноса в рейс');
  const originId = req.pickupLocationId || legs[0].leg.pickupLocationId;
  const destinationId = req.deliveryLocationId || legs[legs.length - 1].leg.dropoffLocationId;
  if (!originId || !destinationId) throw new Error('Не удалось определить точки маршрута (укажите забор/выгрузку в заявке или плечах)');
  const tripType = req.verticalCode === 'LAAS' ? 'LAAS' : 'OWN';
  const tripNumber = await nextTripNumber();
  const trip = await prisma.trip.create({
    data: {
      tripNumber, tripType, verticalCode: req.verticalCode || null, originId, destinationId,
      shipperId: req.shipperId || null, consigneeId: req.consigneeId || null, payerId: req.payerId || null,
      status: 'DRAFT', createdById: actor, updatedById: actor,
    },
  });
  for (const { leg, cargo } of legs) {
    const tcu = await prisma.tripCargoUnit.create({ data: { ...tcuFromCargo(req, cargo, actor), tripId: trip.id } });
    await prisma.requestCargoLeg.update({ where: { id: leg.id }, data: { tripCargoUnitId: tcu.id, updatedById: actor } });
  }
  revalidatePath('/requests'); revalidatePath('/operations/trips');
  return { tripNumber, tripId: trip.id };
}

// Создаёт рейс из одного плеча груза
export async function createTripFromLeg(legId: string) {
  await requireRole(W);
  const actor = await getActorId();
  const leg = await prisma.requestCargoLeg.findUnique({
    where: { id: legId },
    include: { cargo: { include: { request: true } } },
  });
  if (!leg) throw new Error('Плечо груза не найдено');
  if (leg.tripCargoUnitId) throw new Error('Плечо уже привязано к рейсу');
  const req = leg.cargo.request;
  const originId = leg.pickupLocationId || req.pickupLocationId;
  const destinationId = leg.dropoffLocationId || req.deliveryLocationId;
  if (!originId || !destinationId) throw new Error('Не удалось определить точки маршрута (укажите забор/выгрузку в плече)');
  const tripType = req.verticalCode === 'LAAS' ? 'LAAS' : 'OWN';
  const tripNumber = await nextTripNumber();
  const trip = await prisma.trip.create({
    data: {
      tripNumber, tripType, verticalCode: req.verticalCode || null, originId, destinationId,
      plannedDeparture: leg.plannedPickup || null, plannedArrival: leg.plannedDropoff || null,
      shipperId: req.shipperId || null, consigneeId: req.consigneeId || null, payerId: req.payerId || null,
      status: 'DRAFT', createdById: actor, updatedById: actor,
    },
  });
  const tcu = await prisma.tripCargoUnit.create({ data: { ...tcuFromCargo(req, leg.cargo, actor), tripId: trip.id } });
  await prisma.requestCargoLeg.update({ where: { id: legId }, data: { tripCargoUnitId: tcu.id, updatedById: actor } });
  revalidatePath('/requests'); revalidatePath('/operations/trips'); revalidatePath('/operations/cargo');
  return { tripNumber, tripId: trip.id };
}

const tripDateStr = (dt: Date | null) =>
  dt ? `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}` : 'без даты';

export async function getAssignableTripOptions() {
  await requireAuth();
  const rows = await prisma.trip.findMany({
    where: { status: { in: ['DRAFT', 'PLANNED', 'IN_TRANSIT'] } },
    include: { origin: true, destination: true, carrier: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((t) => ({
    value: t.id,
    label: `${t.tripNumber} · ${tripDateStr(t.plannedDeparture)} · ${t.carrier?.name || 'без перевозчика'} (${t.origin?.name || '—'} → ${t.destination?.name || '—'})`,
  }));
}

export async function getAllTripOptions() {
  await requireAuth();
  const rows = await prisma.trip.findMany({ include: { carrier: true }, orderBy: { createdAt: 'desc' } });
  return rows.map((t) => ({ value: t.id, label: `${t.tripNumber} · ${tripDateStr(t.plannedDeparture)} · ${t.carrier?.name || 'без перевозчика'}` }));
}

// ============ Плечи грузов (страница «Груз») ============
export async function getAllCargoLegs(filters?: { tripId?: string; unassigned?: boolean; customerId?: string; pickupFrom?: string; pickupTo?: string }) {
  await requireAuth();
  const where: any = {};
  if (filters?.unassigned) where.tripCargoUnitId = null;
  else if (filters?.tripId) where.tripCargoUnit = { tripId: filters.tripId };
  if (filters?.customerId) where.cargo = { request: { customerId: filters.customerId } };
  if (filters?.pickupFrom || filters?.pickupTo) {
    where.plannedPickup = {};
    if (filters.pickupFrom) where.plannedPickup.gte = new Date(filters.pickupFrom);
    if (filters.pickupTo) where.plannedPickup.lte = new Date(filters.pickupTo);
  }
  return prisma.requestCargoLeg.findMany({
    where,
    include: {
      pickupLocation: true,
      dropoffLocation: true,
      tripCargoUnit: { include: { trip: true } },
      cargo: { include: { consignee: true, request: { include: { customer: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// Непривязанные плечи — для привязки из формы/карточки рейса
export async function getUnassignedCargoLegOptions() {
  await requireAuth();
  const rows = await prisma.requestCargoLeg.findMany({
    where: { tripCargoUnitId: null },
    include: { pickupLocation: true, dropoffLocation: true, cargo: { include: { request: { include: { customer: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((l) => ({
    value: l.id,
    label: `${l.cargo.request.requestNumber} · ${l.cargo.request.customer?.name || ''} · ${l.pickupLocation?.name || '—'}→${l.dropoffLocation?.name || '—'} · ${l.cargo.pallets ?? '—'}пал/${l.cargo.traysCount ?? '—'}лот`,
  }));
}

export async function getCargoLegDates(legId: string) {
  await requireAuth();
  const leg = await prisma.requestCargoLeg.findUnique({
    where: { id: legId },
    select: { plannedPickup: true, plannedDropoff: true },
  });
  return leg;
}

export async function unassignCargoLeg(legId: string) {
  await requireRole(W);
  const actor = await getActorId();
  const l = await prisma.requestCargoLeg.findUnique({ where: { id: legId } });
  if (!l?.tripCargoUnitId) return;
  const tcuId = l.tripCargoUnitId;
  await prisma.requestCargoLeg.update({ where: { id: legId }, data: { tripCargoUnitId: null, updatedById: actor } });
  await prisma.tripCargoUnit.delete({ where: { id: tcuId } });
  revalidatePath('/operations/cargo'); revalidatePath('/operations/trips');
}

// ============ Статусы ============
const ALLOWED: Record<RequestStatus, RequestStatus[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PLANNING', 'CANCELLED'],
  IN_PLANNING: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};
export async function changeRequestStatus(id: string, to: RequestStatus) {
  await requireRole(W);
  const r = await prisma.customerRequest.findUnique({ where: { id } });
  if (!r) throw new Error('Заявка не найдена');
  if (!ALLOWED[r.status as RequestStatus]?.includes(to)) throw new Error(`Недопустимый переход ${r.status} → ${to}`);
  const actor = await getActorId();
  await prisma.customerRequest.update({ where: { id }, data: { status: to, updatedById: actor } });
  revalidatePath('/requests');
}
