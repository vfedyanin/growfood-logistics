/**
 * ОПАСНО: очищает ВСЕ бизнес- и справочные таблицы текущей БД (по .env),
 * сохраняя auth (User/Role/Permission/UserRole/RolePermission/Session),
 * шаблоны и аудит. Печатает host и счётчики до/после для верификации.
 * Запуск: node scripts/reset-business-data.js
 * Используется перед чистым импортом справочников (scripts/import-references.ts).
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const SQL = `TRUNCATE TABLE
  "Vertical","Location","Customer","Carrier","VehicleType","Vehicle","Driver","Route",
  "CustomerContract","CarrierContract","Tariff","MarketPrice",
  "Trip","TripLeg","TripCargoUnit","CargoUnit",
  "CustomerRequest","RequestCargo","RequestCargoLeg",
  "QualityEvent","CustomerAct","CarrierAct","ActTripLink","Invoice","Payment"
RESTART IDENTITY CASCADE`;

(async () => {
  const host = (fs.readFileSync('.env', 'utf8').match(/@([^/?]+)/) || [])[1];
  console.log('БД:', host);
  const snap = async () => ({
    vertical: await p.vertical.count(), location: await p.location.count(),
    carrier: await p.carrier.count(), customer: await p.customer.count(),
    route: await p.route.count(), trip: await p.trip.count(),
    request: await p.customerRequest.count(), vehicle: await p.vehicle.count(),
  });
  console.log('ДО:', JSON.stringify(await snap()));
  await p.$executeRawUnsafe(SQL);
  console.log('ПОСЛЕ:', JSON.stringify(await snap()));
  console.log('auth -> user:', await p.user.count(), 'role:', await p.role.count(), 'permission:', await p.permission.count());
  await p.$disconnect();
})().catch((e) => { console.error('ОШИБКА:', e.message); process.exit(1); });
