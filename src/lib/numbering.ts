// Генерация номеров заявок.
//
// Серверный модуль (НЕ 'use server'). Единственная реализация: планирование
// раньше считало номер как «количество заявок за сегодня + 1», и после удаления
// любой заявки номер повторялся — создание падало на уникальном индексе
// requestNumber. Считать надо от ПОСЛЕДНЕГО номера, а не от количества.

import { prisma } from '@/lib/prisma';

/**
 * Следующий номер заявки вида `REQ-YYYYMMDD-NNN`.
 *
 * Дата берётся локальная (не UTC), чтобы номер соответствовал рабочему дню
 * оператора. Сортировка по строке корректна, потому что префикс фиксирован,
 * а порядковый номер выровнен нулями до трёх знаков.
 */
export async function nextRequestNumber(prefix = 'REQ'): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const full = `${prefix}-${ymd}-`;
  const last = await prisma.customerRequest.findFirst({
    where: { requestNumber: { startsWith: full } },
    orderBy: { requestNumber: 'desc' },
    select: { requestNumber: true },
  });
  let n = 1;
  if (last) {
    const m = last.requestNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${full}${String(n).padStart(3, '0')}`;
}
