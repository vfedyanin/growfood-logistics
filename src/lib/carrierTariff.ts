// Тарифы перевозчика на направление: какие типы ТС ему доступны и с какой
// вместимостью. Один модуль на всех, кто это спрашивает — автопланирование и
// проверка при сохранении карточки направления. Копия этой логики в двух местах
// разъехалась бы, а правил тут два и оба неочевидные.
//
// ПРАВИЛО 1. Тариф относится к направлению, если у него стоит это направление
// ЛИБО совпадает пара точек «забор → выгрузка». В базе 107 из 121 тарифа
// перевозчиков ключуются парой, а не направлением, поэтому проверка только по
// направлению отсекла бы почти всех.
//
// ПРАВИЛО 2. `validTo` не заполнен ни у одного тарифа перевозчика (0 из 125),
// поэтому «действующий» определяется ТОЛЬКО по `validFrom`: внутри одного ключа
// действует весь набор строк с самой поздней датой, предыдущие даты — история.
// Так считает карточка договора (`dateGroups[0] = актуальный`). Иначе в подбор
// попадают закрытые машины: у Трансхолода версия от 20.06 содержит только VT-10
// и VT-18, а VT-20 остался в версии от 01.03 — брать его нельзя, хотя `validTo`
// у него пуст.

import { prisma } from '@/lib/prisma';

export type VehicleOption = { code: string; capacity: number };

export async function activeVehicleTypesForDirection(
  direction: { id: string; originId: string | null; destinationId: string | null },
  carrierId: string,
  on: Date,
): Promise<VehicleOption[]> {
  const pair =
    direction.originId && direction.destinationId
      ? [{ originLocationId: direction.originId, destinationLocationId: direction.destinationId }]
      : [];

  const tariffs = await prisma.tariff.findMany({
    where: {
      carrierContract: { carrierId },
      vehicleTypeCode: { not: null },
      validFrom: { lte: on },
      OR: [{ validTo: null }, { validTo: { gte: on } }],
      AND: [{ OR: [{ directionId: direction.id }, ...pair] }],
    },
    select: {
      vehicleTypeCode: true,
      validFrom: true,
      directionId: true,
      originLocationId: true,
      destinationLocationId: true,
      vehicleType: { select: { capacityPallets: true } },
    },
  });

  // Ключ как в карточке договора: направление, иначе пара точек.
  const keyOf = (t: (typeof tariffs)[number]) =>
    t.directionId ?? `${t.originLocationId ?? ''}_${t.destinationLocationId ?? ''}`;

  const latestByKey = new Map<string, number>();
  for (const t of tariffs) {
    const k = keyOf(t);
    const ts = t.validFrom.getTime();
    if (!latestByKey.has(k) || ts > latestByKey.get(k)!) latestByKey.set(k, ts);
  }

  const byCode = new Map<string, number>();
  for (const t of tariffs) {
    if (t.validFrom.getTime() !== latestByKey.get(keyOf(t))) continue; // историческая версия
    const cap = t.vehicleType?.capacityPallets;
    if (!t.vehicleTypeCode || !cap) continue; // без вместимости тип бесполезен
    byCode.set(t.vehicleTypeCode, cap);
  }
  return Array.from(byCode.entries()).map(([code, capacity]) => ({ code, capacity }));
}
