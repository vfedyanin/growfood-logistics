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
