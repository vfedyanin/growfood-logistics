// Общие кирпичи создания рейса: номер рейса и сборка грузовой единицы из груза
// заявки. Вынесены из actions/requests.ts, чтобы автопланирование не завело
// вторую нумерацию — две реализации номера рейса рано или поздно разойдутся и
// подерутся на уникальном индексе tripNumber.
//
// Модуль намеренно НЕ 'use server': это внутренние помощники, а не серверные
// действия. В файле с 'use server' синхронный экспорт запрещён.

import { prisma } from '@/lib/prisma';

/** Номер рейса TRIP-ГГГГММДД-NNN, считается от последнего существующего за день. */
export async function nextTripNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `TRIP-${ymd}-`;
  const last = await prisma.trip.findFirst({
    where: { tripNumber: { startsWith: prefix } },
    orderBy: { tripNumber: 'desc' },
  });
  let n = 1;
  if (last) {
    const m = last.tripNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1]) + 1;
  }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ============ Вертикали рейса (перечисление MONO/MIX) ============
//
// У рейса хранится ПЕРЕЧИСЛЕНИЕ фактических вертикалей груза (verticalCodes):
// MONO — один элемент, MIX — несколько. Само «MONO/MIX» не храним, это следствие
// длины списка, как и «перебор» в автопланировании: запрос, а не состояние.
//
// ЗАЧЕМ. Раньше тип рейса брался с ПЕРВОГО плеча, поэтому машина с грузом двух
// вертикалей получала тип наугад. На боевых данных так и вышло: рейсы с составом
// LAAS-LTL + PRIEM помечены OWN, и LAAS-менеджер их не видит.
//
// ПОЧЕМУ ПРЕФИКС, А НЕ РАВЕНСТВО. Кода вертикали 'LAAS' в справочнике НЕТ —
// есть LAAS-LTL и LAAS-B2C. Сравнение verticalCode === 'LAAS' не срабатывало
// никогда, из-за чего 68 чисто ласовых рейсов помечены OWN. Так же (по префиксу)
// считает аналитика.
const isLaas = (code: string | null | undefined) => !!code && code.startsWith('LAAS');

/** Уникальный отсортированный список вертикалей рейса. Пустые коды отбрасываем. */
export function tripVerticalsFrom(codes: (string | null | undefined)[]): string[] {
  return Array.from(new Set(codes.filter((c): c is string => !!c))).sort();
}

/**
 * Свёртка перечисления в старый TripType. Заполняем его и дальше намеренно:
 * существующие рейсы не пересчитываем (решение заказчика), поэтому фильтры,
 * права и отчёты продолжают опираться на tripType, и он обязан быть верным.
 *   всё ласовое → LAAS, ничего ласового → OWN, смесь → CONSOLIDATED.
 */
export function tripTypeFromVerticals(codes: string[]): 'OWN' | 'LAAS' | 'CONSOLIDATED' {
  const laas = codes.filter(isLaas).length;
  if (!laas) return 'OWN';
  return laas === codes.length ? 'LAAS' : 'CONSOLIDATED';
}

/** Пересчёт вертикалей и типа рейса по фактическому составу грузовых единиц. */
export async function recalcTripVerticals(tripId: string): Promise<void> {
  const units = await prisma.tripCargoUnit.findMany({
    where: { tripId },
    select: { verticalCode: true },
  });
  const verticalCodes = tripVerticalsFrom(units.map((u) => u.verticalCode));
  // Пустой состав (все плечи открепили) — тип не трогаем: рейс остаётся как был,
  // иначе он молча превратился бы в OWN и уехал из скоупа LAAS-менеджера.
  if (!verticalCodes.length) {
    await prisma.trip.update({ where: { id: tripId }, data: { verticalCodes } });
    return;
  }
  await prisma.trip.update({
    where: { id: tripId },
    data: { verticalCodes, tripType: tripTypeFromVerticals(verticalCodes) },
  });
}

/** Грузовая единица рейса из груза заявки. */
export function tcuFromCargo(req: any, cargo: any, actor: string | null) {
  return {
    verticalCode: req.verticalCode || null,
    customerId: cargo.consigneeId || req.consigneeId || req.customerId,
    shipperId: req.shipperId || null,
    unitType: cargo.unitType || 'PALLET',
    pallets: cargo.pallets ?? null,
    traysCount: cargo.traysCount ?? null,
    weightKg: cargo.weightKg ?? null,
    productCategory: cargo.productCategory || null,
    tempRegime: cargo.tempRegime || null,
    requestId: req.id,
    createdById: actor,
    updatedById: actor,
  };
}
