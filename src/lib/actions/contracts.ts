'use server';

import { prisma } from '@/lib/prisma';
import { serialize } from '@/lib/serialize';
import { requireAuth, requirePermission, getActorId } from '@/lib/authz';
import { revalidatePath } from 'next/cache';

const W = 'references.write';

// ============ CustomerContract ============
export async function getCustomerContracts() {
  await requireAuth();
  return serialize(await prisma.customerContract.findMany({ include: { customer: true }, orderBy: { validFrom: 'desc' } }));
}
export async function createCustomerContract(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.customerContract.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/customer-contracts');
  return r;
}
export async function updateCustomerContract(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.customerContract.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/customer-contracts');
  return r;
}
export async function deleteCustomerContract(id: string) {
  await requirePermission(W);
  await prisma.customerContract.delete({ where: { id } });
  revalidatePath('/references/customer-contracts');
}

// ============ CustomerContractMember (группы компаний) ============
export async function addContractMember(contractId: string, customerId: string) {
  await requirePermission(W);
  await prisma.customerContractMember.upsert({
    where: { contractId_customerId: { contractId, customerId } },
    update: {},
    create: { contractId, customerId },
  });
  revalidatePath(`/references/customer-contracts/${contractId}`);
}

export async function removeContractMember(contractId: string, customerId: string) {
  await requirePermission(W);
  await prisma.customerContractMember.delete({ where: { contractId_customerId: { contractId, customerId } } });
  revalidatePath(`/references/customer-contracts/${contractId}`);
}

// Найти незалинкованные заявки-"сиблинги" по той же дате доставки + точке выгрузки из той же группы
export async function findGroupSiblings(requestId: string) {
  await requireAuth();
  const req = await prisma.customerRequest.findUnique({
    where: { id: requestId },
    select: { customerId: true, deliveryDate: true, deliveryLocationId: true, parentRequestId: true },
  });
  if (!req?.deliveryDate || !req?.deliveryLocationId) return [];

  // Контракты, где этот клиент — основной или член группы
  const memberContracts = await prisma.customerContractMember.findMany({
    where: { customerId: req.customerId },
    select: { contractId: true },
  });
  const mainContracts = await prisma.customerContract.findMany({
    where: { customerId: req.customerId },
    select: { id: true },
  });
  const contractIds = Array.from(new Set([
    ...memberContracts.map(m => m.contractId),
    ...mainContracts.map(c => c.id),
  ]));
  if (!contractIds.length) return [];

  // Все клиенты из этих договоров
  const groupContracts = await prisma.customerContract.findMany({
    where: { id: { in: contractIds } },
    include: { members: { select: { customerId: true } } },
  });
  const groupCustomerIds = new Set<string>();
  groupContracts.forEach(c => {
    groupCustomerIds.add(c.customerId);
    c.members.forEach(m => groupCustomerIds.add(m.customerId));
  });
  groupCustomerIds.delete(req.customerId);
  if (!groupCustomerIds.size) return [];

  const dayStart = new Date(req.deliveryDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  return serialize(await prisma.customerRequest.findMany({
    where: {
      id: { not: requestId },
      customerId: { in: Array.from(groupCustomerIds) },
      deliveryDate: { gte: dayStart, lt: dayEnd },
      deliveryLocationId: req.deliveryLocationId,
      parentRequestId: null,
    },
    select: { id: true, requestNumber: true, customerId: true, customer: { select: { name: true } }, requestedPallets: true },
  }));
}

export async function linkGroupRequests(requestId: string, parentId: string) {
  await requirePermission(W);
  const actor = await getActorId();
  await prisma.customerRequest.update({
    where: { id: requestId },
    data: { parentRequestId: parentId, updatedById: actor },
  });
}

export async function unlinkGroupRequest(requestId: string) {
  await requirePermission(W);
  const actor = await getActorId();
  await prisma.customerRequest.update({
    where: { id: requestId },
    data: { parentRequestId: null, updatedById: actor },
  });
}

// ============ CustomerContract detail ============
export async function getCustomerContractDetail(id: string) {
  await requireAuth();
  return serialize(await prisma.customerContract.findUnique({
    where: { id },
    include: {
      customer: true,
      members: { include: { customer: true } },
      tariffs: {
        include: {
          route: { include: { origin: true, destination: true } },
          tiers: { orderBy: { vehicleTypeCode: 'asc' } },
        },
        orderBy: { validFrom: 'desc' },
      },
    },
  }));
}

export async function updateCustomerContractNotes(id: string, notes: string) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.customerContract.update({ where: { id }, data: { notes, updatedById: actor } });
  revalidatePath(`/references/customer-contracts/${id}`);
  return r;
}

