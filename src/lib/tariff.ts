// Единая тарифная логика — применяется и к клиентским тарифам (выручка),
// и к тарифам перевозчиков (себестоимость). Уважает tariffType и тиры по вместимости ТС.
// Раньше расчёт был продублирован: клиентский в actions/requests.ts и устаревший
// перевозчицкий в actions/analytics.ts (брал pricePerTrip, игнорируя tariffType).

export type TariffTierInfo = { capacityPallets: number; price: number };
export type TariffInfo = { method: string | null; amount: number; tiers: TariffTierInfo[] };

const n = (v: any) => (v != null ? Number(v) : 0);

// Нормализация строки Prisma Tariff в TariffInfo.
// Ожидает include: { tiers: { include: { vehicleType: { select: { capacityPallets: true } } } } }.
export function toTariffInfo(t: any): TariffInfo {
  const method: string | null = t.tariffType ?? null;
  const amount = method === 'PER_PALLET' ? n(t.pricePerPallet) : n(t.pricePerTrip);
  const tiers: TariffTierInfo[] = (t.tiers || [])
    .filter((tier: any) => tier.vehicleType?.capacityPallets != null)
    .map((tier: any) => ({ capacityPallets: tier.vehicleType.capacityPallets as number, price: n(tier.price) }));
  return { method, amount, tiers };
}

// Итоговая цена по тарифу для груза/плеча с заданным кол-вом паллет.
// PER_PALLET → ставка × паллеты; PER_TRIP → фикс за рейс; PER_TRIP с тирами →
// цена минимальной машины, вмещающей это число паллет.
export function tariffPrice(t: TariffInfo, pallets: number): number {
  if (t.method === 'PER_TRIP' && t.tiers.length > 0) {
    const sorted = [...t.tiers].sort((a, b) => a.capacityPallets - b.capacityPallets);
    const match = sorted.find((tier) => tier.capacityPallets >= pallets);
    return match ? match.price : sorted[sorted.length - 1].price;
  }
  if (t.method === 'PER_PALLET') return t.amount * pallets;
  return t.amount; // PER_TRIP без тиров
}
