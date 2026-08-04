'use server';

import { prisma } from '@/lib/prisma';
import { serialize } from '@/lib/serialize';
import { requireAuth, requireRole, getActorId, RoleName } from '@/lib/authz';
import { recomputeRequestFinals } from '@/lib/pricing';
import { nextRequestNumber } from '@/lib/numbering';
import { revalidatePath } from 'next/cache';

const W: RoleName[] = ['LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER'];

/**
 * Переносит время из шаблонного плеча на расчётную дату.
 * У шаблона своей даты нет — берём часы/минуты, а дату даёт планирование.
 */
function withTime(base: Date | null, legDateRaw: string | null | undefined): Date | null {
  if (!base) return null;
  if (!legDateRaw) return base;
  const src = new Date(legDateRaw);
  if (isNaN(src.getTime())) return base;
  const result = new Date(base);
  result.setUTCHours(src.getUTCHours(), src.getUTCMinutes(), 0, 0);
  return result;
}

export async function getPlanningData(weekStartISO: string) {
  await requireAuth();

  const weekStart = new Date(weekStartISO);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // Берём версии графика, действовавшие на ОТОБРАЖАЕМУЮ неделю, а не последние:
  // иначе прошлые недели рисуются по сегодняшним правилам и картина прошлого врёт.
  // Пересечение периода версии с неделей: validFrom < конец недели И
  // (validTo пусто ИЛИ validTo >= начало недели).
  const schedules = await prisma.directionSchedule.findMany({
    where: {
      validFrom: { lt: weekEnd },
      OR: [{ validTo: null }, { validTo: { gte: weekStart } }],
      AND: [{
        OR: [
          { mon: { not: null } },
          { tue: { not: null } },
          { wed: { not: null } },
          { thu: { not: null } },
          { fri: { not: null } },
          { sat: { not: null } },
          { sun: { not: null } },
        ],
      }],
    },
    include: {
      customerContract: { include: { customer: true } },
      direction: { include: { origin: true, destination: true } },
      originLocation: true,
      destinationLocation: true,
      requestTemplate: true,
    },
    orderBy: [{ originLocationId: 'asc' }, { destinationLocationId: 'asc' }],
  });

  // Направление графика = ПЕРВОЕ магистральное плечо привязанного шаблона.
  // Планируется машина, выходящая из хаба: если груз идёт МСК→Казань→Ижевск,
  // он должен попасть в группу МСК-Казань, а не Казань-Ижевск.
  //
  // Заборное плечо отсекаем по двум признакам:
  //  (а) у направления не заданы origin/destination — псевдо-направления MSK-MSK
  //      «Москва-Москва» и SPB-SPB;
  //  (б) плечо приходит на ХАБ КОНСОЛИДАЦИИ и после него в шаблоне есть ещё плечи,
  //      то есть груз на хабе перегружают, а не сдают. Так устроены CHEF-MSK
  //      (ШефМаркет → РЦ МСК), STUDIA-MSK, ELEM-MSK: у них origin/destination
  //      заполнены, и признака (а) недостаточно — «ШефМаркет - КД НН» попадал
  //      в группу CHEF-MSK вместо MSK-NN.
  //      Условие «есть плечи после» обязательно: для «ШефМаркет - РЦ МСК» или
  //      «ВкусМилл - РЦ СПБ» хаб и есть конечная точка, там это магистраль.
  //
  // ВНИМАНИЕ: у Direction поля originId/destinationId, у DirectionSchedule —
  // originLocationId/destinationLocationId.
  const allDirections = await prisma.direction.findMany({
    include: { origin: { select: { id: true, name: true } }, destination: { select: { id: true, name: true } } },
  });
  const dirById = new Map(allDirections.map((d) => [d.id, d]));

  const hubLocations = await prisma.location.findMany({
    where: { code: { in: ['LOC-MSK-SOUTH', 'LOC-MSK-NORTH', 'LOC-SPB'] } },
    select: { id: true },
  });
  const hubIds = new Set(hubLocations.map((h) => h.id));

  const locNames = await prisma.location.findMany({ select: { id: true, name: true } });
  const locNameById = new Map(locNames.map((l) => [l.id, l.name]));

  const schedulesWithDirection = schedules.map((s) => {
    const legs: any[] = (((s.requestTemplate?.data as any)?.cargoes) || []).flatMap((c: any) => c.legs || []);

    let magistral: any;
    let magistralIdx = -1;
    for (let i = 0; i < legs.length; i++) {
      const d = legs[i].directionId ? dirById.get(legs[i].directionId) : undefined;
      if (!d || !d.originId || !d.destinationId) continue;                      // (а)
      if (i !== legs.length - 1 && hubIds.has(legs[i].dropoffLocationId)) continue; // (б)
      magistral = d;
      magistralIdx = i;
      break;
    }

    // Плечи ПОСЛЕ магистрального — это перевозки из транзитного города
    // (Казань → Ижевск / Уфа / Самара). Физически это тот же груз и та же
    // заявка, но другая машина и другой перевозчик, поэтому в сетке они
    // показываются отдельной группой — только для чтения, ввод остаётся
    // в ячейке города отправления. Иначе одни паллеты введут дважды.
    // День отправления из транзитного города = день ячейки + pickupDayOffset плеча.
    const onward = legs.slice(magistralIdx + 1).flatMap((leg: any) => {
      const d = leg.directionId ? dirById.get(leg.directionId) : undefined;
      if (!d || !d.originId || !d.destinationId) return [];
      if (leg.pickupDayOffset == null) return []; // без смещения день не определить
      return [{
        directionId: d.id,
        code: d.code,
        name: d.name,
        originName: d.origin?.name ?? null,
        destinationName: d.destination?.name ?? null,
        legDestinationName: leg.dropoffLocationId ? locNameById.get(leg.dropoffLocationId) ?? null : null,
        dayShift: leg.pickupDayOffset as number,
      }];
    });

    return {
      ...s,
      magistralDirection: magistral
        ? {
            id: magistral.id,
            code: magistral.code,
            name: magistral.name,
            originName: magistral.origin?.name ?? null,
            destinationName: magistral.destination?.name ?? null,
          }
        : null,
      onward,
    };
  });

  // Окно шире отображаемой недели: строка транзитного города показывает заявку,
  // забранную на dayShift дней раньше, и в понедельник это воскресенье прошлой недели.
  const reqFrom = new Date(weekStart);
  reqFrom.setDate(reqFrom.getDate() - 7);

  const requests = await prisma.customerRequest.findMany({
    where: { pickupDate: { gte: reqFrom, lt: weekEnd } },
    select: {
      id: true,
      requestNumber: true,
      customerId: true,
      pickupLocationId: true,
      deliveryLocationId: true,
      pickupDate: true,
      requestedPallets: true,
      status: true,
    },
  });

  return serialize({ schedules: schedulesWithDirection, requests });
}

