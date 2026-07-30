// Создание заявок из распарсенного PDF. Плоская lib-функция (не server action):
// вызывается и из скрипта, и из ручного запуска/крона. Авторизацию проверяет вызывающий.
//
// Задача 4: заполнение сторон (customer/payer/shipper/consignee) и плеч маршрута по
// правилам из importRules.ts (ключ = parserKey). Без правила — прежнее поведение
// (одно прямое плечо, payer = customer). Цена остаётся на уровне груза (cargo-level).
import { prisma } from '@/lib/prisma';
import type { ParsedImport, ParsedRequestDraft, ParsedCargoLine } from './types';
import { makeResolver } from './locationResolver';
import { getClientTariffMap } from '@/lib/clientTariff';
import { tariffPrice } from '@/lib/tariff';
import { getImportRule, type PartyRule, type LocationRef, type LocationChoice } from './importRules';

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

function isChoice(ref: LocationRef): ref is LocationChoice {
  return typeof ref !== 'string';
}

// Группа = будущая заявка. Без разбивки по бренду — вся заявка города; с разбивкой —
// подгруппа одного бренда (свои паллеты/вес/строки).
type Group = { r: ParsedRequestDraft; brand: string | null; pallets: number; weightKg: number | null; cargoLines: ParsedCargoLine[] };

function sumWeight(lines: ParsedCargoLine[]): number | null {
  const ws = lines.map((c) => c.weightKg).filter((w): w is number => w != null);
  return ws.length ? Math.round(ws.reduce((s, w) => s + w, 0) * 100) / 100 : null;
}

