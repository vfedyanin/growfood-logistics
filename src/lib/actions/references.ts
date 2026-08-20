'use server';

import { prisma } from '@/lib/prisma';
import { serialize } from '@/lib/serialize';
import { requireAuth, requirePermission, getActorId } from '@/lib/authz';
import { getCustomerTariffMap } from '@/lib/pricing';
import { revalidatePath } from 'next/cache';
import { activeVehicleTypesForDirection } from '@/lib/carrierTariff';

const W = 'references.write';

// ============ Verticals (pure dict, PK = code, без аудита) ============
export async function getVerticals() {
  await requireAuth();
  return prisma.vertical.findMany({ orderBy: { name: 'asc' } });
}
export async function createVertical(data: any) {
  await requirePermission(W);
  const r = await prisma.vertical.create({ data });
  revalidatePath('/references/verticals');
  return r;
}
export async function updateVertical(code: string, data: any) {
  await requirePermission(W);
  const r = await prisma.vertical.update({ where: { code }, data });
  revalidatePath('/references/verticals');
  return r;
}
export async function deleteVertical(code: string) {
  await requirePermission(W);
  await prisma.vertical.delete({ where: { code } });
  revalidatePath('/references/verticals');
}

// ============ Locations ============
export async function getLocations() {
  await requireAuth();
  return serialize(await prisma.location.findMany({ orderBy: { name: 'asc' } }));
}
export async function createLocation(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.location.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/locations');
  return r;
}
export async function updateLocation(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.location.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/locations');
  return r;
}
export async function deleteLocation(id: string) {
  await requirePermission(W);
  await prisma.location.delete({ where: { id } });
  revalidatePath('/references/locations');
}

// ============ Customers ============
export async function getCustomers() {
  await requireAuth();
  return prisma.customer.findMany({ include: { vertical: true }, orderBy: { name: 'asc' } });
}
// Нормализация полей контрагента: дата импорта в Date, guard на авто-импорт.
function normalizeCustomer(data: any) {
  const d = { ...data };
  if ('importSince' in d) d.importSince = d.importSince ? new Date(d.importSince) : null;
  if (d.autoImportEnabled && !d.email) throw new Error('Авто-импорт можно включить только при заполненном Email');
  return d;
}
export async function createCustomer(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.customer.create({ data: { ...normalizeCustomer(data), createdById: actor, updatedById: actor } });
  revalidatePath('/references/customers');
  return r;
}
export async function updateCustomer(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.customer.update({ where: { id }, data: { ...normalizeCustomer(data), updatedById: actor } });
  revalidatePath('/references/customers');
  return r;
}
export async function deleteCustomer(id: string) {
  await requirePermission(W);
  await prisma.customer.delete({ where: { id } });
  revalidatePath('/references/customers');
}

export async function getCustomerDeliveryLocations(customerId: string) {
  await requireAuth();
  return prisma.customerDeliveryLocation.findMany({
    where: { customerId },
    include: { location: { select: { id: true, code: true, name: true, city: true, type: true } } },
    orderBy: { location: { name: 'asc' } },
  });
}

// Тарифы точек доставки клиента для предпросчёта TARIFF-грузов в форме заявки.
// Поиск — общий с серверным расчётом (@/lib/pricing), чтобы предпросмотр и итог
// в заявке не могли разойтись.
export async function getCustomerTariffLocations(customerId: string) {
  await requireAuth();
  if (!customerId) return [];
  const map = await getCustomerTariffMap(customerId);
  return Array.from(map.entries()).map(([locationId, info]) => ({
    locationId,
    tariffMethod: info.method,
    tariffAmount: info.amount,
    tiers: info.tiers,
  }));
}

export async function addCustomerDeliveryLocation(customerId: string, locationId: string, tariffMethod?: string, tariffAmount?: number) {
  await requirePermission(W);
  return prisma.customerDeliveryLocation.create({
    data: { customerId, locationId, tariffMethod: tariffMethod as any, tariffAmount: tariffAmount ?? null },
  });
}

