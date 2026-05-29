const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tripId = 'cmppwihau0001orscrz71q8yt'; // TRIP-20260528-002

  // Найти все незакреплённые плечи из REQ-20260403-001
  const req = await prisma.customerRequest.findUnique({
    where: { requestNumber: 'REQ-20260403-001' },
    include: {
      cargoes: {
        include: {
          legs: {
            include: { pickupLocation: true, dropoffLocation: true },
          },
        },
      },
    },
  });

  if (!req) { console.log('Заявка не найдена'); return; }

  console.log('Заявка:', req.requestNumber);
  for (const cargo of req.cargoes) {
    for (const leg of cargo.legs) {
      console.log(`  Плечо ${leg.legOrder}: ${leg.pickupLocation?.name} → ${leg.dropoffLocation?.name} | tripCargoUnitId: ${leg.tripCargoUnitId || '(нет)'}`);
    }
  }

  const user = await prisma.user.findFirst({ select: { id: true } });
  const actor = user?.id || null;

  // Привязать незакреплённые плечи того же груза к рейсу
  for (const cargo of req.cargoes) {
    for (const leg of cargo.legs) {
      if (leg.tripCargoUnitId) {
        console.log(`  ✓ Плечо ${leg.legOrder} уже привязано`);
        continue;
      }
      const tcu = await prisma.tripCargoUnit.create({
        data: {
          tripId,
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
      console.log(`  ✅ Привязано плечо ${leg.legOrder}: ${leg.pickupLocation?.name} → ${leg.dropoffLocation?.name}`);
    }
  }
}

main().catch(e => console.error('❌', e.message)).finally(() => prisma.$disconnect());
