'use server';

// CRUD жёстких шаблонов рейсов для автоплана. Шаблон = одна машина с
// фиксированным набором плеч (слотов). Автоплан (autoplanRun) на дату ищет
// заявочные плечи, совпадающие со слотом по обеим точкам и, если задана,
// конечной точке груза, и собирает их в рейс. См. autoplanRun.ts, проход 1.

import { prisma } from '@/lib/prisma';
import { serialize } from '@/lib/serialize';
import { requireAuth, requirePermission, getActorId } from '@/lib/authz';
import { revalidatePath } from 'next/cache';

const W = 'references.write';

const tplInclude = {
  carrier: { select: { id: true, name: true } },
  vehicleType: { select: { code: true, name: true, capacityPallets: true } },
  legs: {
    orderBy: { position: 'asc' as const },
    include: {
      pickupLocation: { select: { id: true, name: true } },
      dropoffLocation: { select: { id: true, name: true } },
      finalLocation: { select: { id: true, name: true } },
      direction: { select: { id: true, code: true } },
    },
  },
};

export async function getTripPlanTemplates() {
  await requireAuth();
  return serialize(
    await prisma.tripPlanTemplate.findMany({ include: tplInclude, orderBy: { name: 'asc' } }),
  );
}

export async function getTripPlanTemplate(id: string) {
  await requireAuth();
  return serialize(await prisma.tripPlanTemplate.findUnique({ where: { id }, include: tplInclude }));
}

export type TripPlanTemplateInput = {
  name: string;
  carrierId: string;
  vehicleTypeCode: string;
  isActive?: boolean;
  notes?: string | null;
  legs: {
    pickupLocationId: string;
    dropoffLocationId: string;
    finalLocationId?: string | null;
    directionId?: string | null;
  }[];
};

// Слоты пересобираем целиком (delete + insert в одной транзакции) — как RouteStop.
// Позиция назначается по порядку массива, поэтому уникальность (templateId,
// position) не конфликтует.
function legCreateData(legs: TripPlanTemplateInput['legs']) {
  return legs
    .filter((l) => l.pickupLocationId && l.dropoffLocationId)
    .map((l, i) => ({
      position: i + 1,
      pickupLocationId: l.pickupLocationId,
      dropoffLocationId: l.dropoffLocationId,
      finalLocationId: l.finalLocationId || null,
      directionId: l.directionId || null,
    }));
}

export async function createTripPlanTemplate(input: TripPlanTemplateInput) {
  await requirePermission(W);
  const actor = await getActorId();
  const tpl = await prisma.tripPlanTemplate.create({
    data: {
      name: input.name.trim(),
      carrierId: input.carrierId,
      vehicleTypeCode: input.vehicleTypeCode,
      isActive: input.isActive ?? true,
      notes: input.notes || null,
      createdById: actor,
      updatedById: actor,
      legs: { create: legCreateData(input.legs) },
    },
    include: tplInclude,
  });
  revalidatePath('/references/trip-plan-templates');
  return serialize(tpl);
}

export async function updateTripPlanTemplate(id: string, input: TripPlanTemplateInput) {
  await requirePermission(W);
  const actor = await getActorId();
  await prisma.$transaction([
    prisma.tripPlanTemplateLeg.deleteMany({ where: { templateId: id } }),
    prisma.tripPlanTemplate.update({
      where: { id },
      data: {
        name: input.name.trim(),
        carrierId: input.carrierId,
        vehicleTypeCode: input.vehicleTypeCode,
        isActive: input.isActive ?? true,
        notes: input.notes || null,
        updatedById: actor,
        legs: { create: legCreateData(input.legs) },
      },
    }),
  ]);
  revalidatePath('/references/trip-plan-templates');
  return serialize(await prisma.tripPlanTemplate.findUnique({ where: { id }, include: tplInclude }));
}

export async function deleteTripPlanTemplate(id: string) {
  await requirePermission(W);
  await prisma.tripPlanTemplate.delete({ where: { id } });
  revalidatePath('/references/trip-plan-templates');
}
