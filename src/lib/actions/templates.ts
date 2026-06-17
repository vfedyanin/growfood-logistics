'use server';

import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, getActorId } from '@/lib/authz';
import { revalidatePath } from 'next/cache';

const W: any[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];

export async function getTripTemplates() {
  await requireAuth();
  return prisma.tripTemplate.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, updatedAt: true } });
}

export async function getTripTemplate(id: string) {
  await requireAuth();
  return prisma.tripTemplate.findUnique({ where: { id } });
}

export async function createTripTemplate(name: string, data: any) {
  await requireRole(W);
  const actor = await getActorId();
  const r = await prisma.tripTemplate.create({ data: { name, data, createdById: actor, updatedById: actor } });
  revalidatePath('/operations/trips');
  return r;
}

export async function updateTripTemplate(id: string, payload: { name?: string; data?: any }) {
  await requireRole(W);
  const actor = await getActorId();
  const r = await prisma.tripTemplate.update({ where: { id }, data: { ...payload, updatedById: actor } });
  revalidatePath('/operations/trips');
  return r;
}

export async function deleteTripTemplate(id: string) {
  await requireRole(W);
  await prisma.tripTemplate.delete({ where: { id } });
  revalidatePath('/operations/trips');
}

// ============ Enriched: шаблоны рейсов с именами ============
export async function getTripTemplatesFull() {
  await requireAuth();
  const templates = await prisma.tripTemplate.findMany({ orderBy: { name: 'asc' } });
  const carrierIds = Array.from(new Set(templates.map((t: any) => (t.data as any)?.carrierId).filter(Boolean)));
  const carriers = carrierIds.length
    ? await prisma.carrier.findMany({ where: { id: { in: carrierIds } }, select: { id: true, name: true } })
    : [];
  const carrierMap = Object.fromEntries(carriers.map((c) => [c.id, c.name]));
  return templates.map((t) => {
    const d = t.data as any;
    return { ...t, carrierName: carrierMap[d?.carrierId] ?? null };
  });
}

export async function getTripTemplateFull(id: string) {
  await requireAuth();
  const tpl = await prisma.tripTemplate.findUnique({ where: { id } });
  if (!tpl) return null;
  const d = tpl.data as any;
  const carrierIds = [d?.carrierId].filter(Boolean);
  const carriers = carrierIds.length
    ? await prisma.carrier.findMany({ where: { id: { in: carrierIds } }, select: { id: true, name: true } })
    : [];
  const carrierMap = Object.fromEntries(carriers.map((c) => [c.id, c.name]));
  return { ...tpl, carrierName: carrierMap[d?.carrierId] ?? null };
}

// ============ Шаблоны заявок ============
export async function getRequestTemplates() {
  await requireAuth();
  return prisma.requestTemplate.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, updatedAt: true } });
}
export async function getRequestTemplate(id: string) {
  await requireAuth();
  return prisma.requestTemplate.findUnique({ where: { id } });
}
export async function createRequestTemplate(name: string, data: any) {
  await requireRole(W);
  const actor = await getActorId();
  const r = await prisma.requestTemplate.create({ data: { name, data, createdById: actor, updatedById: actor } });
  revalidatePath('/requests');
  return r;
}
export async function updateRequestTemplate(id: string, payload: { name?: string; data?: any }) {
  await requireRole(W);
  const actor = await getActorId();
  const r = await prisma.requestTemplate.update({ where: { id }, data: { ...payload, updatedById: actor } });
  revalidatePath('/requests');
  return r;
}
export async function deleteRequestTemplate(id: string) {
  await requireRole(W);
  await prisma.requestTemplate.delete({ where: { id } });
  revalidatePath('/requests');
}

// ============ Enriched: шаблоны заявок с именами ============
export async function getRequestTemplatesFull() {
  await requireAuth();
  const templates = await prisma.requestTemplate.findMany({ orderBy: { name: 'asc' } });
  const customerIds = Array.from(new Set(templates.map((t: any) => (t.data as any)?.customerId).filter(Boolean)));
  const customers = customerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const custMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  return templates.map((t) => {
    const d = t.data as any;
    return { ...t, customerName: custMap[d?.customerId] ?? null };
  });
}

export async function getRequestTemplateFull(id: string) {
  await requireAuth();
  const tpl = await prisma.requestTemplate.findUnique({ where: { id } });
  if (!tpl) return null;
  const d = tpl.data as any;

  const locationIds = new Set<string>();
  const customerIds = new Set<string>();
  if (d?.customerId) customerIds.add(d.customerId);
  if (d?.payerId) customerIds.add(d.payerId);
  if (d?.shipperId) customerIds.add(d.shipperId);
  for (const c of d?.cargoes ?? []) {
    if (c.consigneeLocationId) locationIds.add(c.consigneeLocationId);
    for (const l of c.legs ?? []) {
      if (l.pickupLocationId) locationIds.add(l.pickupLocationId);
      if (l.dropoffLocationId) locationIds.add(l.dropoffLocationId);
    }
  }

  const [locations, customers] = await Promise.all([
    locationIds.size ? prisma.location.findMany({ where: { id: { in: Array.from(locationIds) } }, select: { id: true, name: true } }) : [],
    customerIds.size ? prisma.customer.findMany({ where: { id: { in: Array.from(customerIds) } }, select: { id: true, name: true } }) : [],
  ]);
  const locMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const custMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  return {
    ...tpl,
    resolved: {
      customer: custMap[d?.customerId] ?? null,
      payer: custMap[d?.payerId] ?? null,
      shipper: custMap[d?.shipperId] ?? null,
      cargoes: (d?.cargoes ?? []).map((c: any) => ({
        ...c,
        consigneeName: locMap[c.consigneeLocationId] ?? null,
        legs: (c.legs ?? []).map((l: any) => ({
          ...l,
          pickupName: locMap[l.pickupLocationId] ?? null,
          dropoffName: locMap[l.dropoffLocationId] ?? null,
        })),
      })),
    },
  };
}
