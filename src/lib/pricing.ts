// Ценообразование заявок: поиск точечных тарифов и пересчёт итогов грузов.
//
// Серверный модуль (НЕ 'use server') — импортируется из server actions, наружу
// как action не выставляется. Здесь единственная реализация поиска тарифа:
// раньше их было три (предпросмотр в форме, серверный расчёт, аналитика),
// причём две из них были заглушками и возвращали пустоту.

import { prisma } from '@/lib/prisma';
import { TariffInfo, toTariffInfo, tariffPrice } from '@/lib/tariff';

const num = (v: any) => (v != null ? Number(v) : 0);

/**
 * Точечные тарифы клиента: карта «локация выгрузки → тариф».
 *
 * Точечный тариф — это `Tariff` с заполненным `destinationLocationId` по договору
 * клиента. Клиент считается стороной договора, если он владелец (`customerId`)
 * либо участник (`members`) — иначе сводные договоры теряют тарифы.
 *
 * ВНИМАНИЕ на имена полей: у `Direction` — `originId`/`destinationId`,
 * у `Tariff` и `DirectionSchedule` — `originLocationId`/`destinationLocationId`.
 *
 * Среди действующих на дату берётся самый свежий по `validFrom`; если ни один не
 * действует — самый свежий вообще (иначе заявка «в прошлом» осталась бы без цены).
 */
export async function getCustomerPointTariffs(customerId: string, onDate?: Date) {
  const date = onDate || new Date();
  const map = new Map<string, TariffInfo>();
  if (!customerId) return map;

  const tariffs = await prisma.tariff.findMany({
    where: {
      destinationLocationId: { not: null },
      customerContract: {
        isActive: true,
        OR: [{ customerId }, { members: { some: { customerId } } }],
      },
    },
    include: { tiers: { include: { vehicleType: { select: { capacityPallets: true } } } } },
    orderBy: { validFrom: 'desc' },
  });

  type Row = (typeof tariffs)[number];
  const byDest = new Map<string, Row[]>();
  for (const t of tariffs) {
    const dest = t.destinationLocationId as string;
    const arr = byDest.get(dest) || [];
    arr.push(t);
    byDest.set(dest, arr);
  }

  for (const [locationId, cands] of Array.from(byDest.entries())) {
    const valid = cands.filter((t: Row) => t.validFrom <= date && (t.validTo == null || t.validTo >= date));
    const pick = (valid.length ? valid : cands)[0];
    if (pick) map.set(locationId, toTariffInfo(pick));
  }

  return map;
}

/**
 * Ставка НДС клиента, в процентах.
 *
 * Тарифы хранятся БЕЗ НДС: в карточке договора оператор вводит цену с НДС, а
 * `createContractTariff` приводит её к net через деление на (1 + ставка/100).
 * Пользователю же во всех суммах заявки показывается ОДНО число — с НДС.
 *
 * Проверено 28.07.2026: все 29 договоров имеют ставку 22%, нулевых нет, ни у
 * одного клиента нет двух активных договоров с разными ставками — поэтому
 * ставка определяется по клиенту однозначно. Клиентов без НДС не бывает.
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

  const tariffs = await getCustomerPointTariffs(req.customerId, req.requestDate ?? undefined);
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