export async function createPlanningRequest(input: {
  customerId: string;
  pickupLocationId: string;
  deliveryLocationId: string;
  pickupDate: string;
  requestedPallets: number;
  transitDays?: number | null;
  requestTemplateId?: string | null;
}) {
  await requireRole(W);
  const actor = await getActorId();

  const today = new Date();
  // Номер считается от ПОСЛЕДНЕГО существующего, а не от количества заявок:
  // при подсчёте количества любое удаление заявки приводило к повтору номера
  // и падению на уникальном индексе requestNumber.
  const requestNumber = await nextRequestNumber('REQ');

  const pickupDateObj = new Date(input.pickupDate);

  // Предзаполняем из шаблона если есть
  let tplData: any = null;
  if (input.requestTemplateId) {
    const tpl = await prisma.requestTemplate.findUnique({ where: { id: input.requestTemplateId } });
    if (tpl) tplData = tpl.data as any;
  }

  // Дата доставки. Источник истины — смещения в шаблоне (задача #23): берём
  // максимальное смещение выгрузки, это и есть день прибытия в конечную точку.
  // Число в графике оставлено как «возим/не возим» и как fallback для шаблонов,
  // где смещения ещё не заданы.
  const tplLegs: any[] = ((tplData?.cargoes) || []).flatMap((c: any) => c.legs || []);
  const maxDropoffOffset = tplLegs.reduce(
    (max: number | null, l: any) =>
      l.dropoffDayOffset != null ? Math.max(max ?? 0, Number(l.dropoffDayOffset)) : max,
    null as number | null,
  );

  let deliveryDate: Date | null = null;
  // Срок в графике: null = в этот день не возим, 0 = доставка в день забора.
  // Ноль обязателен именно как значение, а не как «пусто» — иначе внутригородские
  // плечи с доставкой день-в-день остались бы без даты доставки.
  const totalDays = maxDropoffOffset ?? input.transitDays;
  if (totalDays != null) {
    deliveryDate = new Date(pickupDateObj);
    deliveryDate.setDate(deliveryDate.getDate() + Number(totalDays));
  }

  const r = await prisma.customerRequest.create({
    data: {
      requestNumber,
      customerId: input.customerId,
      pickupLocationId: input.pickupLocationId,
      deliveryLocationId: input.deliveryLocationId,
      pickupDate: pickupDateObj,
      deliveryDate: deliveryDate,
      requestDate: today,
      requestedPallets: input.requestedPallets,
      status: 'NEW',
      payerId: tplData?.payerId ?? null,
      shipperId: tplData?.shipperId ?? null,
      verticalCode: tplData?.verticalCode ?? null,
      createdById: actor,
      updatedById: actor,
    },
  });

  // Если к расписанию привязан шаблон — создаём грузы и плечи
  if (tplData) {
    const cargoes: any[] = tplData?.cargoes ?? [];

    for (const cargo of cargoes) {
      const createdCargo = await prisma.requestCargo.create({
        data: {
          requestId: r.id,
          consigneeId: cargo.consigneeId ?? null,
          consigneeLocationId: cargo.consigneeLocationId ?? null,
          unitType: cargo.unitType ?? 'PALLET',
          pallets: input.requestedPallets,
          traysCount: cargo.traysCount ?? null,
          weightKg: cargo.weightKg ?? null,
          productCategory: cargo.productCategory ?? null,
          tempRegime: cargo.tempRegime ?? null,
          pricingMode: cargo.pricingMode ?? 'CARGO',
          notes: cargo.notes ?? null,
          createdById: actor,
          updatedById: actor,
        },
      });
      const legs: any[] = cargo.legs ?? [];
      const n = legs.length;
      for (let i = 0; i < n; i++) {
        const leg = legs[i];
        const isFirst = i === 0;
        const isLast = i === n - 1;

        // Даты плеч считаются от X = дня, в чью ячейку вписали паллеты.
        // Смещение в днях хранится в шаблоне у каждого плеча (задача #23):
        // внутридневные перевалки получают одинаковые смещения, ночные — разные.
        // Раньше дату получали только края маршрута, а стыки на хабах оставались
        // пустыми и такие плечи выпадали из фильтров и подбора в рейс.
        const addDays = (base: Date, n: number) => {
          const d = new Date(base);
          d.setDate(d.getDate() + n);
          return d;
        };
        const pOff = leg.pickupDayOffset;
        const dOff = leg.dropoffDayOffset;

        const pickupBase =
          pOff != null ? addDays(pickupDateObj, Number(pOff)) : isFirst ? pickupDateObj : null;
        const dropoffBase =
          dOff != null
            ? addDays(pickupDateObj, Number(dOff))
            : isLast
              ? deliveryDate
              : null;

        await prisma.requestCargoLeg.create({
          data: {
            requestCargoId: createdCargo.id,
            legOrder: i + 1,
            pickupLocationId: leg.pickupLocationId ?? null,
            dropoffLocationId: leg.dropoffLocationId ?? null,
            directionId: leg.directionId ?? null,
            plannedPickup: withTime(pickupBase, leg.plannedPickupFrom ?? leg.plannedPickup),
            plannedPickupTo: leg.plannedPickupTo ?? null,
            plannedDropoff: withTime(dropoffBase, leg.plannedDropoffFrom ?? leg.plannedDropoff),
            plannedDropoffTo: leg.plannedDropoffTo ?? null,
            createdById: actor,
            updatedById: actor,
          },
        });
      }
    }
  }

  // Считаем стоимость грузов. Раньше этого вызова тут не было, и заявки из
  // планирования всегда получали нулевую сумму — при любом режиме ценообразования.
  await recomputeRequestFinals(r.id);

  revalidatePath('/operations/planning');
  revalidatePath('/requests');

  return { id: r.id, requestNumber: r.requestNumber };
}
