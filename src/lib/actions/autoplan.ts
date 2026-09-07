'use server';

// Серверные действия автораспределения: только права и сброс кэша. Вся логика —
// в @/lib/autoplanRun, потому что её же вызывает ночной cron без сессии.

import { requireAuth, requireRole, getActorId, RoleName } from '@/lib/authz';
import { revalidatePath } from 'next/cache';
import * as run from '@/lib/autoplanRun';

const W: RoleName[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];

export async function computeAutoPlan(dateISO: string, directionId?: string | null) {
  await requireAuth();
  return run.computeAutoPlan(dateISO, directionId);
}

export async function getUnassignedByDay(weekStartISO: string) {
  await requireAuth();
  return run.getUnassignedByDay(weekStartISO);
}

export async function applyAutoPlan(dateISO: string, directionId?: string | null) {
  await requireRole(W);
  const actor = await getActorId();
  const res = await run.applyAutoPlan(dateISO, actor, directionId);
  revalidatePath('/operations/trips');
  revalidatePath('/operations/cargo');
  revalidatePath('/operations/planning');
  return res;
}
