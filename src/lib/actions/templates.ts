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
