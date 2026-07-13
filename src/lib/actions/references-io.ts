'use server';

import { prisma } from '@/lib/prisma';
import { requireRole, getActorId, RoleName } from '@/lib/authz';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';

const W: RoleName[] = ['ADMIN', 'LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];

const s = (v: any) => (v == null || v === '' ? null : String(v).trim());
const sUp = (v: any) => { const x = s(v); return x ? x.toUpperCase() : null; };
const n = (v: any) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const i = (v: any) => { const x = n(v); return x == null ? null : Math.trunc(x); };
const b = (v: any, def = true) => {
  if (v == null || v === '') return def;
  if (typeof v === 'boolean') return v;
  return ['TRUE','1','ДА','YES','Y','+'].includes(String(v).trim().toUpperCase());
};
const date = (v: any) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const dateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const inEnum = (val: any, allowed: string[], field: string) => {
  const v = sUp(val);
  if (!v) return null;
  if (!allowed.includes(v)) throw new Error(`'${field}'='${val}' не в ${allowed.join('/')}`);
  return v;
};
const req = (v: any, field: string) => { const x = s(v); if (!x) throw new Error(`Пустое обязательное '${field}'`); return x; };

// Soft-delete helper: if row referenced by FK, can't hard-delete; set isActive=false.
// Generic via Prisma error catching: try delete; on P2003 fall back to update isActive=false.
async function deleteOrSoft(
  hardDelete: () => Promise<any>,
  softDelete: (() => Promise<any>) | null
): Promise<'deleted'|'softDeleted'|'skipped'> {
  try {
    await hardDelete();
    return 'deleted';
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      if (softDelete) { await softDelete(); return 'softDeleted'; }
      return 'skipped';
    }
    throw e;
  }
}

// ============ Per-resource configs ============

type DiffRow = { identity: string; displayName: string };

type RefConfig = {
  label: string;
  fileBaseName: string;
  paths: string[];
  exportRows: () => Promise<any[]>;
  parseRow: (row: any, actor: string | null) => Promise<{ identity: string; data: any; record: any }>;
  fetchDiff: () => Promise<(DiffRow & { _raw: any })[]>;
  upsertOne: (parsed: { identity: string; data: any; record: any }, actor: string | null) => Promise<void>;
  deleteOne: (raw: any) => Promise<'deleted'|'softDeleted'|'skipped'>;
};

