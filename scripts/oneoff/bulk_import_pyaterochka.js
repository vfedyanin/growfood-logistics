const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Расписание из файла LAAS (01.04–05.04, Пятёрочка НН) ──────────────────
const SCHEDULE = [
  { date: '2026-04-01', yumi: 3, sk: 4, ingr: 4, kv: 4 },
  { date: '2026-04-02', yumi: 3, sk: 3, ingr: 5, kv: 4 },
  { date: '2026-04-03', yumi: 3, sk: 4, ingr: 4, kv: 4 },
  { date: '2026-04-04', yumi: 3, sk: 5, ingr: 4, kv: 0 },
  { date: '2026-04-05', yumi: 3, sk: 5, ingr: 4, kv: 4 },
];

// ─── Данные клиентов (из шаблонов) ─────────────────────────────────────────
const CLIENTS = {
  yumi: {
    label:      'Йуми - Пятёрочка НН',
    customerId: 'cmpo5cyur001akaiz9s65l4zz',
    shipperId:  'cmpo5cyur001akaiz9s65l4zz',
    payerId:    'cmpo5cyur001akaiz9s65l4zz',
    ownPickup:  true,  // Трансхолод забирает сам
    kgPerPall:  250,   // 750kg / 3 pall
    // Leg1: Йуми произв. → КД Север Москва, 18:00–21:00 → 21:00–22:00
    l1Pickup:    { offsetH: 15, toTime: '21:00', locId: 'cmppiwkxz0000j0maeh9qr4xo' },
    l1Dropoff:   { offsetH: 18, toTime: '22:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    // Leg2: КД → Пятёрочка НН, 22:00 → +1d 06:00
    l2Pickup:    { offsetH: 19, toTime: '22:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    l2Dropoff:   { offsetH: 27, toTime: '08:00', locId: 'cmpo5cwte000gkaiz5xfh9f6v' },
  },
  sk: {
    label:      'СК - Пятёрочка НН',
    customerId: 'cmpo5czqi0026kaizjtjbk77d',
    shipperId:  'cmpo5czqi0026kaizjtjbk77d',
    payerId:    'cmpo5czqi0026kaizjtjbk77d',
    ownPickup:  true,  // Трансхолод забирает сам (с Йуми)
    kgPerPall:  250,   // 1000kg / 4 pall
    l1Pickup:    { offsetH: 15, toTime: '21:00', locId: 'cmppiwkxz0000j0maeh9qr4xo' },
    l1Dropoff:   { offsetH: 18, toTime: '22:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    l2Pickup:    { offsetH: 19, toTime: '22:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    l2Dropoff:   { offsetH: 27, toTime: '08:00', locId: 'cmpo5cwte000gkaiz5xfh9f6v' },
  },
  ingr: {
    label:      'Ингредика - Пятёрочка НН',
    customerId: 'cmpo5cyz1001ckaiz6gpkd41e',
    shipperId:  'cmpo5cyz1001ckaiz6gpkd41e',
    payerId:    'cmpo5cyz1001ckaiz6gpkd41e',
    ownPickup:  false, // Другой перевозчик везёт на КД
    kgPerPall:  250,   // 1250kg / 5 pall
    // Leg1: Ингредика произв. → КД Север Москва, 12:00–17:00 → 18:00–21:00
    l1Pickup:    { offsetH:  9, toTime: '17:00', locId: 'cmpptrnr0000u3anbcmx94qsw' },
    l1Dropoff:   { offsetH: 15, toTime: '21:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    l2Pickup:    { offsetH: 19, toTime: '22:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    l2Dropoff:   { offsetH: 27, toTime: '08:00', locId: 'cmpo5cwte000gkaiz5xfh9f6v' },
  },
  kv: {
    label:      'КВ - Пятёрочка НН',
    customerId: 'cmpo5cz0u001ekaizhbf6xvum',
    shipperId:  'cmpo5cz0u001ekaizhbf6xvum',
    payerId:    'cmpo5cz0u001ekaizhbf6xvum',
    ownPickup:  false, // Другой перевозчик везёт на КД
    kgPerPall:  100,   // 399kg / 4 pall ≈ 100
    // Leg1: КВ произв. → КД Север Москва, 15:00–18:00 → 18:00–21:00
    l1Pickup:    { offsetH: 12, toTime: '18:00', locId: 'cmpo5cw1w0001kaiztl26niek' },
    l1Dropoff:   { offsetH: 15, toTime: '21:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    l2Pickup:    { offsetH: 19, toTime: '22:00', locId: 'cmpo5cxl5000vkaizd0j4m9z3' },
    l2Dropoff:   { offsetH: 27, toTime: '08:00', locId: 'cmpo5cwte000gkaiz5xfh9f6v' },
  },
};

// ─── Шаблон рейса ───────────────────────────────────────────────────────────
const TRIP_TPL = {
  carrierId:       'cmpo5cyk20013kaizh7xp5v0b', // Трансхолод НН
  vehicleTypeCode: 'VT-18',
  tripType:        'OWN',
};

function ts(dateStr, offsetH) {
  return new Date(new Date(dateStr + 'T00:00:00.000Z').getTime() + offsetH * 3600000);
}

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  const actor = user?.id;

  // ── 1. Удалить все рейсы и заявки (шаблоны оставляем) ──
  const dt = await prisma.trip.deleteMany();
  const dr = await prisma.customerRequest.deleteMany();
  console.log(`Удалено: рейсов ${dt.count}, заявок ${dr.count}\n`);

  // ── Счётчики нумерации ──
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  let tripN = 0;

  // ── 2. По каждому дню ──
  for (const day of SCHEDULE) {
    console.log(`\n━━━ ${day.date} ━━━`);
    let reqN = 0;
    const toAttach = [];

    for (const [key, pallets] of Object.entries({ yumi: day.yumi, sk: day.sk, ingr: day.ingr, kv: day.kv })) {
      if (!pallets) continue;
      const c = CLIENTS[key];
      reqN++;
      const reqNum = `REQ-${day.date.replace(/-/g,'').slice(2)}-${String(reqN).padStart(3,'0')}`;

      const req = await prisma.customerRequest.create({
        data: {
          requestNumber: reqNum,
          customerId:    c.customerId,
          shipperId:     c.shipperId,
          payerId:       c.payerId,
          verticalCode:  'LAAS-LTL',
          requestDate:   new Date(day.date + 'T00:00:00.000Z'),
          status:        'NEW',
          createdById:   actor,
          updatedById:   actor,
          cargoes: {
            create: [{
              unitType:            'PALLET',
              pallets,
              weightKg:            pallets * c.kgPerPall,
              tempRegime:          'COOLED',
              pricingMode:         'CARGO',
              consigneeLocationId: c.l2Dropoff.locId,
              createdById:         actor,
              updatedById:         actor,
              legs: {
                create: [
                  {
                    legOrder:          1,
                    pickupLocationId:  c.l1Pickup.locId,
                    dropoffLocationId: c.l1Dropoff.locId,
                    plannedPickup:     ts(day.date, c.l1Pickup.offsetH),
                    plannedPickupTo:   c.l1Pickup.toTime,
                    plannedDropoff:    ts(day.date, c.l1Dropoff.offsetH),
                    plannedDropoffTo:  c.l1Dropoff.toTime,
                    createdById:       actor,
                    updatedById:       actor,
                  },
                  {
                    legOrder:          2,
                    pickupLocationId:  c.l2Pickup.locId,
                    dropoffLocationId: c.l2Dropoff.locId,
                    plannedPickup:     ts(day.date, c.l2Pickup.offsetH),
                    plannedPickupTo:   c.l2Pickup.toTime,
                    plannedDropoff:    ts(day.date, c.l2Dropoff.offsetH),
                    plannedDropoffTo:  c.l2Dropoff.toTime,
                    createdById:       actor,
                    updatedById:       actor,
                  },
                ],
              },
            }],
          },
        },
        include: { cargoes: { include: { legs: true } } },
      });

      const leg1 = req.cargoes[0].legs.find(l => l.legOrder === 1);
      const leg2 = req.cargoes[0].legs.find(l => l.legOrder === 2);
      toAttach.push({ leg1Id: c.ownPickup ? leg1.id : null, leg2Id: leg2.id, req, cargo: req.cargoes[0] });
      console.log(`  ✓ ${reqNum} | ${c.label} | ${pallets} пал`);
    }

    if (!toAttach.length) continue;

    // ── 3. Создать рейс ──
    tripN++;
    const tripNum = `TRIP-${ymd}-${String(tripN).padStart(3,'0')}`;
    const trip = await prisma.trip.create({
      data: {
        tripNumber:       tripNum,
        tripType:         TRIP_TPL.tripType,
        carrierId:        TRIP_TPL.carrierId,
        vehicleTypeCode:  TRIP_TPL.vehicleTypeCode,
        status:           'DRAFT',
        plannedDeparture: ts(day.date, 19),  // 22:00 MSK
        plannedArrival:   ts(day.date, 27),  // +1d 06:00 MSK
        createdById:      actor,
        updatedById:      actor,
      },
    });

    // ── 4. Привязать leg2 каждой заявки к рейсу ──
    let totalPall = 0;
    for (const { leg1Id, leg2Id, req, cargo } of toAttach) {
      const tcuData = {
        tripId:       trip.id,
        verticalCode: req.verticalCode || null,
        customerId:   cargo.consigneeId || req.customerId,
        shipperId:    req.shipperId || null,
        unitType:     'PALLET',
        pallets:      cargo.pallets,
        weightKg:     cargo.weightKg,
        tempRegime:   'COOLED',
        requestId:    req.id,
        createdById:  actor,
        updatedById:  actor,
      };
      // TCU для leg1 (забор: производство → КД) — только если Трансхолод везёт сам
      if (leg1Id) {
        const tcu1 = await prisma.tripCargoUnit.create({ data: tcuData });
        await prisma.requestCargoLeg.update({
          where: { id: leg1Id },
          data:  { tripCargoUnitId: tcu1.id, updatedById: actor },
        });
      }
      // TCU для leg2 (доставка: КД → Пятёрочка НН) — всегда Трансхолод
      const tcu2 = await prisma.tripCargoUnit.create({ data: tcuData });
      await prisma.requestCargoLeg.update({
        where: { id: leg2Id },
        data:  { tripCargoUnitId: tcu2.id, updatedById: actor },
      });
      totalPall += cargo.pallets || 0;
    }
    console.log(`  ✅ ${tripNum} | ${toAttach.length} клиентов | ${totalPall} пал итого`);
  }

  // ── Итог ──
  console.log('\n══════════════════════════════════');
  const reqCount  = await prisma.customerRequest.count();
  const tripCount = await prisma.trip.count();
  console.log(`✅ Готово! Заявок: ${reqCount}, Рейсов: ${tripCount}`);
}

main().catch(e => console.error('❌', e.message)).finally(() => prisma.$disconnect());
