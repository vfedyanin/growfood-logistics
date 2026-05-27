/**
 * Импорт справочников из нормализованного JSON в БД (upsert по кодам).
 * Запуск: npx tsx scripts/import-references.ts [путь_к_json]
 * Порядок учитывает связи. Повторный запуск обновляет, а не дублирует.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();
const file = process.argv[2] || '/tmp/references.json';
const d = JSON.parse(fs.readFileSync(file, 'utf8'));

async function main() {
  const stats: Record<string, number> = {};

  // 1. Вертикали (PK = code)
  for (const v of d.verticals) {
    await prisma.vertical.upsert({
      where: { code: v.code },
      update: { name: v.name, type: v.type, isActive: v.isActive },
      create: { code: v.code, name: v.name, type: v.type, isActive: v.isActive },
    });
  }
  stats.verticals = d.verticals.length;

  // 2. Локации (uniq = code)
  const locId: Record<string, string> = {};
  for (const l of d.locations) {
    const row = await prisma.location.upsert({
      where: { code: l.code },
      update: { name: l.name, type: l.type, ownerType: l.ownerType, city: l.city, region: l.region, address: l.address, lat: l.lat, lon: l.lon, isActive: l.isActive },
      create: { code: l.code, name: l.name, type: l.type, ownerType: l.ownerType, city: l.city, region: l.region, address: l.address, lat: l.lat, lon: l.lon, isActive: l.isActive },
    });
    locId[l.code] = row.id;
  }
  stats.locations = d.locations.length;

  // 3. Типы ТС (PK = code)
  for (const t of d.vehicleTypes) {
    await prisma.vehicleType.upsert({
      where: { code: t.code },
      update: { name: t.name, capacityKg: t.capacityKg, capacityPallets: t.capacityPallets, isRefrigerator: t.isRefrigerator },
      create: { code: t.code, name: t.name, capacityKg: t.capacityKg, capacityPallets: t.capacityPallets, isRefrigerator: t.isRefrigerator },
    });
  }
  stats.vehicleTypes = d.vehicleTypes.length;

  // 4. Перевозчики (uniq = code)
  const carrierId: Record<string, string> = {};
  for (const c of d.carriers) {
    const row = await prisma.carrier.upsert({
      where: { code: c.code },
      update: { name: c.name, inn: c.inn, kpp: c.kpp, contactPerson: c.contactPerson, phone: c.phone, email: c.email, isActive: c.isActive, notes: c.notes },
      create: { code: c.code, name: c.name, inn: c.inn, kpp: c.kpp, contactPerson: c.contactPerson, phone: c.phone, email: c.email, isActive: c.isActive, notes: c.notes },
    });
    carrierId[c.code] = row.id;
  }
  stats.carriers = d.carriers.length;

  // 5. Контрагенты (uniq = code; verticalCode — FK по коду)
  for (const c of d.customers) {
    const data = { name: c.name, inn: c.inn, kpp: c.kpp, fullLegalName: c.fullLegalName, verticalCode: c.verticalCode, customerType: c.customerType, partyRole: c.partyRole, contactPerson: c.contactPerson, phone: c.phone, email: c.email, isActive: c.isActive, notes: c.notes };
    await prisma.customer.upsert({
      where: { code: c.code },
      update: data,
      create: { code: c.code, ...data },
    });
  }
  stats.customers = d.customers.length;

  // 6. Транспорт (uniq = plateNumber; vehicleTypeCode по коду, carrierCode -> id)
  for (const v of d.vehicles) {
    const data: any = { brandModel: v.brandModel, vehicleTypeCode: v.vehicleTypeCode, isActive: v.isActive, carrierId: v.carrierCode ? carrierId[v.carrierCode] : null };
    await prisma.vehicle.upsert({
      where: { plateNumber: v.plateNumber },
      update: data,
      create: { plateNumber: v.plateNumber, ...data },
    });
  }
  stats.vehicles = d.vehicles.length;

  // 7. Водители (нет уникального поля — ищем по ФИО+перевозчику)
  for (const dr of d.drivers) {
    const cid = dr.carrierCode ? carrierId[dr.carrierCode] : null;
    const existing = await prisma.driver.findFirst({ where: { fullName: dr.fullName, carrierId: cid } });
    const data = { phone: dr.phone, licenseNumber: dr.licenseNumber, isActive: dr.isActive, carrierId: cid };
    if (existing) await prisma.driver.update({ where: { id: existing.id }, data });
    else await prisma.driver.create({ data: { fullName: dr.fullName, ...data } });
  }
  stats.drivers = d.drivers.length;

  // 8. Маршруты (uniq = code; origin/destination -> location id)
  for (const r of d.routes) {
    const originId = locId[r.originCode];
    const destinationId = locId[r.destinationCode];
    if (!originId || !destinationId) throw new Error(`Маршрут ${r.code}: не найдена локация (${r.originCode} / ${r.destinationCode})`);
    const data = { name: r.name, originId, destinationId, distanceKm: r.distanceKm, estimatedHours: r.estimatedHours, routeType: r.routeType, isActive: r.isActive };
    await prisma.route.upsert({
      where: { code: r.code },
      update: data,
      create: { code: r.code, ...data },
    });
  }
  stats.routes = d.routes.length;

  console.log('Импорт завершён:', JSON.stringify(stats));
}

main().catch((e) => { console.error('ОШИБКА импорта:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
