const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  const actor = user?.id || null;

  // --- 1. Данные из шаблона «МСК-Пятёрочка НН - Трансхолод» ---
  const carrierId      = 'cmpo5cyk20013kaizh7xp5v0b'; // Трансхолод НН
  const vehicleTypeCode = 'VT-18';
  const tripType       = 'OWN';

  // --- 2. Номер рейса ---
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  const prefix = `TRIP-${ymd}-`;
  const last = await prisma.trip.findFirst({ where: { tripNumber: { startsWith: prefix } }, orderBy: { tripNumber: 'desc' } });
  const n = last ? parseInt(last.tripNumber.match(/(\d+)$/)[1]) + 1 : 1;
  const tripNumber = prefix + String(n).padStart(3, '0');

  // --- 3. Создать рейс ---
  const trip = await prisma.trip.create({
    data: {
      tripNumber,
      tripType,
      carrierId,
      vehicleTypeCode,
      status: 'DRAFT',
      plannedDeparture: new Date('2026-04-03T19:00:00.000Z'), // 03.04 22:00 MSK
      plannedArrival:   new Date('2026-04-04T03:00:00.000Z'), // 04.04 06:00 MSK
      createdById: actor,
      updatedById: actor,
    },
  });
  console.log('✅ Рейс создан:', trip.tripNumber, '(', trip.id, ')');

  // --- 4. Найти все плечи → Пятёрочка НН (Кстово) с выгрузкой 04.04 ---
  const from = new Date('2026-04-03T21:00:00.000Z');
  const to   = new Date('2026-04-04T21:00:00.000Z');
  const legs = await prisma.requestCargoLeg.findMany({
    where: {
      tripCargoUnitId: null,
      dropoffLocationId: 'cmpo5cwte000gkaiz5xfh9f6v',
      plannedDropoff: { gte: from, lt: to },
    },
    include: {
      cargo: { include: { request: true } },
    },
  });
  console.log(`\nНайдено плеч для привязки: ${legs.length}`);

  // --- 5. Привязать каждое плечо к рейсу ---
  for (const leg of legs) {
    const req   = leg.cargo.request;
    const cargo = leg.cargo;
    const tcu = await prisma.tripCargoUnit.create({
      data: {
        tripId:          trip.id,
        verticalCode:    req.verticalCode || null,
        customerId:      cargo.consigneeId || req.consigneeId || req.customerId,
        shipperId:       req.shipperId || null,
        unitType:        cargo.unitType || 'PALLET',
        pallets:         cargo.pallets ?? null,
        traysCount:      cargo.traysCount ?? null,
        weightKg:        cargo.weightKg ?? null,
        productCategory: cargo.productCategory || null,
        tempRegime:      cargo.tempRegime || null,
        requestId:       req.id,
        createdById:     actor,
        updatedById:     actor,
      },
    });
    await prisma.requestCargoLeg.update({
      where: { id: leg.id },
      data: { tripCargoUnitId: tcu.id, updatedById: actor },
    });
    console.log(`  ✓ Привязано: ${req.requestNumber} | ${cargo.pallets} пал → tcu ${tcu.id}`);
  }

  console.log('\nГотово. Рейс:', trip.tripNumber);
}

main().catch(e => console.error('❌', e.message)).finally(() => prisma.$disconnect());
