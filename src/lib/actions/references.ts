'use server';

import { prisma } from '@/lib/prisma';
import { requireAuth, requirePermission, getActorId } from '@/lib/authz';
import { revalidatePath } from 'next/cache';

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
  return prisma.location.findMany({ orderBy: { name: 'asc' } });
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
export async function createCustomer(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.customer.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/customers');
  return r;
}
export async function updateCustomer(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.customer.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/customers');
  return r;
}
export async function deleteCustomer(id: string) {
  await requirePermission(W);
  await prisma.customer.delete({ where: { id } });
  revalidatePath('/references/customers');
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

// ============ Vehicles ============
export async function getVehicles() {
  await requireAuth();
  return prisma.vehicle.findMany({ include: { vehicleType: true, carrier: true }, orderBy: { plateNumber: 'asc' } });
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

// ============ Routes ============
export async function getRoutes() {
  await requireAuth();
  return prisma.route.findMany({ include: { origin: true, destination: true }, orderBy: { code: 'asc' } });
}
export async function createRoute(data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.route.create({ data: { ...data, createdById: actor, updatedById: actor } });
  revalidatePath('/references/routes');
  return r;
}
export async function updateRoute(id: string, data: any) {
  await requirePermission(W);
  const actor = await getActorId();
  const r = await prisma.route.update({ where: { id }, data: { ...data, updatedById: actor } });
  revalidatePath('/references/routes');
  return r;
}
export async function deleteRoute(id: string) {
  await requirePermission(W);
  await prisma.route.delete({ where: { id } });
  revalidatePath('/references/routes');
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
export async function getRouteOptions() {
  await requireAuth();
  const rows = await prisma.route.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  return rows.map((r) => ({ value: r.id, label: r.name ? `${r.code} — ${r.name}` : r.code }));
}
