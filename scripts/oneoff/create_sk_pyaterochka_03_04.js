const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Данные из шаблона «СК - Пятёрочка НН»
  const customerId  = 'cmpo5czqi0026kaizjtjbk77d'; // АО СК
  const shipperId   = 'cmpo5czqi0026kaizjtjbk77d';
  const payerId     = 'cmpo5czqi0026kaizjtjbk77d';
  const pickupLoc1  = 'cmppiwkxz0000j0maeh9qr4xo'; // Производство АО СК
  const transitLoc  = 'cmpo5cxl5000vkaizd0j4m9z3'; // КД ГФ (НН)
  const dropoffLoc  = 'cmpo5cwte000gkaiz5xfh9f6v'; // Пятёрочка НН (Кстово)

  // 03.04 → 04.04 (UTC = MSK - 3ч)
  // Плечо 1: загрузка на производстве 03.04 18:00–21:00 → КД 21:00–22:00
  const leg1Pickup  = new Date('2026-04-03T15:00:00.000Z'); // 18:00 MSK
  const leg1Dropoff = new Date('2026-04-03T18:00:00.000Z'); // 21:00 MSK
  // Плечо 2: КД 03.04 22:00 → Пятёрочка НН 04.04 06:00–08:00
  const leg2Pickup  = new Date('2026-04-03T19:00:00.000Z'); // 22:00 MSK
  const leg2Dropoff = new Date('2026-04-04T03:00:00.000Z'); // 06:00 MSK

  // Номер заявки
  const prefix = 'REQ-20260403-';
  const last = await prisma.customerRequest.findFirst({
    where: { requestNumber: { startsWith: prefix } },
    orderBy: { requestNumber: 'desc' },
  });
  const n = last ? parseInt(last.requestNumber.replace(prefix, '')) + 1 : 1;
  const requestNumber = prefix + String(n).padStart(3, '0');

  const user = await prisma.user.findFirst({ select: { id: true } });
  const actor = user?.id || null;

  const req = await prisma.customerRequest.create({
    data: {
      requestNumber,
      customerId,
      shipperId,
      payerId,
      verticalCode: 'LAAS-LTL',
      requestDate: new Date('2026-04-03T00:00:00.000Z'),
      status: 'NEW',
      createdById: actor,
      updatedById: actor,
      cargoes: {
        create: [{
          unitType: 'PALLET',
          pallets: 4,
          weightKg: 1000,
          tempRegime: 'COOLED',
          pricingMode: 'CARGO',
          consigneeLocationId: dropoffLoc,
          createdById: actor,
          updatedById: actor,
          legs: {
            create: [
              {
                legOrder: 1,
                pickupLocationId: pickupLoc1,
                dropoffLocationId: transitLoc,
                plannedPickup: leg1Pickup,
                plannedPickupTo: '21:00',
                plannedDropoff: leg1Dropoff,
                plannedDropoffTo: '22:00',
                createdById: actor,
                updatedById: actor,
              },
              {
                legOrder: 2,
                pickupLocationId: transitLoc,
                dropoffLocationId: dropoffLoc,
                plannedPickup: leg2Pickup,
                plannedPickupTo: '23:00',
                plannedDropoff: leg2Dropoff,
                plannedDropoffTo: '08:00',
                createdById: actor,
                updatedById: actor,
              },
            ],
          },
        }],
      },
    },
  });

  console.log('✅ Заявка создана:', req.requestNumber);
  console.log('   АО СК | 4 пал | COOLED | LAAS-LTL');
  console.log('   Плечо 1: производство → КД ГФ, 03.04 18:00–22:00');
  console.log('   Плечо 2: КД ГФ → Пятёрочка НН (Кстово), 03.04 22:00 → 04.04 06:00–08:00');
}

main().catch(e => console.error('❌', e.message)).finally(() => prisma.$disconnect());