export async function createRequestsFromParsed(
  parsed: ParsedImport,
  opts: { dryRun?: boolean; systemActorId?: string | null; parserKey?: string | null } = {},
): Promise<ImportResult> {
  const result: ImportResult = { created: [], skipped: [], errors: [], warnings: [...parsed.warnings] };
  const actor = opts.systemActorId ?? null;
  const rule = getImportRule(opts.parserKey);

  // Заказчик (контрагент, от которого пришло письмо) — по ИНН.
  const customer = parsed.clientInn
    ? await prisma.customer.findFirst({ where: { inn: parsed.clientInn }, select: { id: true, name: true, verticalCode: true } })
    : null;
  if (!customer) {
    result.errors.push(`Контрагент по ИНН ${parsed.clientInn ?? '(нет)'} не найден в справочнике — заявки не созданы.`);
    return result;
  }
  result.customer = customer.name;
  const contractorId = customer.id;

  const contract = await prisma.customerContract.findFirst({ where: { OR: [{ customerId: customer.id }, { members: { some: { customerId: customer.id } } }] }, select: { id: true } });
  if (!contract) result.warnings.push('У контрагента нет договора — авто-цена (finalCost) не будет рассчитана.');

  // Точки: резолвер по имени (для «Самокат ГОРОД») + карта по коду (для правил).
  const locs = await prisma.location.findMany({ select: { id: true, name: true, code: true } });
  const resolveByName = makeResolver(locs.map((l) => ({ id: l.id, name: l.name })));
  const byCode = new Map(locs.map((l) => [l.code, { id: l.id, name: l.name }]));

  // Directions по паре (origin,destination) — для directionId плеч (тариф считаем cargo-level).
  const dirs = await prisma.direction.findMany({ select: { id: true, originId: true, destinationId: true } });
  const dirByPair = new Map(dirs.map((d) => [`${d.originId}:${d.destinationId}`, d.id]));

  // Контрагенты, на которые ссылаются правила (fixed.customerCode, brandMap) — по коду.
  const custByCode = new Map<string, { id: string; verticalCode: string | null }>();
  if (rule) {
    const codes = new Set<string>();
    for (const p of Object.values(rule.parties)) if (p.mode === 'fixed') codes.add(p.customerCode);
    if (rule.brandMap) for (const c of Object.values(rule.brandMap)) codes.add(c);
    if (codes.size) {
      const rows = await prisma.customer.findMany({ where: { code: { in: Array.from(codes) } }, select: { id: true, code: true, verticalCode: true } });
      for (const r of rows) custByCode.set(r.code, { id: r.id, verticalCode: r.verticalCode });
    }
  }

  const tariffMap = await getClientTariffMap(customer.id, parsed.documentDate ? new Date(parsed.documentDate) : new Date());

  // Сторона по правилу. Возвращает id или причину, почему не резолвится (→ на проверку).
  function resolveParty(pr: PartyRule, brand: string | null): { id: string | null; note?: string } {
    switch (pr.mode) {
      case 'contractor': return { id: contractorId };
      case 'fixed': { const c = custByCode.get(pr.customerCode); return c ? { id: c.id } : { id: null, note: `плательщик: код ${pr.customerCode} не найден` }; }
      case 'byBrand': {
        if (!rule?.brandMap || !brand) return { id: null, note: 'бренд груза не определён' };
        const code = rule.brandMap[brand.toLowerCase().trim()];
        if (!code) return { id: null, note: `бренд «${brand}» не сопоставлен (brandMap)` };
        const c = custByCode.get(code);
        return c ? { id: c.id } : { id: null, note: `контрагент бренда (${code}) не заведён` };
      }
      case 'byDestination': return { id: null, note: 'грузополучатель по точке — резолвится оператором' };
      case 'none': return { id: null };
    }
  }

  function refId(ref: LocationRef, pickupId: string, destId: string): string | null {
    if (isChoice(ref)) return null;
    if (ref === '$PICKUP') return pickupId;
    if (ref === '$DESTINATION') return destId;
    return byCode.get(ref)?.id ?? null;
  }

  // Строим плечи по правилу. Если хоть один конец — LocationChoice или не резолвится,
  // не создаём кривой мультимаршрут: одно прямое плечо + пометка «на проверку».
  function buildLegs(r: ParsedRequestDraft, pickupId: string, destId: string): { legs: any[]; review: boolean; notes: string[] } {
    const legRules = rule?.legs[r.city] ?? rule?.legs['*'];
    const directLeg = () => [{
      legOrder: 1, pickupLocationId: pickupId, dropoffLocationId: destId,
      directionId: dirByPair.get(`${pickupId}:${destId}`) ?? null,
      plannedPickup: combineDT(r.pickupDate, r.pickupTimeFrom), plannedPickupTo: r.pickupTimeTo,
      plannedDropoff: combineDT(r.deliveryDate, r.deliveryTimeFrom), plannedDropoffTo: r.deliveryTimeTo,
      createdById: actor, updatedById: actor,
    }];
    if (!legRules || !legRules.length) return { legs: directLeg(), review: false, notes: [] };

    const unresolved = legRules.some((lr) => isChoice(lr.from) || isChoice(lr.to) || refId(lr.from, pickupId, destId) == null || refId(lr.to, pickupId, destId) == null);
    if (unresolved) {
      return { legs: directLeg(), review: true, notes: [`маршрут не собран автоматически (${legRules.length} плеч, есть неопределённая точка) — прямое плечо, требует проверки`] };
    }
    const legs = legRules.map((lr, i) => {
      const from = refId(lr.from, pickupId, destId)!;
      const to = refId(lr.to, pickupId, destId)!;
      const first = i === 0;
      const lastLeg = i === legRules.length - 1;
      return {
        legOrder: i + 1, pickupLocationId: from, dropoffLocationId: to,
        directionId: dirByPair.get(`${from}:${to}`) ?? null,
        plannedPickup: first ? combineDT(r.pickupDate, r.pickupTimeFrom) : null, plannedPickupTo: first ? r.pickupTimeTo : null,
        plannedDropoff: lastLeg ? combineDT(r.deliveryDate, r.deliveryTimeFrom) : null, plannedDropoffTo: lastLeg ? r.deliveryTimeTo : null,
        createdById: actor, updatedById: actor,
      };
    });
    return { legs, review: false, notes: [] };
  }

  const splitByBrand = !!rule && rule.splitBy.includes('brand');

  for (const r of parsed.requests) {
    // Разбивка города на подгруппы (по бренду или единая).
    let groups: Group[];
    if (splitByBrand) {
      const byBrand = new Map<string, ParsedCargoLine[]>();
      for (const cl of r.cargoLines) {
        const key = (cl.brand || '').trim();
        if (!byBrand.has(key)) byBrand.set(key, []);
        byBrand.get(key)!.push(cl);
      }
      groups = Array.from(byBrand.entries()).map(([b, lines]) => ({
        r, brand: b || null, pallets: lines.reduce((s, c) => s + (c.pallets || 0), 0), weightKg: sumWeight(lines), cargoLines: lines,
      }));
    } else {
      groups = [{ r, brand: null, pallets: r.pallets, weightKg: r.weightKg ?? null, cargoLines: r.cargoLines }];
    }

    for (const g of groups) {
      const dest = resolveByName(g.r.destinationName);
      if (!dest) { result.skipped.push({ destination: g.r.destinationName, reason: 'точка назначения не найдена в справочнике' }); result.errors.push(`Точка «${g.r.destinationName}» не найдена — заявка не создана.`); continue; }

      // Точка забора: по коду из правила, иначе по имени (прежнее поведение).
      const pickup = rule ? byCode.get(rule.pickupLocationCode) : resolveByName(g.r.pickupName);
      if (!pickup) { const pn = rule ? rule.pickupLocationCode : g.r.pickupName; result.skipped.push({ destination: dest.name, reason: `точка забора «${pn}» не найдена` }); result.errors.push(`Точка забора «${pn}» не найдена — заявка на ${dest.name} не создана.`); continue; }
      if (!(g.pallets > 0)) { result.skipped.push({ destination: dest.name, reason: 'кол-во паллет не распознано (0)' }); continue; }

      // Стороны заявки.
      const brand = g.brand;
      const payerR = rule ? resolveParty(rule.parties.payer, brand) : { id: contractorId as string | null };
      const shipperR = rule ? resolveParty(rule.parties.shipper, brand) : { id: null as string | null };
      const consigneeR = rule ? resolveParty(rule.parties.consignee, brand) : { id: null as string | null };
      const customerR = rule ? resolveParty(rule.parties.customer, brand) : { id: contractorId as string | null };
      const customerId = customerR.id ?? contractorId; // customerId обязателен → контрагент по умолчанию
      const payerId = payerR.id ?? contractorId;

      const { legs, review: legsReview, notes: legNotes } = buildLegs(g.r, pickup.id, dest.id);
      const partyNotes = [payerR.note, shipperR.note, consigneeR.note, ...legNotes].filter(Boolean) as string[];
      const needsReview = (rule?.requiresReview ?? false) || legsReview || partyNotes.length > 0;
      const reviewTag = needsReview ? `[НА ПРОВЕРКУ] ${partyNotes.join('; ') || 'см. правило импорта'}` : '';
      const notes = [g.r.notes, brand ? `бренд: ${brand}` : '', reviewTag].filter(Boolean).join(' | ');

      // Дедуп: та же точка+плательщик+дата документа уже импортирована.
      const dup = await prisma.customerRequest.findFirst({
        where: { source: 'EMAIL_IMPORT', payerId, requestDate: parsed.documentDate ? new Date(parsed.documentDate) : undefined, cargoes: { some: { consigneeLocationId: dest.id } } },
        select: { requestNumber: true },
      });
      if (dup) { result.skipped.push({ destination: dest.name, reason: `уже импортирована ранее (${dup.requestNumber})` }); continue; }

      const tariff = tariffMap.get(dest.id);
      const finalCost = tariff ? Math.max(0, tariffPrice(tariff, g.pallets)) : null;
      if (!tariff) result.warnings.push(`${dest.name}: нет клиентского тарифа по точке — цена (finalCost) не рассчитана.`);

      if (opts.dryRun) {
        if (needsReview) result.warnings.push(`${dest.name}${brand ? ` (${brand})` : ''}: ${reviewTag}`);
        result.created.push({ requestNumber: '(dry-run)', destination: dest.name, pallets: g.pallets, finalCost });
        continue;
      }

      const requestNumber = await nextRequestNumber(parsed.documentDate);
      const created = await prisma.customerRequest.create({
        data: {
          requestNumber,
          customerId,
          payerId,
          verticalCode: customer.verticalCode,
          shipperId: shipperR.id,
          consigneeId: consigneeR.id,
          source: 'EMAIL_IMPORT',
          status: 'NEW',
          requestDate: parsed.documentDate ? new Date(parsed.documentDate) : new Date(),
          pickupLocationId: pickup.id,
          deliveryLocationId: dest.id,
          pickupDate: combineDT(g.r.pickupDate, g.r.pickupTimeFrom),
          pickupTimeFrom: g.r.pickupTimeFrom,
          pickupTimeTo: g.r.pickupTimeTo,
          deliveryDate: combineDT(g.r.deliveryDate, g.r.deliveryTimeFrom),
          deliveryTimeFrom: g.r.deliveryTimeFrom,
          deliveryTimeTo: g.r.deliveryTimeTo,
          requestedPallets: g.pallets,
          notes,
          createdById: actor,
          updatedById: actor,
          cargoes: {
            create: [{
              consigneeLocationId: dest.id,
              unitType: 'PALLET',
              pallets: g.pallets,
              weightKg: g.weightKg ?? null,
              tempRegime: (g.r.tempRegime as any) ?? null,
              pricingMode: 'TARIFF',
              finalCost,
              notes,
              createdById: actor,
              updatedById: actor,
              legs: { create: legs },
            }],
          },
        },
        select: { requestNumber: true },
      });
      result.created.push({ requestNumber: created.requestNumber, destination: dest.name, pallets: g.pallets, finalCost });
    }
  }
  return result;
}
