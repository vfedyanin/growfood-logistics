const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Шаблоны рейсов
  const templates = await prisma.tripTemplate.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log('\n=== Шаблоны рейсов ===');
  templates.forEach(t => console.log(`  ${t.id}  |  ${t.name}`));

  // Шаблон МСК-Пятёрочка НН
  const tpl = templates.find(t => t.name.toLowerCase().includes('пятёрочка') && t.name.toLowerCase().includes('транс'));
  if (tpl) {
    const full = await prisma.tripTemplate.findUnique({ where: { id: tpl.id } });
    console.log('\n=== Данные шаблона «' + tpl.name + '» ===');
    console.log(JSON.stringify(full.data, null, 2));
  } else {
    console.log('\n(шаблон с «пятёрочка» + «транс» не найден — показаны все выше)');
  }

  // Незакреплённые плечи с выгрузкой на Пятёрочка НН 04.04
  const from = new Date('2026-04-03T21:00:00.000Z'); // 04.04 00:00 MSK
  const to   = new Date('2026-04-04T21:00:00.000Z'); // 05.04 00:00 MSK
  const legs = await prisma.requestCargoLeg.findMany({
    where: {
      tripCargoUnitId: null,
      dropoffLocationId: 'cmpo5cwte000gkaiz5xfh9f6v', // Пятёрочка НН (Кстово)
      plannedDropoff: { gte: from, lt: to },
    },
    include: {
      cargo: { include: { request: { select: { requestNumber: true, customerId: true } }, consigneeLocation: true } },
      pickupLocation: true,
      dropoffLocation: true,
    },
  });
  console.log('\n=== Плечи → Пятёрочка НН (Кстово) с выгрузкой 04.04 (без рейса) ===');
  legs.forEach(l => {
    const req = l.cargo?.request;
    console.log(`  ${l.id} | ${req?.requestNumber || '—'} | ${l.pickupLocation?.name || '—'} → ${l.dropoffLocation?.name || '—'} | ${l.plannedPickup?.toISOString()} → ${l.plannedDropoff?.toISOString()} | ${l.cargo?.pallets ?? '—'} пал`);
  });
  console.log('Итого плеч:', legs.length);
}

main().catch(e => console.error(e.message)).finally(() => prisma.$disconnect());
