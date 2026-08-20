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

// Стоимость рейса по тарифу перевозчика — нетто, как хранится в базе. Тем же
// ключом (направление ЛИБО пара точек) и той же выборкой действующей версии,
// что и подбор машин выше: иначе цена и вместимость считались бы по разным
// тарифам. Раньше стоимость автопланом не проставлялась вовсе, а ручной расчёт
// (tryAutoCalcEconomics) искал тариф только по directionId и не находил те 107
// из 121, что ключуются парой точек.
//
// Приоритет как в ручном расчёте: цена за рейс по типу ТС → за паллету → за км.
export async function activeCarrierTripCost(
  direction: { id: string; originId: string | null; destinationId: string | null; distanceKm: number | null },
  carrierId: string,
  vehicleTypeCode: string,
  pallets: number,
  on: Date,
): Promise<number | null> {
  const pair =
    direction.originId && direction.destinationId
      ? [{ originLocationId: direction.originId, destinationLocationId: direction.destinationId }]
      : [];

  const tariffs = await prisma.tariff.findMany({
    where: {
      carrierContract: { carrierId },
      validFrom: { lte: on },
      OR: [{ validTo: null }, { validTo: { gte: on } }],
      AND: [{ OR: [{ directionId: direction.id }, ...pair] }],
    },
    select: {
      vehicleTypeCode: true, validFrom: true, directionId: true,
      originLocationId: true, destinationLocationId: true,
      pricePerTrip: true, pricePerPallet: true, pricePerKm: true,
    },
  });

  const keyOf = (t: (typeof tariffs)[number]) =>
    t.directionId ?? `${t.originLocationId ?? ''}_${t.destinationLocationId ?? ''}`;
  const latestByKey = new Map<string, number>();
  for (const t of tariffs) {
    const k = keyOf(t);
    const ts = t.validFrom.getTime();
    if (!latestByKey.has(k) || ts > latestByKey.get(k)!) latestByKey.set(k, ts);
  }
  const active = tariffs.filter((t) => t.validFrom.getTime() === latestByKey.get(keyOf(t)));
  const round = (v: number) => Math.round(v * 100) / 100;

  const perTrip = active.find((t) => t.vehicleTypeCode === vehicleTypeCode && t.pricePerTrip != null);
  if (perTrip) return round(Number(perTrip.pricePerTrip));

  // Тариф за паллету/км может быть задан без типа ТС — тогда годится любой.
  const perPallet = active.find((t) => t.pricePerPallet != null && (t.vehicleTypeCode === vehicleTypeCode || t.vehicleTypeCode == null));
  if (perPallet) return round(Number(perPallet.pricePerPallet) * pallets);

  const perKm = active.find((t) => t.pricePerKm != null && (t.vehicleTypeCode === vehicleTypeCode || t.vehicleTypeCode == null));
  if (perKm && direction.distanceKm) return round(Number(perKm.pricePerKm) * Number(direction.distanceKm));

  return null;
}
