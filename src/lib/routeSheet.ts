// Сборка маршрутного листа: из рейса и его грузовых единиц получаем
// упорядоченный список остановок с погрузкой и выгрузкой на каждой.
//
// ПОРЯДОК ТОЧЕК ТОТ ЖЕ, ЧТО НА КАРТОЧКЕ РЕЙСА: ручной stopOrder → позиция в
// маршруте направления (RouteStop) → время плеча. Водитель и логист должны
// видеть одну и ту же последовательность, иначе лист начнёт спорить с экраном.
// Логика продублирована из buildStops в operations/trips/[id]/page.tsx намеренно:
// та живёт в клиентском компоненте и завязана на его типы. Если будете править
// приоритет сортировки — правьте В ОБОИХ местах, пока их не свели в один модуль.

export type SheetCargo = {
  pallets: number | null;
  weightKg: number | null;
  tempRegime: string | null;
  client: string | null;
  requestNumber: string | null;
  /** Конечная точка заявки — нужна на погрузке, чтобы было видно, куда это едет. */
  finalTo: string | null;
};

export type SheetStop = {
  locationId: string;
  name: string;
  address: string | null;
  /** Время самого раннего действия на точке. */
  time: Date | null;
  load: SheetCargo[];
  unload: SheetCargo[];
};

export type RouteSheet = {
  tripNumber: string;
  status: string;
  directionName: string | null;
  carrier: string | null;
  vehicleType: string | null;
  capacityPallets: number | null;
  plate: string | null;
  driver: string | null;
  driverPhone: string | null;
  plannedDeparture: Date | null;
  plannedArrival: Date | null;
  totalPallets: number;
  stops: SheetStop[];
};

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim() || null;

const TEMP_LABEL: Record<string, string> = {
  FROZEN: 'заморозка',
  COOLED: 'охлаждение',
  AMBIENT: 'без режима',
};

export const tempLabel = (code: string | null | undefined) =>
  code ? TEMP_LABEL[code] ?? code : null;

type StopAcc = SheetStop & { orderKey: number; pos: number; sortKey: number };

/**
 * @param trip рейс со связями (carrier, direction, vehicleType, vehicle, driver)
 * @param orderMap позиция локации в маршруте направления: locationId → position
 */
export function buildRouteSheet(trip: any, orderMap: Map<string, number>): RouteSheet {
  const map = new Map<string, StopAcc>();

  for (const u of trip.cargoUnits ?? []) {
    const leg = u.requestCargoLeg;
    if (!leg) continue;

    const pickupAt = leg.plannedPickup ? +new Date(leg.plannedPickup) : (leg.legOrder ?? 0) * 1e9;
    const dropoffAt = leg.plannedDropoff ? +new Date(leg.plannedDropoff) : pickupAt + 1;
    const ord = u.stopOrder != null ? Number(u.stopOrder) : Infinity;

    const cargo: SheetCargo = {
      pallets: u.pallets != null ? Number(u.pallets) : null,
      weightKg: u.weightKg != null ? Number(u.weightKg) : null,
      tempRegime: leg.cargo?.tempRegime ?? null,
      client: clean(u.customer?.name),
      requestNumber: u.request?.requestNumber ?? null,
      finalTo:
        clean(u.request?.deliveryLocation?.name) ??
        clean(leg.cargo?.consigneeLocation?.name) ??
        clean(leg.dropoffLocation?.name),
    };

    const touch = (locId: string, loc: any, at: number, kind: 'load' | 'unload') => {
      if (!locId || !loc) return;
      if (!map.has(locId)) {
        map.set(locId, {
          locationId: locId,
          name: clean(loc.name) ?? '—',
          address: clean(loc.address),
          time: null,
          load: [],
          unload: [],
          orderKey: ord,
          pos: orderMap.get(locId) ?? Number.MAX_SAFE_INTEGER,
          sortKey: at,
        });
      }
      const s = map.get(locId)!;
      if (at < s.sortKey) s.sortKey = at;
      if (ord < s.orderKey) s.orderKey = ord;
      const stamp = kind === 'load' ? leg.plannedPickup : leg.plannedDropoff;
      if (stamp && (!s.time || new Date(stamp) < s.time)) s.time = new Date(stamp);
      s[kind].push(cargo);
    };

    touch(leg.pickupLocationId, leg.pickupLocation, pickupAt, 'load');
    touch(leg.dropoffLocationId, leg.dropoffLocation, dropoffAt, 'unload');
  }

  const stops = Array.from(map.values()).sort(
    (a, b) => a.orderKey - b.orderKey || a.pos - b.pos || a.sortKey - b.sortKey,
  );

  // Всего паллет по рейсу — сумма погруженного, а не сумма по всем точкам:
  // иначе каждый груз посчитается дважды, на погрузке и на выгрузке.
  const totalPallets = stops.reduce(
    (sum, s) => sum + s.load.reduce((a, c) => a + (c.pallets ?? 0), 0),
    0,
  );

  return {
    tripNumber: trip.tripNumber,
    status: trip.status,
    directionName: clean(trip.direction?.name) ?? clean(trip.direction?.code),
    carrier: clean(trip.carrier?.name),
    vehicleType: clean(trip.vehicle?.vehicleType?.name) ?? clean(trip.vehicleType?.name),
    capacityPallets:
      trip.vehicle?.vehicleType?.capacityPallets ?? trip.vehicleType?.capacityPallets ?? null,
    plate: clean(trip.vehicle?.plateNumber),
    driver: clean(trip.driver?.fullName),
    driverPhone: clean(trip.driver?.phone),
    plannedDeparture: trip.plannedDeparture ? new Date(trip.plannedDeparture) : null,
    plannedArrival: trip.plannedArrival ? new Date(trip.plannedArrival) : null,
    totalPallets,
    // служебные ключи сортировки наружу не отдаём
    stops: stops.map(({ orderKey: _o, pos: _p, sortKey: _s, ...s }) => s),
  };
}
