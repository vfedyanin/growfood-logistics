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

// Расшифровка температурного режима. Числового диапазона по конкретному грузу
// в базе нет — поля tempRequiredMin/Max пусты во всех строках, заполнен только
// enum. Поэтому диапазон здесь — фиксированная расшифровка режима, общая для всех.
const TEMP_LABEL: Record<string, string> = {
  FROZEN: '−18 °C',
  COOLED: '+2…+4 °C',
  AMBIENT: 'без режима',
};

export const tempLabel = (code: string | null | undefined) =>
  code ? TEMP_LABEL[code] ?? code : null;

// Одно действие на точке: погрузка или выгрузка конкретного груза.
type StopEvent = {
  locationId: string;
  loc: any;
  kind: 'load' | 'unload';
  at: number; // ключ сортировки по времени
  stamp: Date | null; // фактическое время для показа
  cargo: SheetCargo;
  ord: number; // ручной stopOrder
  pos: number; // позиция в маршруте направления
};

/**
 * @param trip рейс со связями (carrier, direction, vehicleType, vehicle, driver)
 * @param orderMap позиция локации в маршруте направления: locationId → position
 */
export function buildRouteSheet(trip: any, orderMap: Map<string, number>): RouteSheet {
  // Собираем ОТДЕЛЬНЫЕ действия, а не сразу точки: одна и та же локация может
  // встретиться в маршруте несколько раз. Рейс-забор бывает шаттлом — не всё
  // влезает в машину, поэтому она едет забор1 → хаб (выгрузить) → забор2 → снова
  // хаб. Если склеивать по локации, оба визита хаба сливаются в один, выгрузка
  // всплывает между заборами и лист врёт. Поэтому визиты не склеиваем: объединяем
  // только ПОДРЯД идущие действия на одной точке (один физический заезд).
  const events: StopEvent[] = [];

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

    const push = (locId: string, loc: any, at: number, stamp: any, kind: 'load' | 'unload') => {
      if (!locId || !loc) return;
      events.push({
        locationId: locId,
        loc,
        kind,
        at,
        stamp: stamp ? new Date(stamp) : null,
        cargo,
        ord,
        pos: orderMap.get(locId) ?? Number.MAX_SAFE_INTEGER,
      });
    };

    push(leg.pickupLocationId, leg.pickupLocation, pickupAt, leg.plannedPickup, 'load');
    push(leg.dropoffLocationId, leg.dropoffLocation, dropoffAt, leg.plannedDropoff, 'unload');
  }

  // Порядок действий: ручной stopOrder → позиция в маршруте направления → время
  // → погрузка раньше выгрузки → локация (для детерминизма при полном совпадении).
  events.sort(
    (a, b) =>
      a.ord - b.ord ||
      a.pos - b.pos ||
      a.at - b.at ||
      (a.kind === b.kind ? 0 : a.kind === 'load' ? -1 : 1) ||
      a.locationId.localeCompare(b.locationId),
  );

  // Объединяем только соседние действия на одной точке — это один заезд. Смена
  // локации у соседних действий = новый визит (в т.ч. повторный заезд на ту же).
  const stops: SheetStop[] = [];
  for (const ev of events) {
    let last = stops[stops.length - 1];
    if (!last || last.locationId !== ev.locationId) {
      last = {
        locationId: ev.locationId,
        name: clean(ev.loc.name) ?? '—',
        address: clean(ev.loc.address),
        time: null,
        load: [],
        unload: [],
      };
      stops.push(last);
    }
    last[ev.kind].push(ev.cargo);
    if (ev.stamp && (!last.time || ev.stamp < last.time)) last.time = ev.stamp;
  }

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
    stops,
  };
}