export async function findOrCreateRoute(originId: string, destinationId: string) {
  await requirePermission(W);
  const existing = await prisma.route.findFirst({ where: { originId, destinationId } });
  if (existing) return existing;
  const origin = await prisma.location.findUnique({ where: { id: originId }, select: { name: true } });
  const dest = await prisma.location.findUnique({ where: { id: destinationId }, select: { name: true } });
  const code = `${(origin?.name || originId).slice(0, 6).toUpperCase().replace(/\s/g, '')}-${(dest?.name || destinationId).slice(0, 6).toUpperCase().replace(/\s/g, '')}`.slice(0, 20);
  const unique = `${code}-${Date.now().toString(36)}`;
  return prisma.route.create({ data: { code: unique, originId, destinationId, routeType: 'DIRECT' } });
}

export async function createContractTariff(contractId: string, data: {
  originId: string; destinationId: string; tariffType: 'PER_PALLET' | 'PER_TRIP';
  validFrom: string; pricePerPallet?: number | null; vatRatePct: number;
  tiers?: { vehicleTypeCode: string; price: number }[];
}) {
  await requirePermission(W);
  const actor = await getActorId();
  const route = await findOrCreateRoute(data.originId, data.destinationId);
  const toNet = (v: number) => data.vatRatePct > 0 ? Math.round(v / (1 + data.vatRatePct / 100) * 100) / 100 : v;
  const r = await prisma.tariff.create({
    data: {
      customerContractId: contractId,
      routeId: route.id,
      tariffType: data.tariffType,
      validFrom: new Date(data.validFrom),
      pricePerPallet: data.tariffType === 'PER_PALLET' && data.pricePerPallet != null ? toNet(data.pricePerPallet) : null,
      createdById: actor, updatedById: actor,
      tiers: data.tariffType === 'PER_TRIP' && data.tiers?.length
        ? { create: data.tiers.map(t => ({ vehicleTypeCode: t.vehicleTypeCode, price: toNet(t.price) })) }
        : undefined,
    },
  });
  revalidatePath(`/references/customer-contracts/${contractId}`);
  return r;
}

export async function updateContractTariff(tariffId: string, contractId: string, data: {
  originId: string; destinationId: string; tariffType: 'PER_PALLET' | 'PER_TRIP';
  validFrom: string; pricePerPallet?: number | null; vatRatePct: number;
  tiers?: { vehicleTypeCode: string; price: number }[];
}) {
  await requirePermission(W);
  const actor = await getActorId();
  const route = await findOrCreateRoute(data.originId, data.destinationId);
  const toNet = (v: number) => data.vatRatePct > 0 ? Math.round(v / (1 + data.vatRatePct / 100) * 100) / 100 : v;
  await prisma.tariffTier.deleteMany({ where: { tariffId } });
  const r = await prisma.tariff.update({
    where: { id: tariffId },
    data: {
      routeId: route.id,
      tariffType: data.tariffType,
      validFrom: new Date(data.validFrom),
      pricePerPallet: data.tariffType === 'PER_PALLET' && data.pricePerPallet != null ? toNet(data.pricePerPallet) : null,
      updatedById: actor,
      tiers: data.tariffType === 'PER_TRIP' && data.tiers?.length
        ? { create: data.tiers.map(t => ({ vehicleTypeCode: t.vehicleTypeCode, price: toNet(t.price) })) }
        : undefined,
    },
  });
  revalidatePath(`/references/customer-contracts/${contractId}`);
  return r;
}

