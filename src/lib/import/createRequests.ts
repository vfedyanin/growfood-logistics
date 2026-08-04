// Создание заявок из распарсенного PDF. Плоская lib-функция (не server action):
// вызывается и из скрипта, и из ручного запуска/крона. Авторизацию проверяет вызывающий.
import { prisma } from '@/lib/prisma';
import type { ParsedImport } from './types';
import { makeResolver } from './locationResolver';
import { getClientTariffMap } from '@/lib/clientTariff';
import { tariffPrice } from '@/lib/tariff';

export type ImportResult = {
  customer?: string;
  created: { requestNumber: string; destination: string; pallets: number; finalCost: number | null }[];
  skipped: { destination: string; reason: string }[];
  errors: string[];
  warnings: string[];
};

function combineDT(dateIso: string | null | undefined, hhmm: string | null | undefined): Date | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (hhmm) { const [h, m] = hhmm.split(':').map(Number); d.setUTCHours(h || 0, m || 0, 0, 0); }
  return d;
}

async function nextRequestNumber(dateIso: string | null | undefined): Promise<string> {
  const d = dateIso ? new Date(dateIso) : new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const full = `REQ-${ymd}-`;
  const last = await prisma.customerRequest.findFirst({ where: { requestNumber: { startsWith: full } }, orderBy: { requestNumber: 'desc' }, select: { requestNumber: true } });
  let n = 1;
  if (last) { const m = last.requestNumber.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  return `${full}${String(n).padStart(3, '0')}`;
}

export async function createRequestsFromParsed(
  parsed: ParsedImport,
  opts: { dryRun?: boolean; systemActorId?: string | null } = {},
): Promise<ImportResult> {
  const result: ImportResult = { created: [], skipped: [], errors: [], warnings: [...parsed.warnings] };
  const actor = opts.systemActorId ?? null;

  const customer = parsed.clientInn
    ? await prisma.customer.findFirst({ where: { inn: parsed.clientInn }, select: { id: true, name: true, verticalCode: true } })
    : null;
  if (!customer) {
    result.errors.push(`Контрагент по ИНН ${parsed.clientInn ?? '(нет)'} не найден в справочнике — заявки не созданы.`);
    return result;
  }
  result.customer = customer.name;

  // Договор с плательщиком — предпосылка для авто-цены (пока предупреждаем)
  const contract = await prisma.customerContract.findFirst({ where: { OR: [{ customerId: customer.id }, { members: { some: { customerId: customer.id } } }] }, select: { id: true } });
  if (!contract) result.warnings.push('У контрагента нет договора — авто-цена (finalCost) не будет рассчитана.');

  const locs = await prisma.location.findMany({ select: { id: true, name: true, city: true } });
  const resolve = makeResolver(locs.map((l) => ({ id: l.id, name: l.name })));

  // Индекс городов реестра — чтобы резолвить точку по знакомому городу из текста, когда
  // имя точки не нашлось (кривой OCR склеивает получателя/адрес в кашу).
  const cityIndex = new Map<string, { display: string; locs: { id: string; name: string }[] }>();
  for (const l of locs) {
    const c = (l.city ?? '').trim();
    if (!c) continue;
    const key = c.toLowerCase();
    if (!cityIndex.has(key)) cityIndex.set(key, { display: c, locs: [] });
    cityIndex.get(key)!.locs.push({ id: l.id, name: l.name });
  }
  // Основа слова — отсекаем окончание для склонений: «воронежу»→«воронеж», «москве»→«москв».
  const cityStem = (s: string) => s.toLowerCase().replace(/[аеёиійоуыьъэюя]+$/, '');
  // Города реестра, встретившиеся в тексте (по основе слова, регистронезависимо).
  const citiesInText = (txt: string): string[] => {
    const words = txt.toLowerCase().split(/[^а-яё]+/).filter((w) => w.length >= 4).map(cityStem);
    const found: string[] = [];
    for (const key of Array.from(cityIndex.keys())) {
      const cs = cityStem(key);
      if (cs.length >= 4 && words.some((w) => w.startsWith(cs))) found.push(key);
    }
    return found;
  };
  // Клиентские тарифы плательщика по точке — для авто-цены (finalCost груза)
  const tariffMap = await getClientTariffMap(customer.id, parsed.documentDate ? new Date(parsed.documentDate) : new Date());

  for (const r of parsed.requests) {
    let dest = resolve(r.destinationName);
    // Резолв по городу: имя точки не нашлось, но в тексте блока выгрузки есть знакомый город.
    // Один город → одна точка = берём; несколько точек в городе или ноль/несколько городов —
    // честная ошибка с фрагментом (не угадываем).
    if (!dest && r.destinationText) {
      const cities = citiesInText(r.destinationText);
      const frag = r.destinationText.slice(0, 200);
      if (cities.length === 1 && cityIndex.get(cities[0])!.locs.length === 1) {
        const entry = cityIndex.get(cities[0])!;
        dest = entry.locs[0];
        result.warnings.push(`Точка определена по городу «${entry.display}» из текста: ${dest.name}.`);
      } else if (cities.length === 1) {
        const entry = cityIndex.get(cities[0])!;
        result.skipped.push({ destination: r.destinationName, reason: `город «${entry.display}»: в реестре ${entry.locs.length} точки — уточните` });
        result.errors.push(`Город «${entry.display}» найден, но в реестре ${entry.locs.length} точки (${entry.locs.map((x) => x.name).join(', ')}) — уточните. Текст: «${frag}»`);
        continue;
      } else {
        result.skipped.push({ destination: r.destinationName, reason: `пункт назначения не определён (городов найдено: ${cities.length})` });
        result.errors.push(`Не удалось определить пункт назначения (совпадений городов: ${cities.length}). Текст: «${frag}»`);
        continue;
      }
    }
    if (!dest) { result.skipped.push({ destination: r.destinationName, reason: 'точка назначения не найдена в справочнике' }); result.errors.push(`Точка «${r.destinationName}» не найдена — заявка не создана.`); continue; }
    const pickup = resolve(r.pickupName);
    if (!pickup) { result.skipped.push({ destination: r.destinationName, reason: `точка забора «${r.pickupName}» не найдена` }); result.errors.push(`Точка забора «${r.pickupName}» не найдена — заявка на ${dest.name} не создана.`); continue; }
    if (!(r.pallets > 0)) { result.skipped.push({ destination: dest.name, reason: 'кол-во паллет не распознано (0)' }); continue; }

    // Дедуп: та же точка+плательщик+дата документа уже импортирована
    const dup = await prisma.customerRequest.findFirst({
      where: { source: 'EMAIL_IMPORT', payerId: customer.id, requestDate: parsed.documentDate ? new Date(parsed.documentDate) : undefined, cargoes: { some: { consigneeLocationId: dest.id } } },
      select: { requestNumber: true },
    });
    if (dup) { result.skipped.push({ destination: dest.name, reason: `уже импортирована ранее (${dup.requestNumber})` }); continue; }

    // Авто-цена по тарифу договора (PER_PALLET × паллеты / PER_TRIP / тир по вместимости ТС)
    const tariff = tariffMap.get(dest.id);
    const finalCost = tariff ? Math.max(0, tariffPrice(tariff, r.pallets)) : null;
    if (!tariff) result.warnings.push(`${dest.name}: нет клиентского тарифа по точке — цена (finalCost) не рассчитана.`);

    if (opts.dryRun) { result.created.push({ requestNumber: '(dry-run)', destination: dest.name, pallets: r.pallets, finalCost }); continue; }

    const requestNumber = await nextRequestNumber(parsed.documentDate);
    const created = await prisma.customerRequest.create({
      data: {
        requestNumber,
        customerId: customer.id,
        payerId: customer.id,
        verticalCode: customer.verticalCode,
        source: 'EMAIL_IMPORT',
        status: 'NEW',
        requestDate: parsed.documentDate ? new Date(parsed.documentDate) : new Date(),
        pickupLocationId: pickup.id,
        deliveryLocationId: dest.id,
        pickupDate: combineDT(r.pickupDate, r.pickupTimeFrom),
        pickupTimeFrom: r.pickupTimeFrom,
        pickupTimeTo: r.pickupTimeTo,
        deliveryDate: combineDT(r.deliveryDate, r.deliveryTimeFrom),
        deliveryTimeFrom: r.deliveryTimeFrom,
        deliveryTimeTo: r.deliveryTimeTo,
        requestedPallets: r.pallets,
        notes: r.notes,
        createdById: actor,
        updatedById: actor,
        cargoes: {
          create: [{
            consigneeLocationId: dest.id,
            unitType: 'PALLET',
            pallets: r.pallets,
            weightKg: r.weightKg ?? null,
            tempRegime: (r.tempRegime as any) ?? null,
            pricingMode: 'TARIFF',
            finalCost, // авто-цена по тарифу договора
            notes: r.notes,
            createdById: actor,
            updatedById: actor,
            legs: {
              create: [{
                legOrder: 1,
                pickupLocationId: pickup.id,
                dropoffLocationId: dest.id,
                plannedPickup: combineDT(r.pickupDate, r.pickupTimeFrom),
                plannedPickupTo: r.pickupTimeTo,
                plannedDropoff: combineDT(r.deliveryDate, r.deliveryTimeFrom),
                plannedDropoffTo: r.deliveryTimeTo,
                createdById: actor,
                updatedById: actor,
              }],
            },
          }],
        },
      },
      select: { requestNumber: true },
    });
    result.created.push({ requestNumber: created.requestNumber, destination: dest.name, pallets: r.pallets, finalCost });
  }
  return result;
}