export async function updateCustomerDeliveryLocationTariff(customerId: string, locationId: string, tariffMethod: string | null, tariffAmount: number | null) {
  await requirePermission(W);
  return prisma.customerDeliveryLocation.updateMany({
    where: { customerId, locationId },
    data: { tariffMethod: tariffMethod as any, tariffAmount: tariffAmount },
  });
}

export async function removeCustomerDeliveryLocation(customerId: string, locationId: string) {
  await requirePermission(W);
  return prisma.customerDeliveryLocation.deleteMany({ where: { customerId, locationId } });
}

// ============ Carriers ============
export async function getCarriers() {
  await requireAuth();
  return prisma.carrier.findMany({ orderBy: { name: 'asc' } });
}
export async function createCarrier(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.carrier.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/carriers');
  return r;
}
export async function updateCarrier(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.carrier.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/carriers');
  return r;
}
export async function deleteCarrier(id: string) {
  await requirePermission(W);
  await prisma.carrier.delete({ where: { id } });
  revalidatePath('/references/carriers');
}

// ============ VehicleTypes (pure dict, PK = code, без аудита) ============
export async function getVehicleTypes() {
  await requireAuth();
  return prisma.vehicleType.findMany({ orderBy: { name: 'asc' } });
}
export async function createVehicleType(data: any) {
  await requirePermission(W);
  const r = await prisma.vehicleType.create({ data });
  revalidatePath('/references/vehicle-types');
  return r;
}
export async function updateVehicleType(code: string, data: any) {
  await requirePermission(W);
  const r = await prisma.vehicleType.update({ where: { code }, data });
  revalidatePath('/references/vehicle-types');
  return r;
}
export async function deleteVehicleType(code: string) {
  await requirePermission(W);
  await prisma.vehicleType.delete({ where: { code } });
  revalidatePath('/references/vehicle-types');
}

// ============ AdditionalServices (pure dict, PK = code) ============
export async function getAdditionalServices() {
  await requireAuth();
  return prisma.additionalService.findMany({ orderBy: { name: 'asc' } });
}
export async function createAdditionalService(data: any) {
  await requirePermission(W);
  const r = await prisma.additionalService.create({ data: { code: data.code, name: data.name } });
  revalidatePath('/references/additional-services');
  return r;
}
export async function updateAdditionalService(code: string, data: any) {
  await requirePermission(W);
  const r = await prisma.additionalService.update({ where: { code }, data: { name: data.name } });
  revalidatePath('/references/additional-services');
  return r;
}
export async function deleteAdditionalService(code: string) {
  await requirePermission(W);
  await prisma.additionalService.delete({ where: { code } });
  revalidatePath('/references/additional-services');
}

// ============ Vehicles ============
export async function getVehicles() {
  await requireAuth();
  return serialize(await prisma.vehicle.findMany({ include: { vehicleType: true, carrier: true }, orderBy: { plateNumber: 'asc' } }));
}
export async function createVehicle(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.vehicle.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/vehicles');
  return r;
}
export async function updateVehicle(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.vehicle.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/vehicles');
  return r;
}
export async function deleteVehicle(id: string) {
  await requirePermission(W);
  await prisma.vehicle.delete({ where: { id } });
  revalidatePath('/references/vehicles');
}

// ============ Drivers ============
export async function getDrivers() {
  await requireAuth();
  return prisma.driver.findMany({ include: { carrier: true }, orderBy: { fullName: 'asc' } });
}
export async function createDriver(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.driver.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/drivers');
  return r;
}
export async function updateDriver(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.driver.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/drivers');
  return r;
}
export async function deleteDriver(id: string) {
  await requirePermission(W);
  await prisma.driver.delete({ where: { id } });
  revalidatePath('/references/drivers');
}