export async function deleteContractTariff(tariffId: string, contractId: string) {
  await requirePermission(W);
  await prisma.tariff.delete({ where: { id: tariffId } });
  revalidatePath(`/references/customer-contracts/${contractId}`);
}

// ============ CarrierContract ============
export async function getCarrierContracts() {
  await requireAuth();
  return serialize(await prisma.carrierContract.findMany({ include: { carrier: true }, orderBy: { validFrom: 'desc' } }));
}
export async function createCarrierContract(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.carrierContract.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/carrier-contracts');
  return r;
}
export async function updateCarrierContract(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.carrierContract.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/carrier-contracts');
  return r;
}
export async function deleteCarrierContract(id: string) {
  await requirePermission(W);
  await prisma.carrierContract.delete({ where: { id } });
  revalidatePath('/references/carrier-contracts');
}

// ============ Tariff (полиморфный: один из contract id) ============
export async function getTariffs() {
  await requireAuth();
  return serialize(await prisma.tariff.findMany({
    include: {
      customerContract: { include: { customer: true } },
      carrierContract: { include: { carrier: true } },
      route: true,
      vehicleType: true,
    },
    orderBy: { validFrom: 'desc' },
  }));
}
function normalizeTariff(data: any) {
  // гарантируем «ровно один контракт»
  const { contractSide, ...rest } = data;
  if (contractSide === 'CUSTOMER') {
    return { ...rest, customerContractId: rest.customerContractId, carrierContractId: null };
  }
  if (contractSide === 'CARRIER') {
    return { ...rest, carrierContractId: rest.carrierContractId, customerContractId: null };
  }
  return rest;
}
export async function createTariff(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const payload = normalizeTariff(data);
  const r = await prisma.tariff.create({ data: { ...payload, createdById: actor, updatedById: actor } });
  revalidatePath('/references/tariffs');
  return r;
}
export async function updateTariff(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const payload = normalizeTariff(data);
  const r = await prisma.tariff.update({ where: { id }, data: { ...payload, updatedById: actor } });
  revalidatePath('/references/tariffs');
  return r;
}
export async function deleteTariff(id: string) {
  await requirePermission(W);
  await prisma.tariff.delete({ where: { id } });
  revalidatePath('/references/tariffs');
}

// ============ MarketPrice ============
export async function getMarketPrices() {
  await requireAuth();
  return serialize(await prisma.marketPrice.findMany({ include: { route: true, vehicleType: true }, orderBy: { validFrom: 'desc' } }));
}
export async function createMarketPrice(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.marketPrice.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/market-prices');
  return r;
}
export async function updateMarketPrice(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.marketPrice.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/market-prices');
  return r;
}
export async function deleteMarketPrice(id: string) {
  await requirePermission(W);
  await prisma.marketPrice.delete({ where: { id } });
  revalidatePath('/references/market-prices');
}

// ============ Option-getters ============
export async function getCustomerContractOptions() {
  await requireAuth();
  const rows = await prisma.customerContract.findMany({ where: { isActive: true }, include: { customer: true }, orderBy: { validFrom: 'desc' } });
  return rows.map((c) => ({ value: c.id, label: `${c.contractNumber} — ${c.customer.name}` }));
}
export async function getCarrierContractOptions() {
  await requireAuth();
  const rows = await prisma.carrierContract.findMany({ where: { isActive: true }, include: { carrier: true }, orderBy: { validFrom: 'desc' } });
  return rows.map((c) => ({ value: c.id, label: `${c.contractNumber} — ${c.carrier.name}` }));
}

// Ставка НДС выбранного договора (для формы тарифа): side = CUSTOMER | CARRIER
export async function getContractVat(side: 'CUSTOMER' | 'CARRIER', contractId: string): Promise<number> {
  await requireAuth();
  if (!contractId) return 0;
  if (side === 'CARRIER') {
    const c = await prisma.carrierContract.findUnique({ where: { id: contractId }, select: { vatRatePct: true } });
    return c?.vatRatePct ?? 0;
  }
  const c = await prisma.customerContract.findUnique({ where: { id: contractId }, select: { vatRatePct: true } });
  return c?.vatRatePct ?? 0;
}
