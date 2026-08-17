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