// ============ Directions ============
export async function getDirections() {
  await requireAuth();
  // carrier нужен колонке «Перевозчик» в справочнике направлений.
  return serialize(await prisma.direction.findMany({
    include: { carrier: { select: { id: true, name: true } } },
    orderBy: { code: 'asc' },
  }));
}
/**
 * Перевозчика на направление можно поставить только если у него есть действующий
 * тариф на это направление. Перевозчик из списка не убирается намеренно: пустой
 * список ничего не объясняет, а внятная ошибка говорит, что именно надо завести.
 *
 * Следствие принято сознательно: направление нельзя настроить, пока нет тарифа.
 * Это и нужно — автопланирование не должно создавать рейсы без стоимости.
 *
 * ПОЧЕМУ ВОЗВРАЩАЕМ ТЕКСТ, А НЕ БРОСАЕМ ИСКЛЮЧЕНИЕ. В production-сборке Next
 * вырезает сообщение любой ошибки, вышедшей из серверного действия, и клиент
 * получает «An error occurred in the Server Components render… omitted in
 * production builds» вместо объяснения. Именно это и видел пользователь на
 * Елабуге, у которой тарифа нет. В `next dev` текст доходит, поэтому дефект и
 * не заметили при разработке. Ошибка как ЗНАЧЕНИЕ переживает эту границу.
 */
async function carrierTariffError(
  direction: { id: string; code: string } | null,
  carrierId: string | null | undefined,
  origin: { originId: string | null; destinationId: string | null },
): Promise<string | null> {
  if (!carrierId) return null; // перевозчик не задан — проверять нечего
  const carrier = await prisma.carrier.findUnique({ where: { id: carrierId }, select: { name: true } });
  const types = direction
    ? await activeVehicleTypesForDirection({ id: direction.id, ...origin }, carrierId, new Date())
    : [];
  if (types.length) return null;
  // Направление называем кодом: у логиста открыто несколько карточек, и «это
  // направление» без имени не помогает понять, где именно не хватает тарифа.
  return (
    `У перевозчика «${carrier?.name ?? carrierId}» нет действующего тарифа на направление ` +
    `${direction?.code ?? '—'}. Поставить его перевозчиком нельзя: без тарифа рейс ` +
    'уедет без стоимости, а автопланирование такие рейсы создавать не должно.\n\n' +
    'Что сделать: заведите тариф на это направление в договоре перевозчика, ' +
    'после этого возвращайтесь сюда.'
  );
}

// Результат сохранения направления. `serialize` обязателен: у направления
// distanceKm — Decimal, а Decimal через границу серверного действия не проходит
// и роняет рендер той же обезличенной ошибкой, что и текст выше.
type DirectionSaveResult = { error: string } | { direction: any };

export async function createDirection(data: any): Promise<DirectionSaveResult> {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.direction.create({ data: { ...data, createdById: actor, updatedById: actor } });
  // Проверяем ПОСЛЕ создания: до него нет id, а тариф ключуется направлением.
  // Если тарифа нет — откатываем, иначе останется направление с перевозчиком,
  // которого нельзя посчитать в деньгах.
  const err = await carrierTariffError({ id: r.id, code: r.code }, data.carrierId, {
    originId: r.originId,
    destinationId: r.destinationId,
  });
  if (err) {
    await prisma.direction.delete({ where: { id: r.id } });
    return { error: err };
  }
  revalidatePath('/references/directions');
  return { direction: serialize(r) };
}
export async function updateDirection(id: string, data: any): Promise<DirectionSaveResult> {
  await requirePermission(W);
  const actor = await getActorId();
  const cur = await prisma.direction.findUnique({
    where: { id },
    select: { code: true, originId: true, destinationId: true },
  });
  const err = await carrierTariffError({ id, code: data.code ?? cur?.code ?? '' }, data.carrierId, {
    originId: data.originId ?? cur?.originId ?? null,
    destinationId: data.destinationId ?? cur?.destinationId ?? null,
  });
  if (err) return { error: err };
  const r = await prisma.direction.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/directions');
  revalidatePath('/operations/planning');
  return { direction: serialize(r) };
}
export async function deleteDirection(id: string) {
  await requirePermission(W);
  await prisma.direction.delete({ where: { id } });
  revalidatePath('/references/directions');
}

