import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) Найти клиента АО СК
  const aosk = await prisma.customer.findFirst({
    where: { OR: [{ code: 'AOSK' }, { name: { contains: 'АО СК' } }] },
  });
  if (!aosk) {
    console.error('Клиент АО СК не найден');
    const all = await prisma.customer.findMany({ select: { id: true, code: true, name: true } });
    console.log('Все клиенты:', JSON.stringify(all, null, 2));
    process.exit(1);
  }
  console.log('АО СК:', aosk.id, aosk.code, aosk.name);

  // 2) Создать или найти локацию "Йуми (произв.)"
  let yumi = await prisma.location.findFirst({
    where: { OR: [{ code: 'LOC-YUMI-PROD' }, { name: { contains: 'Йуми' } }] },
  });
  if (!yumi) {
    yumi = await prisma.location.create({
      data: {
        code: 'LOC-YUMI-PROD',
        name: 'Йуми (произв.)',
        type: 'WAREHOUSE',
        ownerType: 'PARTNER' as any,
        city: 'Москва',
        address: 'ул. Прянишникова',
        isActive: true,
      },
    });
    console.log('Создана локация Йуми (произв.):', yumi.id);
  } else {
    console.log('Локация Йуми уже есть:', yumi.id, yumi.name);
  }

  // 3) Найти локацию Пятёрочка НН (Кстово) = LOC-NN5
  const nn5 = await prisma.location.findFirst({
    where: { OR: [{ code: 'LOC-NN5' }, { name: { contains: 'Кстово' } }] },
  });
  if (!nn5) {
    console.error('Локация Пятёрочка НН (Кстово) / LOC-NN5 не найдена');
    const locs = await prisma.location.findMany({ where: { city: { contains: 'Нижний' } }, select: { id: true, code: true, name: true, city: true } });
    console.log('Локации НН:', JSON.stringify(locs, null, 2));
    process.exit(1);
  }
  console.log('Пятёрочка НН (Кстово):', nn5.id, nn5.code, nn5.name);

  // 4) Найти или получить первый user для auditing
  const user = await prisma.user.findFirst();
  const actorId = user?.id ?? null;

  // 5) Сгенерировать номер заявки REQ-20260401-001
  const prefix = 'REQ-20260401-';
  const existing = await prisma.customerRequest.findFirst({
    where: { requestNumber: { startsWith: prefix } },
    orderBy: { requestNumber: 'desc' },
  });
  let n = 1;
  if (existing) {
    const m = existing.requestNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1]) + 1;
  }
  const requestNumber = `${prefix}${String(n).padStart(3, '0')}`;
  console.log('Номер заявки:', requestNumber);

  // 6) Создать заявку
  const req = await prisma.customerRequest.create({
    data: {
      requestNumber,
      requestDate: new Date('2026-04-01'),
      status: 'NEW',
      customerId: aosk.id,
      pickupLocationId: yumi.id,
      deliveryLocationId: nn5.id,
      pickupDate: new Date('2026-04-01'),
      pickupTimeFrom: '15:00',
      pickupTimeTo: '18:00',
      deliveryDate: new Date('2026-04-02'),
      createdById: actorId,
      updatedById: actorId,
    },
  });
  console.log('Создана заявка:', req.id, req.requestNumber);

  // 7) Создать груз с плечом
  const cargo = await prisma.requestCargo.create({
    data: {
      requestId: req.id,
      unitType: 'PALLET',
      pallets: 4,
      weightKg: 1000,
      pricingMode: 'CARGO',
      cost: 16000,   // 4 паллета × 4000₽
      finalCost: 16000,
      createdById: actorId,
      updatedById: actorId,
    },
  });
  console.log('Создан груз:', cargo.id);

  // 8) Создать плечо
  const leg = await prisma.requestCargoLeg.create({
    data: {
      requestCargoId: cargo.id,
      legOrder: 1,
      pickupLocationId: yumi.id,
      dropoffLocationId: nn5.id,
      plannedPickup: new Date('2026-04-01T15:00:00'),
      plannedPickupTo: '18:00',
      plannedDropoff: new Date('2026-04-02T00:00:00'),
      createdById: actorId,
      updatedById: actorId,
    },
  });
  console.log('Создано плечо:', leg.id);
  console.log('Готово!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
