// Клиентские тарифы контрагента по точке доставки: destinationLocationId → TariffInfo.
// Единый источник для расчёта выручки (finalCost груза) — та же логика, что в дашборде (analytics).
// Матч: договоры, где party — сторона (customerId) или участник группы; тариф с destinationLocationId,
// валидный на дату; учитываются тиры (цена по вместимости ТС).
import { prisma } from '@/lib/prisma';
import { type TariffInfo, toTariffInfo } from '@/lib/tariff';

export async function getClientTariffMap(partyId: string, date: Date = new Date()): Promise<Map<string, TariffInfo>> {
  const map = new Map<string, TariffInfo>();
  const contracts = await prisma.customerContract.findMany({
    where: { OR: [{ customerId: partyId }, { members: { some: { customerId: partyId } } }] },
    select: { id: true },
  });
  const contractIds = contracts.map((c) => c.id);
  if (!contractIds.length) return map;

  const tariffs = await prisma.tariff.findMany({
    where: {
      customerContractId: { in: contractIds },
      destinationLocationId: { not: null },
      validFrom: { lte: date },
      OR: [{ validTo: null }, { validTo: { gte: date } }],
    },
    include: { tiers: { include: { vehicleType: { select: { capacityPallets: true } } } } },
    orderBy: { validFrom: 'desc' },
  });
  for (const t of tariffs) {
    const dest = t.destinationLocationId as string;
    if (!map.has(dest)) map.set(dest, toTariffInfo(t));
  }
  return map;
}
