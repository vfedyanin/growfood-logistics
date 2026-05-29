const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
  const trips = await prisma.trip.count();
  const reqs  = await prisma.customerRequest.count();
  const tcus  = await prisma.tripCargoUnit.count();
  const legs  = await prisma.requestCargoLeg.count();
  const legsWithTrip = await prisma.requestCargoLeg.count({ where: { tripCargoUnitId: { not: null } } });
  const legsWithout  = legs - legsWithTrip;

  console.log('Рейсов:                        ', trips);
  console.log('Заявок:                        ', reqs);
  console.log('TCU (строк в рейсах):          ', tcus);
  console.log('Плечей всего:                  ', legs);
  console.log('Плечей привязано к рейсу:      ', legsWithTrip);
  console.log('Плечей без рейса (др. перевозч):', legsWithout);

  // Проверим TypeScript-ошибки через список рейсов
  const tripList = await prisma.trip.findMany({
    select: { tripNumber: true, status: true, _count: { select: { cargoUnits: true } } },
    orderBy: { tripNumber: 'asc' },
  });
  console.log('\nСписок рейсов:');
  tripList.forEach(t => console.log(`  ${t.tripNumber} | ${t.status} | грузов в рейсе: ${t._count.cargoUnits}`));
}
check().catch(e => console.error('ОШИБКА:', e.message)).finally(() => prisma.$disconnect());
