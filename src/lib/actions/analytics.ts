'use server';

import { prisma } from '@/lib/prisma';
import { requireAuth, tripTypeScopeFor } from '@/lib/authz';

export type DashboardFilters = {
  dateFrom?: string;
  dateTo?: string;
  tripType?: 'OWN' | 'LAAS' | 'CONSOLIDATED';
  verticalCode?: string;
  shipperId?: string;
  consigneeId?: string;
  payerId?: string;
  carrierId?: string;
};

const num = (v: any) => (v != null ? Number(v) : 0);

export async function getDashboardMetrics(filters: DashboardFilters = {}) {
  const user = await requireAuth();
  // Учитываем все рейсы, кроме отменённых (план + факт), а не только COMPLETED:
  // метрики считаются по принципу «факт, иначе план».
  const where: any = { status: { not: 'CANCELLED' }, ...tripTypeScopeFor(user) };
  if (filters.tripType) where.tripType = filters.tripType;
  if (filters.verticalCode) where.verticalCode = filters.verticalCode;
  if (filters.shipperId) where.shipperId = filters.shipperId;
  if (filters.consigneeId) where.consigneeId = filters.consigneeId;
  if (filters.payerId) where.payerId = filters.payerId;
  if (filters.carrierId) where.carrierId = filters.carrierId;

  const [tripsRaw, marketPrices, tariffs] = await Promise.all([
    prisma.trip.findMany({
      where,
      include: {
        route: true, carrier: true, vertical: true,
        vehicleType: true,
        vehicle: { include: { vehicleType: true } },
        origin: true, destination: true,
        cargoUnits: { include: { vertical: true, customer: true } },
      },
    }),
    prisma.marketPrice.findMany(),
    prisma.tariff.findMany({ include: { carrierContract: { select: { carrierId: true } } } }),
  ]);

  // ===== Хелперы «факт, иначе план» =====
  const effVtCode = (t: any): string | null => t.vehicle?.vehicleTypeCode ?? t.vehicleTypeCode ?? null;
  const effVt = (t: any): any => t.vehicle?.vehicleType ?? t.vehicleType ?? null;
  const palletsOf = (t: any): number =>
    t.actualPallets ?? t.plannedPallets ?? t.cargoUnits.reduce((s: number, c: any) => s + (c.pallets || 0), 0);
  const effDate = (t: any): Date | null => t.actualArrival ?? t.plannedArrival ?? t.plannedDeparture ?? null;

  // Индекс тарифов по перевозчику+типу ТС для быстрого матча в памяти
  const tIdx = new Map<string, any[]>();
  for (const tar of tariffs) {
    const cid = (tar as any).carrierContract?.carrierId;
    if (!cid) continue;
    const k = `${cid}|${tar.vehicleTypeCode}`;
    const arr = tIdx.get(k) || [];
    arr.push(tar);
    tIdx.set(k, arr);
  }
  const tariffCost = (t: any): number => {
    const cid = t.carrierId; const vt = effVtCode(t);
    if (!cid || !vt) return 0;
    const cands = tIdx.get(`${cid}|${vt}`);
    if (!cands || !cands.length) return 0;
    const date = effDate(t) || new Date();
    const valid = cands.filter((x) => x.validFrom <= date && (x.validTo == null || x.validTo >= date));
    const pool = valid.length ? valid : cands;
    const pick = (t.routeId && pool.find((x) => x.routeId === t.routeId)) || pool.find((x) => x.routeId == null) || pool[0];
    if (!pick) return 0;
    const pallets = palletsOf(t);
    const km = t.route?.distanceKm ? Number(t.route.distanceKm) : 0;
    if (pick.pricePerTrip != null) return Number(pick.pricePerTrip);
    if (pick.pricePerPallet != null) return Number(pick.pricePerPallet) * pallets;
    if (pick.pricePerKm != null) return Number(pick.pricePerKm) * km;
    return 0;
  };
  const costOf = (t: any): number => (t.actualCost != null ? Number(t.actualCost) : tariffCost(t));

  // Фильтр по датам — по эффективной дате (факт/план), в памяти
  let trips = tripsRaw;
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const to = filters.dateTo ? new Date(filters.dateTo) : null;
    trips = trips.filter((t) => {
      const d = effDate(t);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  const tripsCount = trips.length;

  // ===== 1. Стоимость =====
  const totalCost = trips.reduce((s, t) => s + costOf(t), 0);
  const totalPallets = trips.reduce((s, t) => s + palletsOf(t), 0);
  const avgCostPerTrip = tripsCount ? totalCost / tripsCount : 0;

  const mpMap = new Map<string, number>();
  for (const mp of marketPrices) {
    if (mp.pricePerTrip != null) {
      const k = `${mp.routeId}|${mp.vehicleTypeCode}`;
      if (!mpMap.has(k)) mpMap.set(k, num(mp.pricePerTrip));
    }
  }
  let marketTotal = 0, hasMarket = false;
  for (const t of trips) {
    const vt = effVtCode(t);
    if (t.routeId && vt) {
      const p = mpMap.get(`${t.routeId}|${vt}`);
      if (p) { marketTotal += p; hasMarket = true; }
    }
  }
  const marketComparisonPct = hasMarket && marketTotal > 0 ? (totalCost / marketTotal) * 100 : null;

  const monthMap = new Map<string, { cost: number; pallets: number }>();
  for (const t of trips) {
    const d = effDate(t);
    if (!d) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const e = monthMap.get(k) || { cost: 0, pallets: 0 };
    e.cost += costOf(t); e.pallets += palletsOf(t);
    monthMap.set(k, e);
  }
  const byMonth = Array.from(monthMap.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, v]) => ({ month, cost: Math.round(v.cost), costPerPallet: v.pallets ? Math.round(v.cost / v.pallets) : 0 }));

  // ===== 2. Загрузка ТС (ёмкость по эффективному типу ТС) =====
  let sumLoad = 0, loadN = 0, high = 0, mid = 0, low = 0;
  const typeMap = new Map<string, { sum: number; n: number }>();
  for (const t of trips) {
    const vtObj = effVt(t);
    const cap = vtObj?.capacityPallets;
    const pal = palletsOf(t);
    if (cap && pal != null && pal > 0) {
      const pct = (pal / cap) * 100;
      sumLoad += pct; loadN++;
      if (pct >= 80) high++; else if (pct >= 60) mid++; else low++;
      const name = vtObj.name;
      const e = typeMap.get(name) || { sum: 0, n: 0 };
      e.sum += pct; e.n++; typeMap.set(name, e);
    }
  }
  const avgLoadPct = loadN ? sumLoad / loadN : 0;
  const loadByType = Array.from(typeMap.entries()).map(([type, v]) => ({ type, avgLoad: Math.round(v.sum / v.n), trips: v.n }));

  // ===== 3. Эффективность маршрутов =====
  const routeMap = new Map<string, { label: string; trips: number; cost: number; pallets: number; km: number }>();
  for (const t of trips) {
    const key = t.routeId || `${t.originId}-${t.destinationId}`;
    const label = t.route?.code || `${t.origin?.name || '—'} → ${t.destination?.name || '—'}`;
    const km = num(t.route?.distanceKm);
    const e = routeMap.get(key) || { label, trips: 0, cost: 0, pallets: 0, km };
    e.trips++; e.cost += costOf(t); e.pallets += palletsOf(t);
    routeMap.set(key, e);
  }
  const routes = Array.from(routeMap.values()).map((r) => ({
    route: r.label, trips: r.trips, cost: Math.round(r.cost), pallets: r.pallets,
    costPerPallet: r.pallets ? Math.round(r.cost / r.pallets) : 0,
    costPerPalletKm: r.pallets && r.km ? +(r.cost / (r.pallets * r.km)).toFixed(2) : 0,
  })).sort((a, b) => b.cost - a.cost).slice(0, 20);

  // ===== 4. Качество (OTD) — только по факту (появится по завершении рейсов) =====
  let withTimes = 0, onTime = 0, lateCount = 0, delaySum = 0, withActual = 0;
  for (const t of trips) {
    if (t.actualArrival) withActual++;
    if (t.plannedArrival && t.actualArrival) {
      withTimes++;
      const diffMin = (t.actualArrival.getTime() - t.plannedArrival.getTime()) / 60000;
      if (diffMin <= 30) onTime++; else { lateCount++; delaySum += diffMin; }
    }
  }
  const tripIds = trips.map((t) => t.id);
  const tempViolations = tripIds.length
    ? await prisma.qualityEvent.count({ where: { tripId: { in: tripIds }, eventType: 'TEMP_VIOLATION' } })
    : 0;
  const quality = {
    otdPct: withTimes ? Math.round((onTime / withTimes) * 100) : null,
    lateCount,
    avgDelayMin: lateCount ? Math.round(delaySum / lateCount) : 0,
    withActualTimePct: tripsCount ? Math.round((withActual / tripsCount) * 100) : 0,
    tempViolations,
  };

  // ===== 5/6. Аллокация по вертикалям / заказчикам (вес: лотки, иначе паллеты) =====
  const vertMap = new Map<string, number>();
  const custMap = new Map<string, { name: string; cost: number; trays: number }>();
  let totalTrays = 0;
  for (const t of trips) {
    const cost = costOf(t);
    const weights = t.cargoUnits.map((c: any) => (c.traysCount || c.pallets || 0));
    const wSum = weights.reduce((s: number, w: number) => s + w, 0);
    t.cargoUnits.forEach((c: any, i: number) => {
      totalTrays += (c.traysCount || 0);
      const share = wSum > 0 ? weights[i] / wSum : 0;
      const alloc = cost * share;
      const vName = c.vertical?.name || c.verticalCode || t.vertical?.name || '—';
      vertMap.set(vName, (vertMap.get(vName) || 0) + alloc);
      const cName = c.customer?.name || '—';
      const e = custMap.get(cName) || { name: cName, cost: 0, trays: 0 };
      e.cost += alloc; e.trays += c.traysCount || 0; custMap.set(cName, e);
    });
  }
  const byVertical = Array.from(vertMap.entries()).map(([vertical, cost]) => ({ vertical, cost: Math.round(cost) })).sort((a, b) => b.cost - a.cost);
  const byCustomer = Array.from(custMap.values()).map((c) => ({
    customer: c.name, cost: Math.round(c.cost), trays: c.trays, costPerTray: c.trays ? Math.round(c.cost / c.trays) : 0,
  })).sort((a, b) => b.cost - a.cost);

  // ===== 7. Лотки =====
  const trays = {
    total: totalTrays,
    perTrip: tripsCount ? +(totalTrays / tripsCount).toFixed(1) : 0,
    costPerTray: totalTrays ? Math.round(totalCost / totalTrays) : 0,
    perPallet: totalPallets ? +(totalTrays / totalPallets).toFixed(1) : 0,
  };

  // ===== Рентабельность клиентов LaaS по плательщикам =====
  // Вертикали LaaS: LAAS, LAAS-LTL, LAAS-B2C — матчим по префиксу.
  const requestFilter: any = { verticalCode: { startsWith: 'LAAS' } };
  if (filters.payerId) requestFilter.payerId = filters.payerId;
  if (filters.dateFrom || filters.dateTo) {
    requestFilter.requestDate = {};
    if (filters.dateFrom) requestFilter.requestDate.gte = new Date(filters.dateFrom);
    if (filters.dateTo) requestFilter.requestDate.lte = new Date(filters.dateTo);
  }
  const laasCargo = await prisma.requestCargo.findMany({
    where: { request: requestFilter },
    include: {
      request: { include: { payer: true, customer: true } },
      legs: {
        include: {
          tripCargoUnit: {
            include: {
              trip: { include: { route: true, vehicle: { include: { vehicleType: true } }, vehicleType: true, cargoUnits: true } },
            },
          },
        },
      },
    },
  });
  // Расход по плечу = доля стоимости рейса (факт allocatedCost, иначе по тарифу),
  // для рейсов в любом статусе кроме CANCELLED. Доля = вес плеча / Σ весов груза рейса.
  const legCost = (l: any): number => {
    const tcu = l.tripCargoUnit;
    if (!tcu) return 0;
    if (tcu.allocatedCost != null) return num(tcu.allocatedCost);
    const trip = tcu.trip;
    if (!trip || trip.status === 'CANCELLED') return 0;
    const units = trip.cargoUnits || [];
    const totalW = units.reduce((s: number, u: any) => s + (u.traysCount || u.pallets || 0), 0);
    const myW = tcu.traysCount || tcu.pallets || 0;
    const share = totalW > 0 ? myW / totalW : (units.length ? 1 / units.length : 0);
    return tariffCost(trip) * share;
  };
  const payerMap = new Map<string, { payer: string; revenue: number; cost: number }>();
  for (const c of laasCargo) {
    const payer = c.request.payer?.name || c.request.customer?.name || '—';
    const e = payerMap.get(payer) || { payer, revenue: 0, cost: 0 };
    e.revenue += num(c.finalCost);
    e.cost += c.legs.reduce((s, l) => s + legCost(l), 0);
    payerMap.set(payer, e);
  }
  const laasProfitability = Array.from(payerMap.values())
    .map((e) => ({
      payer: e.payer,
      revenue: Math.round(e.revenue),
      cost: Math.round(e.cost),
      profit: Math.round(e.revenue - e.cost),
      marginPct: e.revenue > 0 ? Math.round(((e.revenue - e.cost) / e.revenue) * 100) : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    laasProfitability,
    tripsCount,
    cost: { total: Math.round(totalCost), avgPerTrip: Math.round(avgCostPerTrip), totalPallets, marketComparisonPct, byMonth },
    load: { avgPct: Math.round(avgLoadPct), high, mid, low, byType: loadByType },
    routes,
    quality,
    byVertical,
    byCustomer,
    trays,
  };
}
