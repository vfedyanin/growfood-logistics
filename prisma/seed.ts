import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ============ Verticals (5) ============
  const verticals = [
    { code: 'GROWFOOD', name: 'GrowFood (готовая продукция)', type: 'INTERNAL' as const },
    { code: 'LAAS', name: 'LaaS (магистральная логистика для КА)', type: 'EXTERNAL' as const },
    { code: 'RETAIL', name: 'Розничные сети', type: 'INTERNAL' as const },
    { code: 'PRIEM', name: 'Приёмка / сырьё', type: 'INTERNAL' as const },
    { code: 'VENDING', name: 'Вендинг', type: 'INTERNAL' as const },
  ];
  for (const v of verticals) {
    await prisma.vertical.upsert({ where: { code: v.code }, update: v, create: v });
  }

  // ============ VehicleTypes (8) ============
  const vehicleTypes = [
    { code: 'VAN_3T', name: 'Фургон 3т', capacityKg: 3000, capacityPallets: 6, isRefrigerator: false },
    { code: 'TRUCK_5T', name: 'Грузовик 5т', capacityKg: 5000, capacityPallets: 12, isRefrigerator: false },
    { code: 'TRUCK_10T', name: 'Грузовик 10т', capacityKg: 10000, capacityPallets: 16, isRefrigerator: false },
    { code: 'TRUCK_20T', name: 'Фура 20т', capacityKg: 20000, capacityPallets: 33, isRefrigerator: false },
    { code: 'REF_3T', name: 'Рефрижератор 3т', capacityKg: 3000, capacityPallets: 6, isRefrigerator: true },
    { code: 'REF_5T', name: 'Рефрижератор 5т', capacityKg: 5000, capacityPallets: 12, isRefrigerator: true },
    { code: 'REF_10T', name: 'Рефрижератор 10т', capacityKg: 10000, capacityPallets: 16, isRefrigerator: true },
    { code: 'REF_20T', name: 'Рефрижератор 20т', capacityKg: 20000, capacityPallets: 33, isRefrigerator: true },
  ];
  for (const vt of vehicleTypes) {
    await prisma.vehicleType.upsert({ where: { code: vt.code }, update: vt, create: vt });
  }

  // ============ Roles (8) + Permissions ============
  const rolesData = [
    { name: 'ADMIN', description: 'Полный доступ ко всему' },
    { name: 'LOGISTICS_MANAGER', description: 'Управление рейсами, заявками, грузами (CRUD)' },
    { name: 'LAAS_MANAGER', description: 'Рейсы только вертикали LAAS' },
    { name: 'OWN_DISPATCHER', description: 'Рейсы только вертикали OWN' },
    { name: 'WAREHOUSE_OPERATOR', description: 'Фиксация факта отгрузки (отправление)' },
    { name: 'RECEIVER_OPERATOR', description: 'Фиксация приёмки и инцидентов качества' },
    { name: 'ACCOUNTANT', description: 'Акты, счета, платежи' },
    { name: 'VIEWER', description: 'Только чтение' },
  ];
  const roles: Record<string, any> = {};
  for (const r of rolesData) {
    roles[r.name] = await prisma.role.upsert({ where: { name: r.name }, update: r, create: r });
  }

  const permissionsData = [
    { code: 'trips.read', name: 'Просмотр рейсов', category: 'operations' },
    { code: 'trips.write', name: 'Создание/редактирование рейсов', category: 'operations' },
    { code: 'trips.status', name: 'Смена статуса рейса', category: 'operations' },
    { code: 'cargo.write', name: 'Управление грузами', category: 'operations' },
    { code: 'quality.write', name: 'Регистрация событий качества', category: 'operations' },
    { code: 'references.write', name: 'Управление справочниками', category: 'references' },
    { code: 'finance.write', name: 'Акты, счета, платежи', category: 'finance' },
    { code: 'analytics.read', name: 'Просмотр аналитики', category: 'analytics' },
    { code: 'users.manage', name: 'Управление пользователями', category: 'admin' },
  ];
  const permissions: Record<string, any> = {};
  for (const p of permissionsData) {
    permissions[p.code] = await prisma.permission.upsert({ where: { code: p.code }, update: p, create: p });
  }

  // Назначение прав ролям (базовая матрица; детально — на Шаге 6)
  const roleMatrix: Record<string, string[]> = {
    ADMIN: permissionsData.map((p) => p.code),
    LOGISTICS_MANAGER: ['trips.read', 'trips.write', 'trips.status', 'cargo.write', 'quality.write', 'analytics.read'],
    LAAS_MANAGER: ['trips.read', 'trips.write', 'trips.status', 'cargo.write', 'analytics.read'],
    OWN_DISPATCHER: ['trips.read', 'trips.write', 'trips.status', 'cargo.write', 'analytics.read'],
    WAREHOUSE_OPERATOR: ['trips.read', 'trips.status'],
    RECEIVER_OPERATOR: ['trips.read', 'trips.status', 'quality.write'],
    ACCOUNTANT: ['trips.read', 'finance.write', 'analytics.read'],
    VIEWER: ['trips.read', 'analytics.read'],
  };
  for (const [roleName, codes] of Object.entries(roleMatrix)) {
    for (const code of codes) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roles[roleName].id, permissionId: permissions[code].id } },
        update: {},
        create: { roleId: roles[roleName].id, permissionId: permissions[code].id },
      });
    }
  }

  // ============ Admin user ============
  const admin = await prisma.user.upsert({
    where: { email: 'admin@growfood.ru' },
    update: {},
    create: {
      email: 'admin@growfood.ru',
      passwordHash: bcrypt.hashSync('admin123', 10),
      fullName: 'Администратор',
      isActive: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roles['ADMIN'].id } },
    update: {},
    create: { userId: admin.id, roleId: roles['ADMIN'].id },
  });

  // ============ Locations ============
  const locationsData = [
    { code: 'KOLPINO', name: 'Производство Колпино', type: 'FACTORY' as const, ownerType: 'OWN' as const, city: 'Санкт-Петербург', region: 'Ленинградская обл.' },
    { code: 'SPB_DC', name: 'РЦ Санкт-Петербург', type: 'DC' as const, ownerType: 'OWN' as const, city: 'Санкт-Петербург' },
    { code: 'MSK_DC', name: 'РЦ Москва', type: 'DC' as const, ownerType: 'OWN' as const, city: 'Москва' },
    { code: 'MAGNIT_MSK', name: 'Магнит РЦ Москва', type: 'RETAIL_POINT' as const, ownerType: 'CUSTOMER' as const, city: 'Москва' },
  ];
  const loc: Record<string, any> = {};
  for (const l of locationsData) {
    loc[l.code] = await prisma.location.upsert({ where: { code: l.code }, update: l, create: l });
  }

  // ============ Carriers ============
  const carriersData = [
    { code: 'OWN_FLEET', name: 'Собственный парк GrowFood', inn: '7800000001' },
    { code: 'DELLIN', name: 'Деловые Линии', inn: '7801234567' },
    { code: 'PEK', name: 'ПЭК', inn: '7807654321' },
  ];
  const car: Record<string, any> = {};
  for (const c of carriersData) {
    car[c.code] = await prisma.carrier.upsert({ where: { code: c.code }, update: c, create: c });
  }

  // ============ Customers ============
  const customersData = [
    { code: 'GF', name: 'GrowFood', verticalCode: 'GROWFOOD', customerType: 'INTERNAL' as const, partyRole: 'BOTH' as const, inn: '7800000010' },
    { code: 'MAGNIT', name: 'Магнит', verticalCode: 'RETAIL', customerType: 'RETAIL_CHAIN' as const, partyRole: 'CONSIGNEE' as const, inn: '2310031475' },
    { code: 'POLYANA', name: 'Поляна', verticalCode: 'LAAS', customerType: 'EXTERNAL_COMPANY' as const, partyRole: 'SHIPPER' as const, inn: '7700000020' },
  ];
  const cust: Record<string, any> = {};
  for (const c of customersData) {
    cust[c.code] = await prisma.customer.upsert({ where: { code: c.code }, update: c, create: c });
  }

  // ============ Vehicles ============
  const vehiclesData = [
    { plateNumber: 'А123БВ78', brandModel: 'Volvo FH', vehicleTypeCode: 'REF_20T', carrierId: car['OWN_FLEET'].id },
    { plateNumber: 'К456МН77', brandModel: 'MAN TGX', vehicleTypeCode: 'TRUCK_20T', carrierId: car['DELLIN'].id },
    { plateNumber: 'О789СТ78', brandModel: 'ГАЗель Next', vehicleTypeCode: 'REF_3T', carrierId: car['PEK'].id },
  ];
  const veh: Record<string, any> = {};
  for (const v of vehiclesData) {
    veh[v.plateNumber] = await prisma.vehicle.upsert({ where: { plateNumber: v.plateNumber }, update: v, create: v });
  }

  // ============ Drivers ============
  const driversData = [
    { fullName: 'Иванов Иван Иванович', phone: '+79211234567', licenseNumber: '7812345678', carrierId: car['OWN_FLEET'].id },
    { fullName: 'Петров Пётр Петрович', phone: '+79219876543', licenseNumber: '7898765432', carrierId: car['DELLIN'].id },
  ];
  const drivers: any[] = [];
  for (const d of driversData) {
    // у Driver нет уникального поля — ищем по ФИО+перевозчику, иначе создаём
    const existing = await prisma.driver.findFirst({ where: { fullName: d.fullName, carrierId: d.carrierId } });
    drivers.push(existing ?? (await prisma.driver.create({ data: d })));
  }

  // ============ Routes ============
  const routesData = [
    { code: 'KLP-SPB', name: 'Колпино → СПб', originId: loc['KOLPINO'].id, destinationId: loc['SPB_DC'].id, distanceKm: 35, estimatedHours: 1.5, routeType: 'DIRECT' as const },
    { code: 'KLP-MSK', name: 'Колпино → Москва', originId: loc['KOLPINO'].id, destinationId: loc['MSK_DC'].id, distanceKm: 720, estimatedHours: 12, routeType: 'DIRECT' as const },
  ];
  const rt: Record<string, any> = {};
  for (const r of routesData) {
    rt[r.code] = await prisma.direction.upsert({ where: { code: r.code }, update: r, create: r });
  }

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600000);

  // ============ Demo Trips ============
  // OWN-рейс, доставка в сеть Магнит: payer = consignee (Магнит)
  const trip1 = await prisma.trip.upsert({
    where: { tripNumber: 'TRIP-20260315-001' },
    update: {},
    create: {
      tripNumber: 'TRIP-20260315-001',
      tripType: 'OWN',
      verticalCode: 'RETAIL',
      directionId: rt['KLP-MSK'].id,
      originId: loc['KOLPINO'].id,
      destinationId: loc['MSK_DC'].id,
      vehicleId: veh['А123БВ78'].id,
      driverId: drivers[0].id,
      carrierId: car['OWN_FLEET'].id,
      shipperId: cust['GF'].id,
      consigneeId: cust['MAGNIT'].id,
      payerId: cust['MAGNIT'].id,
      plannedDeparture: daysAgo(3),
      plannedArrival: new Date(daysAgo(3).getTime() + 12 * 3600000),
      actualDeparture: daysAgo(3),
      actualArrival: new Date(daysAgo(3).getTime() + 12.3 * 3600000),
      plannedPallets: 33,
      actualPallets: 30,
      plannedWeightKg: 18000,
      actualWeightKg: 16500,
      actualCost: 85000,
      vatRatePct: 22,
      status: 'COMPLETED',
    },
  });

  // LAAS-рейс, груз Поляны консолидирован: payer = shipper (Поляна)
  const trip2 = await prisma.trip.upsert({
    where: { tripNumber: 'TRIP-20260316-002' },
    update: {},
    create: {
      tripNumber: 'TRIP-20260316-002',
      tripType: 'LAAS',
      verticalCode: 'LAAS',
      directionId: rt['KLP-SPB'].id,
      originId: loc['KOLPINO'].id,
      destinationId: loc['SPB_DC'].id,
      vehicleId: veh['К456МН77'].id,
      driverId: drivers[1].id,
      carrierId: car['DELLIN'].id,
      shipperId: cust['POLYANA'].id,
      consigneeId: cust['GF'].id,
      payerId: cust['POLYANA'].id,
      plannedDeparture: daysAgo(1),
      plannedArrival: new Date(daysAgo(1).getTime() + 1.5 * 3600000),
      actualDeparture: daysAgo(1),
      actualArrival: new Date(daysAgo(1).getTime() + 2.2 * 3600000), // опоздание ~42 мин
      plannedPallets: 22,
      actualPallets: 14,
      plannedWeightKg: 12000,
      actualWeightKg: 9000,
      actualCost: 18000,
      vatRatePct: 22,
      status: 'COMPLETED',
    },
  });

  // Будущий запланированный рейс
  await prisma.trip.upsert({
    where: { tripNumber: 'TRIP-20260320-003' },
    update: {},
    create: {
      tripNumber: 'TRIP-20260320-003',
      tripType: 'OWN',
      verticalCode: 'RETAIL',
      directionId: rt['KLP-MSK'].id,
      originId: loc['KOLPINO'].id,
      destinationId: loc['MSK_DC'].id,
      vehicleId: veh['А123БВ78'].id,
      carrierId: car['OWN_FLEET'].id,
      shipperId: cust['GF'].id,
      consigneeId: cust['MAGNIT'].id,
      payerId: cust['MAGNIT'].id,
      plannedDeparture: new Date(now.getTime() + 2 * 24 * 3600000),
      plannedArrival: new Date(now.getTime() + 2 * 24 * 3600000 + 12 * 3600000),
      plannedPallets: 33,
      plannedWeightKg: 18000,
      status: 'PLANNED',
    },
  });

  // ============ TripCargoUnit (для аллокации по лоткам и метрик) ============
  // trip1: два получателя внутри рейса GF (внутр.) + Магнит — аллокация по лоткам
  const tcuExists = await prisma.tripCargoUnit.count({ where: { tripId: trip1.id } });
  if (tcuExists === 0) {
    await prisma.tripCargoUnit.createMany({
      data: [
        { tripId: trip1.id, verticalCode: 'RETAIL', customerId: cust['MAGNIT'].id, shipperId: cust['GF'].id, unitType: 'PALLET', pallets: 20, traysCount: 240, weightKg: 11000, productCategory: 'READY_FOOD', tempRegime: 'COOLED', tempRequiredMin: 2, tempRequiredMax: 6 },
        { tripId: trip1.id, verticalCode: 'GROWFOOD', customerId: cust['GF'].id, shipperId: cust['GF'].id, unitType: 'PALLET', pallets: 10, traysCount: 120, weightKg: 5500, productCategory: 'READY_FOOD', tempRegime: 'COOLED', tempRequiredMin: 2, tempRequiredMax: 6 },
      ],
    });
  }
  const tcu2Exists = await prisma.tripCargoUnit.count({ where: { tripId: trip2.id } });
  if (tcu2Exists === 0) {
    await prisma.tripCargoUnit.create({
      data: { tripId: trip2.id, verticalCode: 'LAAS', customerId: cust['POLYANA'].id, shipperId: cust['POLYANA'].id, unitType: 'PALLET', pallets: 14, traysCount: 168, weightKg: 9000, productCategory: 'READY_FOOD', tempRegime: 'COOLED', tempRequiredMin: 2, tempRequiredMax: 6 },
    });
  }

  // ============ QualityEvent (опоздание trip2) ============
  const qeExists = await prisma.qualityEvent.count({ where: { tripId: trip2.id } });
  if (qeExists === 0) {
    await prisma.qualityEvent.create({
      data: {
        tripId: trip2.id,
        eventType: 'LATE_ARRIVAL',
        severity: 'MINOR',
        eventTime: trip2.actualArrival,
        delayMinutes: 42,
        description: 'Задержка на въезде в город',
        reportedById: admin.id,
      },
    });
  }

  // ============ MarketPrice (бенчмарк для сравнения) ============
  const mpExists = await prisma.marketPrice.count();
  if (mpExists === 0) {
    await prisma.marketPrice.createMany({
      data: [
        { directionId: rt['KLP-MSK'].id, vehicleTypeCode: 'REF_20T', pricePerTrip: 90000, pricePerPallet: 2700, validFrom: daysAgo(60), source: 'ПФГК прайс' },
        { directionId: rt['KLP-SPB'].id, vehicleTypeCode: 'TRUCK_20T', pricePerTrip: 20000, pricePerPallet: 900, validFrom: daysAgo(60), source: 'звонок ИП Иванов' },
      ],
    });
  }

  console.log('Seed completed: 5 verticals, 8 vehicle types, 8 roles, admin@growfood.ru / admin123, demo trips.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
