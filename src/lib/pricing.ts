// Ценообразование заявок: пересчёт итогов грузов и НДС.
//
// Серверный модуль (НЕ 'use server') — импортируется из server actions и из
// планирования, наружу как action не выставляется.
//
// Поиск клиентских тарифов живёт в @/lib/clientTariff (общий с дашбордом).
// Здесь только карта с legacy-фолбэком, пересчёт итогов и НДС.

import { prisma } from '@/lib/prisma';
import { tariffPrice } from '@/lib/tariff';
import { getClientTariffMap } from '@/lib/clientTariff';

const num = (v: any) => (v != null ? Number(v) : 0);

/**
 * Карта тарифов контрагента по точкам доставки: locationId → TariffInfo.
 * Клиентские тарифы по `Tariff.destinationLocationId` плюс legacy-фолбэк
 * на `CustomerDeliveryLocation` (сейчас таблица пустая, но фолбэк сохранён).
 */
export async function getCustomerTariffMap(partyId: string, requestDate?: Date) {
  const map = await getClientTariffMap(partyId, requestDate || new Date());

  const locs = await prisma.customerDeliveryLocation.findMany({ where: { customerId: partyId } });
  for (const l of locs) {
    if (!map.has(l.locationId)) map.set(l.locationId, { method: l.tariffMethod, amount: num(l.tariffAmount), tiers: [] });
  }

  return map;
}

/**
 * Ставка НДС клиента, в процентах.
 *
 * Тарифы хранятся БЕЗ НДС: в карточке договора оператор вводит цену с НДС, а
 * `createContractTariff` приводит её к net через деление на (1 + ставка/100).
 * Пользователю во всех суммах заявки показывается ОДНО число — с НДС.
 *
 * Проверено 28.07.2026: все 29 договоров имеют ставку 22%, нулевых нет, ни у
 * одного клиента нет двух активных договоров с разными ставками — поэтому
 * ставка определяется по контрагенту однозначно. Клиентов без НДС не бывает.
 */
export async function getCustomerVatRate(customerId: string): Promise<number> {
  if (!customerId) return 0;
  const c = await prisma.customerContract.findFirst({
    where: { isActive: true, OR: [{ customerId }, { members: { some: { customerId } } }] },
    orderBy: { createdAt: 'desc' },
    select: { vatRatePct: true },
  });
  return c?.vatRatePct != null ? Number(c.vatRatePct) : 0;
}

/** Начислить НДС на сумму без НДС. Округление до копеек. */
export function addVat(net: number | null | undefined, vatRatePct: number): number | null {
  if (net == null) return null;
  return Math.round(Number(net) * (1 + vatRatePct / 100) * 100) / 100;
}

/**
 * Пересчёт итоговой стоимости всех грузов заявки.
 *
 * TARIFF-грузы считаются с контекстом заявки: PER_PALLET = ставка × паллеты;
 * PER_TRIP с тирами — цена машины нужной вместимости; PER_TRIP без тиров —
 * ставка целиком (scope=CARGO) либо доля от суммы ставок уникальных точек,
 * делённая на число PER_TRIP-грузов (scope=REQUEST). Скидка вычитается из базы.
 *
 * Вызывать после ЛЮБОГО изменения состава или объёма грузов, включая создание
 * заявки из планирования — иначе сумма останется нулевой.
 */
export async function recomputeRequestFinals(requestId: string) {
  const req = await prisma.customerRequest.findUnique({
    where: { id: requestId },
    include: { cargoes: { include: { legs: true } } },
  });
  if (!req) return;

  // Тариф ищем по плательщику (кто оплачивает доставку), с фолбэком на заказчика
  const tariffs = await getCustomerTariffMap(req.payerId ?? req.customerId, req.requestDate ?? undefined);
  const tariffOf = (c: any) => (c.consigneeLocationId ? tariffs.get(c.consigneeLocationId) : undefined);

  const perTripCargoes = req.cargoes.filter(
    (c) => c.pricingMode === 'TARIFF' && tariffOf(c)?.method === 'PER_TRIP' && !(tariffOf(c)!.tiers.length > 0),
  );
  let perTripShare = 0;
  if (req.perTripScope === 'REQUEST' && perTripCargoes.length) {
    const uniqLocs = Array.from(new Set(perTripCargoes.map((c) => c.consigneeLocationId as string)));
    const total = uniqLocs.reduce((s, locId) => s + num(tariffs.get(locId)?.amount), 0);
    perTripShare = total / perTripCargoes.length;
  }

  for (const c of req.cargoes) {
    let final: number | null;
    if (c.pricingMode === 'TARIFF') {
      const t = tariffOf(c);
      let base = 0;
      if (t?.method === 'PER_PALLET') base = tariffPrice(t, num(c.pallets));
      else if (t?.method === 'PER_TRIP') {
        // PER_TRIP с тирами — цена по вместимости ТС; без тиров — фикс (или доля при scope=REQUEST)
        if (t.tiers.length > 0) base = tariffPrice(t, num(c.pallets));
        else base = req.perTripScope === 'REQUEST' ? perTripShare : num(t.amount);
      }
      final = Math.max(0, base - num(c.discount));
    } else if (c.pricingMode === 'LEG') {
      final = c.legs.reduce((s, l) => s + num(l.finalCost), 0);
    } else {
      final = c.cost != null || c.discount != null ? num(c.cost) - num(c.discount) : null;
    }
    await prisma.requestCargo.update({ where: { id: c.id }, data: { finalCost: final } });
  }

  // Кол-во паллет в шапке = сумма по грузам (грузы — источник истины).
  // Если ни у одного груза паллеты не заданы (например, учёт в лотках) — шапку не трогаем.
  const withPallets = req.cargoes.filter((c) => c.pallets != null);
  if (withPallets.length) {
    const totalPallets = withPallets.reduce((s, c) => s + num(c.pallets), 0);
    if (totalPallets !== req.requestedPallets) {
      await prisma.customerRequest.update({ where: { id: requestId }, data: { requestedPallets: totalPallets } });
    }
  }
}