// ---------- Вертикали ----------
const verticalCfg: RefConfig = {
  label: 'Вертикали',
  fileBaseName: 'verticals',
  paths: ['/references/verticals'],
  exportRows: async () => {
    const rows = await prisma.vertical.findMany({ orderBy: { code: 'asc' } });
    return rows.map(r => ({ code: r.code, name: r.name, type: r.type, isActive: r.isActive }));
  },
  parseRow: async (r) => {
    const data = {
      code: req(r.code, 'code'),
      name: req(r.name, 'name'),
      type: inEnum(r.type, ['INTERNAL', 'EXTERNAL'], 'type'),
      isActive: b(r.isActive),
    };
    if (!data.type) throw new Error("'type' обязательно (INTERNAL/EXTERNAL)");
    return { identity: data.code, data, record: { code: data.code } };
  },
  fetchDiff: async () => (await prisma.vertical.findMany()).map(r => ({ identity: r.code, displayName: r.name, _raw: r })),
  upsertOne: async (p) => {
    const { code, ...rest } = p.data;
    await prisma.vertical.upsert({ where: { code }, update: rest, create: { code, ...rest } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.vertical.delete({ where: { code: raw.code } }),
    () => prisma.vertical.update({ where: { code: raw.code }, data: { isActive: false } }),
  ),
};

// ---------- Локации ----------
const LOC_TYPES = ['WAREHOUSE','HUB','KITCHEN','DC','RETAIL_POINT','FACTORY'];
const LOC_OWNERS = ['OWN','CUSTOMER','PARTNER'];
const locationCfg: RefConfig = {
  label: 'Локации',
  fileBaseName: 'locations',
  paths: ['/references/locations'],
  exportRows: async () => {
    const rows = await prisma.location.findMany({ orderBy: { code: 'asc' } });
    return rows.map(r => ({
      code: r.code, name: r.name, type: r.type, ownerType: r.ownerType,
      city: r.city, region: r.region, address: r.address,
      lat: r.lat != null ? Number(r.lat) : null, lon: r.lon != null ? Number(r.lon) : null,
      isActive: r.isActive,
    }));
  },
  parseRow: async (r, actor) => {
    const code = req(r.code, 'code');
    const data: any = {
      name: req(r.name, 'name'),
      type: inEnum(r.type, LOC_TYPES, 'type'),
      ownerType: inEnum(r.ownerType, LOC_OWNERS, 'ownerType'),
      city: s(r.city), region: s(r.region), address: s(r.address),
      lat: n(r.lat), lon: n(r.lon), isActive: b(r.isActive),
      updatedById: actor,
    };
    if (!data.type) throw new Error("'type' обязательно");
    if (!data.ownerType) throw new Error("'ownerType' обязательно");
    return { identity: code, data, record: { code } };
  },
  fetchDiff: async () => (await prisma.location.findMany()).map(r => ({ identity: r.code, displayName: r.name, _raw: r })),
  upsertOne: async (p, actor) => {
    await prisma.location.upsert({
      where: { code: p.record.code },
      update: p.data,
      create: { code: p.record.code, ...p.data, createdById: actor },
    });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.location.delete({ where: { id: raw.id } }),
    () => prisma.location.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Типы ТС (нет isActive) ----------
const vehicleTypeCfg: RefConfig = {
  label: 'Типы ТС',
  fileBaseName: 'vehicle-types',
  paths: ['/references/vehicle-types'],
  exportRows: async () => {
    const rows = await prisma.vehicleType.findMany({ orderBy: { code: 'asc' } });
    return rows.map(r => ({ code: r.code, name: r.name,
      capacityKg: r.capacityKg != null ? Number(r.capacityKg) : null,
      capacityPallets: r.capacityPallets, isRefrigerator: r.isRefrigerator }));
  },
  parseRow: async (r) => {
    const code = req(r.code, 'code');
    const data = { name: req(r.name, 'name'), capacityKg: n(r.capacityKg), capacityPallets: i(r.capacityPallets), isRefrigerator: b(r.isRefrigerator, false) };
    return { identity: code, data, record: { code } };
  },
  fetchDiff: async () => (await prisma.vehicleType.findMany()).map(r => ({ identity: r.code, displayName: r.name, _raw: r })),
  upsertOne: async (p) => {
    await prisma.vehicleType.upsert({ where: { code: p.record.code }, update: p.data, create: { code: p.record.code, ...p.data } });
  },
  deleteOne: async (raw) => deleteOrSoft(() => prisma.vehicleType.delete({ where: { code: raw.code } }), null),
};

// ---------- Перевозчики ----------
const carrierCfg: RefConfig = {
  label: 'Перевозчики',
  fileBaseName: 'carriers',
  paths: ['/references/carriers'],
  exportRows: async () => {
    const rows = await prisma.carrier.findMany({ orderBy: { code: 'asc' } });
    return rows.map(r => ({ code: r.code, name: r.name, inn: r.inn, kpp: r.kpp, contactPerson: r.contactPerson, phone: r.phone, email: r.email, isActive: r.isActive, notes: r.notes }));
  },
  parseRow: async (r, actor) => {
    const code = req(r.code, 'code');
    const data: any = { name: req(r.name, 'name'), inn: s(r.inn), kpp: s(r.kpp), contactPerson: s(r.contactPerson), phone: s(r.phone), email: s(r.email), isActive: b(r.isActive), notes: s(r.notes), updatedById: actor };
    return { identity: code, data, record: { code } };
  },
  fetchDiff: async () => (await prisma.carrier.findMany()).map(r => ({ identity: r.code, displayName: r.name, _raw: r })),
  upsertOne: async (p, actor) => {
    await prisma.carrier.upsert({ where: { code: p.record.code }, update: p.data, create: { code: p.record.code, ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.carrier.delete({ where: { id: raw.id } }),
    () => prisma.carrier.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Контрагенты ----------
const CUST_TYPES = ['INTERNAL', 'RETAIL_CHAIN', 'EXTERNAL_COMPANY'];
const PARTY_ROLES = ['SHIPPER', 'CONSIGNEE', 'BOTH'];
const customerCfg: RefConfig = {
  label: 'Контрагенты',
  fileBaseName: 'customers',
  paths: ['/references/customers'],
  exportRows: async () => {
    const rows = await prisma.customer.findMany({ orderBy: { code: 'asc' } });
    return rows.map(r => ({ code: r.code, name: r.name, inn: r.inn, kpp: r.kpp, fullLegalName: r.fullLegalName, verticalCode: r.verticalCode, customerType: r.customerType, partyRole: r.partyRole, contactPerson: r.contactPerson, phone: r.phone, email: r.email, isActive: r.isActive, notes: r.notes }));
  },
  parseRow: async (r, actor) => {
    const code = req(r.code, 'code');
    const verticalCode = req(r.verticalCode, 'verticalCode');
    const v = await prisma.vertical.findUnique({ where: { code: verticalCode } });
    if (!v) throw new Error(`'verticalCode'='${verticalCode}' не найден в Вертикалях`);
    const data: any = {
      name: req(r.name, 'name'),
      inn: s(r.inn), kpp: s(r.kpp), fullLegalName: s(r.fullLegalName), verticalCode,
      customerType: inEnum(r.customerType, CUST_TYPES, 'customerType'),
      partyRole: inEnum(r.partyRole, PARTY_ROLES, 'partyRole') || 'BOTH',
      contactPerson: s(r.contactPerson), phone: s(r.phone), email: s(r.email),
      isActive: b(r.isActive), notes: s(r.notes), updatedById: actor,
    };
    if (!data.customerType) throw new Error("'customerType' обязательно");
    return { identity: code, data, record: { code } };
  },
  fetchDiff: async () => (await prisma.customer.findMany()).map(r => ({ identity: r.code, displayName: r.name, _raw: r })),
  upsertOne: async (p, actor) => {
    await prisma.customer.upsert({ where: { code: p.record.code }, update: p.data, create: { code: p.record.code, ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.customer.delete({ where: { id: raw.id } }),
    () => prisma.customer.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Транспорт ----------
const vehicleCfg: RefConfig = {
  label: 'Транспорт',
  fileBaseName: 'vehicles',
  paths: ['/references/vehicles'],
  exportRows: async () => {
    const rows = await prisma.vehicle.findMany({ include: { carrier: true }, orderBy: { plateNumber: 'asc' } });
    return rows.map(r => ({ plateNumber: r.plateNumber, brandModel: r.brandModel, vehicleTypeCode: r.vehicleTypeCode, carrierCode: r.carrier?.code || null, isActive: r.isActive }));
  },
  parseRow: async (r, actor) => {
    const plateNumber = req(r.plateNumber, 'plateNumber');
    const vtCode = req(r.vehicleTypeCode, 'vehicleTypeCode');
    const vt = await prisma.vehicleType.findUnique({ where: { code: vtCode } });
    if (!vt) throw new Error(`'vehicleTypeCode'='${vtCode}' не найден в Типах ТС`);
    let carrierId: string | null = null;
    const carrierCode = s(r.carrierCode);
    if (carrierCode) {
      const c = await prisma.carrier.findUnique({ where: { code: carrierCode } });
      if (!c) throw new Error(`'carrierCode'='${carrierCode}' не найден в Перевозчиках`);
      carrierId = c.id;
    }
    const data: any = { brandModel: s(r.brandModel), vehicleTypeCode: vtCode, carrierId, isActive: b(r.isActive), updatedById: actor };
    return { identity: plateNumber, data, record: { plateNumber } };
  },
  fetchDiff: async () => (await prisma.vehicle.findMany()).map(r => ({ identity: r.plateNumber, displayName: r.plateNumber, _raw: r })),
  upsertOne: async (p, actor) => {
    await prisma.vehicle.upsert({ where: { plateNumber: p.record.plateNumber }, update: p.data, create: { plateNumber: p.record.plateNumber, ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.vehicle.delete({ where: { id: raw.id } }),
    () => prisma.vehicle.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Водители ----------
// identity = fullName + carrierCode (или '-' если без перевозчика)
const driverCfg: RefConfig = {
  label: 'Водители',
  fileBaseName: 'drivers',
  paths: ['/references/drivers'],
  exportRows: async () => {
    const rows = await prisma.driver.findMany({ include: { carrier: true }, orderBy: { fullName: 'asc' } });
    return rows.map(r => ({ fullName: r.fullName, phone: r.phone, licenseNumber: r.licenseNumber, carrierCode: r.carrier?.code || null, isActive: r.isActive }));
  },
  parseRow: async (r, actor) => {
    const fullName = req(r.fullName, 'fullName');
    let carrierId: string | null = null; let carrierCode: string | null = null;
    const cc = s(r.carrierCode);
    if (cc) {
      const c = await prisma.carrier.findUnique({ where: { code: cc } });
      if (!c) throw new Error(`'carrierCode'='${cc}' не найден в Перевозчиках`);
      carrierId = c.id; carrierCode = cc;
    }
    const data: any = { phone: s(r.phone), licenseNumber: s(r.licenseNumber), carrierId, isActive: b(r.isActive), updatedById: actor };
    const identity = `${fullName}|${carrierCode || '-'}`;
    return { identity, data, record: { fullName, carrierId } };
  },
  fetchDiff: async () => {
    const rows = await prisma.driver.findMany({ include: { carrier: true } });
    return rows.map(r => ({ identity: `${r.fullName}|${r.carrier?.code || '-'}`, displayName: r.fullName + (r.carrier ? ` (${r.carrier.name})` : ''), _raw: r }));
  },
  upsertOne: async (p, actor) => {
    const existing = await prisma.driver.findFirst({ where: { fullName: p.record.fullName, carrierId: p.record.carrierId } });
    if (existing) await prisma.driver.update({ where: { id: existing.id }, data: p.data });
    else await prisma.driver.create({ data: { fullName: p.record.fullName, ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.driver.delete({ where: { id: raw.id } }),
    () => prisma.driver.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Направления ----------
const directionCfg: RefConfig = {
  label: 'Направления',
  fileBaseName: 'directions',
  paths: ['/references/directions'],
  exportRows: async () => {
    const rows = await prisma.direction.findMany({ orderBy: { code: 'asc' } });
    return rows.map(r => ({
      code: r.code, name: r.name,
      distanceKm: r.distanceKm != null ? Number(r.distanceKm) : null,
      isActive: r.isActive,
    }));
  },
  parseRow: async (r, actor) => {
    const code = req(r.code, 'code');
    const data: any = {
      name: s(r.name),
      distanceKm: n(r.distanceKm),
      isActive: b(r.isActive), updatedById: actor,
    };
    return { identity: code, data, record: { code } };
  },
  fetchDiff: async () => (await prisma.direction.findMany()).map(r => ({ identity: r.code, displayName: r.code, _raw: r })),
  upsertOne: async (p, actor) => {
    await prisma.direction.upsert({ where: { code: p.record.code }, update: p.data, create: { code: p.record.code, ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.direction.delete({ where: { id: raw.id } }),
    () => prisma.direction.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Договоры заказчиков ----------
const CONTRACT_TYPES = ['LAAS_SERVICE', 'RETAIL_SUPPLY', 'INTERNAL_AGREEMENT'];
const customerContractCfg: RefConfig = {
  label: 'Договоры заказчиков',
  fileBaseName: 'customer-contracts',
  paths: ['/references/customer-contracts'],
  exportRows: async () => {
    const rows = await prisma.customerContract.findMany({ include: { customer: true }, orderBy: { contractNumber: 'asc' } });
    return rows.map(r => ({ contractNumber: r.contractNumber, customerCode: r.customer.code, contractType: r.contractType, vatRatePct: r.vatRatePct, validFrom: dateStr(r.validFrom), validTo: dateStr(r.validTo), paymentTerms: r.paymentTerms, notes: r.notes, isActive: r.isActive }));
  },
  parseRow: async (r, actor) => {
    const contractNumber = req(r.contractNumber, 'contractNumber');
    const customerCode = req(r.customerCode, 'customerCode');
    const c = await prisma.customer.findUnique({ where: { code: customerCode } });
    if (!c) throw new Error(`'customerCode'='${customerCode}' не найден в Контрагентах`);
    const data: any = {
      contractType: inEnum(r.contractType, CONTRACT_TYPES, 'contractType'),
      customerId: c.id,
      vatRatePct: i(r.vatRatePct) ?? 0,
      validFrom: date(r.validFrom), validTo: date(r.validTo),
      paymentTerms: s(r.paymentTerms), notes: s(r.notes),
      isActive: b(r.isActive), updatedById: actor,
    };
    if (!data.contractType) throw new Error("'contractType' обязательно");
    if (!data.validFrom) throw new Error("'validFrom' обязательно");
    return { identity: `${contractNumber}|${customerCode}`, data, record: { contractNumber, customerId: c.id, customerCode } };
  },
  fetchDiff: async () => {
    const rows = await prisma.customerContract.findMany({ include: { customer: true } });
    return rows.map(r => ({ identity: `${r.contractNumber}|${r.customer.code}`, displayName: `${r.contractNumber} (${r.customer.name})`, _raw: r }));
  },
  upsertOne: async (p, actor) => {
    const existing = await prisma.customerContract.findFirst({ where: { contractNumber: p.record.contractNumber, customerId: p.record.customerId } });
    if (existing) await prisma.customerContract.update({ where: { id: existing.id }, data: p.data });
    else await prisma.customerContract.create({ data: { contractNumber: p.record.contractNumber, ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.customerContract.delete({ where: { id: raw.id } }),
    () => prisma.customerContract.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Договоры перевозчиков ----------
const carrierContractCfg: RefConfig = {
  label: 'Договоры перевозчиков',
  fileBaseName: 'carrier-contracts',
  paths: ['/references/carrier-contracts'],
  exportRows: async () => {
    const rows = await prisma.carrierContract.findMany({ include: { carrier: true }, orderBy: { contractNumber: 'asc' } });
    return rows.map(r => ({ contractNumber: r.contractNumber, carrierCode: r.carrier.code, vatRatePct: r.vatRatePct, validFrom: dateStr(r.validFrom), validTo: dateStr(r.validTo), paymentTerms: r.paymentTerms, notes: r.notes, isActive: r.isActive }));
  },
  parseRow: async (r, actor) => {
    const contractNumber = req(r.contractNumber, 'contractNumber');
    const carrierCode = req(r.carrierCode, 'carrierCode');
    const c = await prisma.carrier.findUnique({ where: { code: carrierCode } });
    if (!c) throw new Error(`'carrierCode'='${carrierCode}' не найден в Перевозчиках`);
    const data: any = {
      carrierId: c.id,
      vatRatePct: i(r.vatRatePct) ?? 0,
      validFrom: date(r.validFrom), validTo: date(r.validTo),
      paymentTerms: s(r.paymentTerms), notes: s(r.notes),
      isActive: b(r.isActive), updatedById: actor,
    };
    if (!data.validFrom) throw new Error("'validFrom' обязательно");
    return { identity: `${contractNumber}|${carrierCode}`, data, record: { contractNumber, carrierId: c.id, carrierCode } };
  },
  fetchDiff: async () => {
    const rows = await prisma.carrierContract.findMany({ include: { carrier: true } });
    return rows.map(r => ({ identity: `${r.contractNumber}|${r.carrier.code}`, displayName: `${r.contractNumber} (${r.carrier.name})`, _raw: r }));
  },
  upsertOne: async (p, actor) => {
    const existing = await prisma.carrierContract.findFirst({ where: { contractNumber: p.record.contractNumber, carrierId: p.record.carrierId } });
    if (existing) await prisma.carrierContract.update({ where: { id: existing.id }, data: p.data });
    else await prisma.carrierContract.create({ data: { contractNumber: p.record.contractNumber, ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(
    () => prisma.carrierContract.delete({ where: { id: raw.id } }),
    () => prisma.carrierContract.update({ where: { id: raw.id }, data: { isActive: false } }),
  ),
};

// ---------- Тарифы ----------
// identity = (customerContractNumber|carrierContractNumber)|routeCode|vehicleTypeCode|validFromISO
const tariffCfg: RefConfig = {
  label: 'Тарифы',
  fileBaseName: 'tariffs',
  paths: ['/references/tariffs'],
  exportRows: async () => {
    const rows = await prisma.tariff.findMany({ include: { customerContract: { include: { customer: true } }, carrierContract: { include: { carrier: true } }, direction: true } });
    return rows.map(r => ({
      customerContractNumber: r.customerContract?.contractNumber || null,
      customerCode: r.customerContract?.customer?.code || null,
      carrierContractNumber: r.carrierContract?.contractNumber || null,
      carrierCode: r.carrierContract?.carrier?.code || null,
      directionCode: r.direction?.code || null,
      vehicleTypeCode: r.vehicleTypeCode,
      pricePerTrip: r.pricePerTrip != null ? Number(r.pricePerTrip) : null,
      pricePerPallet: r.pricePerPallet != null ? Number(r.pricePerPallet) : null,
      pricePerKm: r.pricePerKm != null ? Number(r.pricePerKm) : null,
      validFrom: dateStr(r.validFrom), validTo: dateStr(r.validTo), notes: r.notes,
    }));
  },
  parseRow: async (r, actor) => {
    const ccN = s(r.customerContractNumber), ccCode = s(r.customerCode);
    const carN = s(r.carrierContractNumber), carCode = s(r.carrierCode);
    if (!ccN && !carN) throw new Error('Нужен либо customerContractNumber, либо carrierContractNumber');
    if (ccN && carN) throw new Error('Заполните только один: customerContractNumber или carrierContractNumber');
    let customerContractId: string | null = null, carrierContractId: string | null = null;
    if (ccN) {
      if (!ccCode) throw new Error("Для customerContractNumber нужен customerCode");
      const cust = await prisma.customer.findUnique({ where: { code: ccCode } });
      if (!cust) throw new Error(`'customerCode'='${ccCode}' не найден`);
      const c = await prisma.customerContract.findFirst({ where: { contractNumber: ccN, customerId: cust.id } });
      if (!c) throw new Error(`Договор заказчика '${ccN}' (${ccCode}) не найден`);
      customerContractId = c.id;
    } else {
      if (!carCode) throw new Error("Для carrierContractNumber нужен carrierCode");
      const car = await prisma.carrier.findUnique({ where: { code: carCode } });
      if (!car) throw new Error(`'carrierCode'='${carCode}' не найден`);
      const c = await prisma.carrierContract.findFirst({ where: { contractNumber: carN!, carrierId: car.id } });
      if (!c) throw new Error(`Договор перевозчика '${carN}' (${carCode}) не найден`);
      carrierContractId = c.id;
    }
    let directionId: string | null = null;
    const dc = s(r.directionCode);
    if (dc) {
      const dir = await prisma.direction.findUnique({ where: { code: dc } });
      if (!dir) throw new Error(`'directionCode'='${dc}' не найдено`);
      directionId = dir.id;
    }
    const vtCode = req(r.vehicleTypeCode, 'vehicleTypeCode');
    const vt = await prisma.vehicleType.findUnique({ where: { code: vtCode } });
    if (!vt) throw new Error(`'vehicleTypeCode'='${vtCode}' не найден`);
    const validFrom = date(r.validFrom); if (!validFrom) throw new Error("'validFrom' обязательно");
    const data: any = {
      customerContractId, carrierContractId, directionId, vehicleTypeCode: vtCode,
      pricePerTrip: n(r.pricePerTrip), pricePerPallet: n(r.pricePerPallet), pricePerKm: n(r.pricePerKm),
      validFrom, validTo: date(r.validTo), notes: s(r.notes), updatedById: actor,
    };
    const id = `${ccN ? `CUST:${ccN}|${ccCode}` : `CARR:${carN}|${carCode}`}|${dc || '-'}|${vtCode}|${validFrom.toISOString()}`;
    return { identity: id, data, record: {} };
  },
  fetchDiff: async () => {
    const rows = await prisma.tariff.findMany({ include: { customerContract: { include: { customer: true } }, carrierContract: { include: { carrier: true } }, direction: true } });
    return rows.map(r => {
      const cn = r.customerContract ? `CUST:${r.customerContract.contractNumber}|${r.customerContract.customer.code}` : `CARR:${r.carrierContract!.contractNumber}|${r.carrierContract!.carrier.code}`;
      const id = `${cn}|${r.direction?.code || '-'}|${r.vehicleTypeCode}|${r.validFrom.toISOString()}`;
      const disp = `${r.customerContract?.contractNumber || r.carrierContract?.contractNumber} · ${r.direction?.code || '—'} · ${r.vehicleTypeCode}`;
      return { identity: id, displayName: disp, _raw: r };
    });
  },
  upsertOne: async (p, actor) => {
    // tariff has no unique key — find by identity, update or create
    const existing = await prisma.tariff.findFirst({
      where: {
        customerContractId: p.data.customerContractId, carrierContractId: p.data.carrierContractId,
        directionId: p.data.directionId, vehicleTypeCode: p.data.vehicleTypeCode, validFrom: p.data.validFrom,
      },
    });
    if (existing) await prisma.tariff.update({ where: { id: existing.id }, data: p.data });
    else await prisma.tariff.create({ data: { ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(() => prisma.tariff.delete({ where: { id: raw.id } }), null),
};

// ---------- Рыночные цены ----------
const marketPriceCfg: RefConfig = {
  label: 'Рыночные цены',
  fileBaseName: 'market-prices',
  paths: ['/references/market-prices'],
  exportRows: async () => {
    const rows = await prisma.marketPrice.findMany({ include: { direction: true } });
    return rows.map(r => ({
      directionCode: r.direction.code, vehicleTypeCode: r.vehicleTypeCode,
      pricePerTrip: r.pricePerTrip != null ? Number(r.pricePerTrip) : null,
      pricePerPallet: r.pricePerPallet != null ? Number(r.pricePerPallet) : null,
      pricePerKm: r.pricePerKm != null ? Number(r.pricePerKm) : null,
      validFrom: dateStr(r.validFrom), validTo: dateStr(r.validTo), source: r.source,
    }));
  },
  parseRow: async (r, actor) => {
    const dc = req(r.directionCode, 'directionCode');
    const dir = await prisma.direction.findUnique({ where: { code: dc } });
    if (!dir) throw new Error(`'directionCode'='${dc}' не найдено`);
    const vtCode = req(r.vehicleTypeCode, 'vehicleTypeCode');
    const vt = await prisma.vehicleType.findUnique({ where: { code: vtCode } });
    if (!vt) throw new Error(`'vehicleTypeCode'='${vtCode}' не найден`);
    const validFrom = date(r.validFrom); if (!validFrom) throw new Error("'validFrom' обязательно");
    const data: any = {
      directionId: dir.id, vehicleTypeCode: vtCode,
      pricePerTrip: n(r.pricePerTrip), pricePerPallet: n(r.pricePerPallet), pricePerKm: n(r.pricePerKm),
      validFrom, validTo: date(r.validTo), source: s(r.source), updatedById: actor,
    };
    const id = `${dc}|${vtCode}|${validFrom.toISOString()}`;
    return { identity: id, data, record: {} };
  },
  fetchDiff: async () => {
    const rows = await prisma.marketPrice.findMany({ include: { direction: true } });
    return rows.map(r => ({ identity: `${r.direction.code}|${r.vehicleTypeCode}|${r.validFrom.toISOString()}`, displayName: `${r.direction.code} · ${r.vehicleTypeCode}`, _raw: r }));
  },
  upsertOne: async (p, actor) => {
    const existing = await prisma.marketPrice.findFirst({ where: { directionId: p.data.directionId, vehicleTypeCode: p.data.vehicleTypeCode, validFrom: p.data.validFrom } });
    if (existing) await prisma.marketPrice.update({ where: { id: existing.id }, data: p.data });
    else await prisma.marketPrice.create({ data: { ...p.data, createdById: actor } });
  },
  deleteOne: async (raw) => deleteOrSoft(() => prisma.marketPrice.delete({ where: { id: raw.id } }), null),
};

// ============ Реестр конфигов ============
const CONFIGS: Record<string, RefConfig> = {
  verticals: verticalCfg,
  locations: locationCfg,
  'vehicle-types': vehicleTypeCfg,
  carriers: carrierCfg,
  customers: customerCfg,
  vehicles: vehicleCfg,
  drivers: driverCfg,
  directions: directionCfg,
  'customer-contracts': customerContractCfg,
  'carrier-contracts': carrierContractCfg,
  tariffs: tariffCfg,
  'market-prices': marketPriceCfg,
};
const ALL = new Set(Object.keys(CONFIGS));
const must = (name: string): RefConfig => {
  if (!ALL.has(name)) throw new Error(`Неизвестный справочник: ${name}`);
  return CONFIGS[name];
};

// ============ Server Actions ============
export async function exportRef(name: string): Promise<{ rows: any[]; fileBaseName: string; label: string }> {
  await requireRole(W);
  const cfg = must(name);
  return { rows: await cfg.exportRows(), fileBaseName: cfg.fileBaseName, label: cfg.label };
}

export async function dryRunImportRef(name: string, rows: any[]): Promise<{
  ok: boolean; errors: string[]; rowsInFile: number; toDelete: { identity: string; displayName: string }[];
}> {
  await requireRole(W);
  const cfg = must(name);
  const actor = await getActorId();
  const parsed: { identity: string }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    try {
      const p = await cfg.parseRow(rows[i], actor);
      if (seen.has(p.identity)) errors.push(`Строка ${i + 2}: дубль идентификатора '${p.identity}' в файле`);
      seen.add(p.identity);
      parsed.push(p);
    } catch (e: any) { errors.push(`Строка ${i + 2}: ${e.message}`); }
  }
  if (errors.length) return { ok: false, errors, rowsInFile: parsed.length, toDelete: [] };
  const dbRows = await cfg.fetchDiff();
  const fileIds = new Set(parsed.map(p => p.identity));
  const toDelete = dbRows.filter(r => !fileIds.has(r.identity)).map(r => ({ identity: r.identity, displayName: r.displayName }));
  return { ok: true, errors: [], rowsInFile: parsed.length, toDelete };
}

export async function commitImportRef(name: string, rows: any[]): Promise<{
  upserted: number; deleted: number; softDeleted: number; skipped: number;
}> {
  await requireRole(W);
  const cfg = must(name);
  const actor = await getActorId();
  const parsed: { identity: string; data: any; record: any }[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const p = await cfg.parseRow(rows[i], actor);
      parsed.push(p);
    } catch (e: any) { errors.push(`Строка ${i + 2}: ${e.message}`); }
  }
  if (errors.length) throw new Error('Ошибки в файле:\n' + errors.join('\n'));
  for (const p of parsed) await cfg.upsertOne(p, actor);
  const dbRows = await cfg.fetchDiff();
  const fileIds = new Set(parsed.map(p => p.identity));
  let deleted = 0, softDeleted = 0, skipped = 0;
  for (const r of dbRows) {
    if (fileIds.has(r.identity)) continue;
    const result = await cfg.deleteOne(r._raw);
    if (result === 'deleted') deleted++;
    else if (result === 'softDeleted') softDeleted++;
    else skipped++;
  }
  for (const p of cfg.paths) revalidatePath(p);
  return { upserted: parsed.length, deleted, softDeleted, skipped };
}