// ============ Маршрут направления (каркас для автораспределения) ============
// Упорядоченный список точек, которые машина объезжает. Автораспределение
// раскладывает фактические плечи дня в этом порядке; точки без груза пропускает.
export async function getRouteStops(directionId: string) {
  await requireAuth();
  const stops = await prisma.routeStop.findMany({
    where: { directionId },
    orderBy: { position: 'asc' },
    include: { location: { select: { id: true, code: true, name: true } } },
  });
  return serialize(stops);
}

// Заменяем весь список целиком: так проще, чем поштучный дифф, и порядок
// пересобирается заново от 1. Уникальность (directionId, position) не конфликтует —
// старые строки удаляются в той же транзакции до вставки новых.
export async function setRouteStops(directionId: string, locationIds: string[]) {
  await requirePermission(W);
  await prisma.$transaction([
    prisma.routeStop.deleteMany({ where: { directionId } }),
    ...locationIds.map((locationId, i) =>
      prisma.routeStop.create({ data: { directionId, locationId, position: i + 1 } }),
    ),
  ]);
  revalidatePath('/references/directions');
  revalidatePath('/operations/planning');
}

// ============ Option-getters для селектов ============
export async function getVerticalOptions() {
  await requireAuth();
  const rows = await prisma.vertical.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return rows.map((v) => ({ value: v.code, label: v.name }));
}
export async function getLocationOptions() {
  await requireAuth();
  const rows = await prisma.location.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return rows.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }));
}
export async function getCustomerOptions(partyRole?: 'SHIPPER' | 'CONSIGNEE') {
  await requireAuth();
  const rows = await prisma.customer.findMany({
    where: {
      isActive: true,
      ...(partyRole ? { partyRole: { in: [partyRole, 'BOTH'] } } : {}),
    },
    orderBy: { name: 'asc' },
  });
  return rows.map((c) => ({ value: c.id, label: c.name }));
}
export async function getCarrierOptions() {
  await requireAuth();
  const rows = await prisma.carrier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return rows.map((c) => ({ value: c.id, label: c.name }));
}
export async function getVehicleTypeOptions() {
  await requireAuth();
  const rows = await prisma.vehicleType.findMany({ orderBy: { name: 'asc' } });
  return rows.map((t) => ({ value: t.code, label: t.name }));
}

export async function getVehicleTypeOptionsForCarrier(carrierId?: string, directionId?: string) {
  await requireAuth();

  const now = new Date();
  const findCodes = async (cId?: string, dId?: string) => {
    const tariffs = await prisma.tariff.findMany({
      where: {
        vehicleTypeCode: { not: null },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
        ...(cId ? { carrierContract: { carrierId: cId } } : {}),
        ...(dId ? { directionId: dId } : {}),
      },
      select: { vehicleTypeCode: true },
      distinct: ['vehicleTypeCode'],
    });
    return tariffs.map(t => t.vehicleTypeCode!);
  };

  let codes: string[] = [];
  if (carrierId && directionId) codes = await findCodes(carrierId, directionId);
  if (!codes.length && carrierId) codes = await findCodes(carrierId, undefined);
  if (!codes.length && directionId) codes = await findCodes(undefined, directionId);

  if (!codes.length) {
    const rows = await prisma.vehicleType.findMany({ orderBy: { name: 'asc' } });
    return rows.map((t) => ({ value: t.code, label: t.name }));
  }
  const rows = await prisma.vehicleType.findMany({ where: { code: { in: codes } }, orderBy: { name: 'asc' } });
  return rows.map((t) => ({ value: t.code, label: t.name }));
}
export async function getVehicleOptions() {
  await requireAuth();
  const rows = await prisma.vehicle.findMany({ where: { isActive: true }, include: { vehicleType: true }, orderBy: { plateNumber: 'asc' } });
  return rows.map((v) => ({ value: v.id, label: `${v.plateNumber} (${v.vehicleType.name})` }));
}
export async function getDriverOptions() {
  await requireAuth();
  const rows = await prisma.driver.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' } });
  return rows.map((d) => ({ value: d.id, label: d.fullName }));
}
export async function getDirectionOptions() {
  await requireAuth();
  const rows = await prisma.direction.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  return rows.map((r) => ({ value: r.id, label: r.name ? `${r.code} — ${r.name}` : r.code }));
}
