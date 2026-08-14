'use server';

// ВРЕМЕННАЯ МЕРА. «Портянка» — единое письмо с объёмами на день, которое
// рассылают подрядчикам и складам. Живёт до тех пор, пока рассылку не заменит
// нормальный механизм. Держим одним файлом плюс одна кнопка в планировании,
// чтобы удалить можно было не выискивая куски по проекту.

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';

type Line = { delivery: string; customer: string; pallets: number };

/**
 * Сборка текста портянки. ВСЯ форма вывода живёт здесь — если меняется формат
 * письма, правится только эта функция, запрос данных ниже трогать не нужно.
 */
function renderPortyanka(
  day: string,
  nextDay: string,
  byPickup: Map<string, Line[]>,
  byDirection: Map<string, { title: string; lines: Line[] }>,
): string {
  const out: string[] = [];
  const sum = (ls: Line[]) => ls.reduce((a, l) => a + l.pallets, 0);

  // Верх: что забираем у каждого грузоотправителя.
  for (const [pickup, lines] of Array.from(byPickup.entries())) {
    out.push(`Отгрузка ${pickup} ${day}`);
    for (const l of lines) out.push(`${l.delivery} ${l.customer}  ${l.pallets}`);
    out.push(`Итого: ${sum(lines)} палл`);
    out.push('');
  }

  // Низ: что уезжает по каждому направлению. Маршруты идут строго по
  // направлениям справочника, поэтому группа = направление.
  for (const [, g] of Array.from(byDirection.entries())) {
    out.push(`С ${day} на ${nextDay} ${g.title} едет:`);
    for (const l of g.lines) out.push(`${l.delivery} -   ${l.customer} -   ${l.pallets}`);
    out.push(`Итого: ${sum(g.lines)} паллет`);
    out.push('');
  }

  return out.join('\n').trimEnd();
}

const ru = (d: Date) =>
  String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0');

export async function buildPortyanka(dateISO: string): Promise<string> {
  await requireAuth();

  const day = new Date(dateISO.slice(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(day.getTime() + 86400000);

  // Верх портянки — заявки с забором в этот день, сгруппированные по точке забора.
  const requests = await prisma.customerRequest.findMany({
    where: { pickupDate: { gte: day, lt: dayEnd } },
    select: {
      requestedPallets: true,
      customer: { select: { name: true } },
      pickupLocation: { select: { name: true } },
      deliveryLocation: { select: { name: true } },
    },
  });

  const byPickup = new Map<string, Line[]>();
  for (const r of requests) {
    const key = r.pickupLocation?.name ?? 'Без точки забора';
    if (!byPickup.has(key)) byPickup.set(key, []);
    byPickup.get(key)!.push({
      delivery: r.deliveryLocation?.name ?? '?',
      customer: r.customer.name,
      pallets: r.requestedPallets ?? 0,
    });
  }
  for (const lines of Array.from(byPickup.values())) {
    lines.sort((a, b) => a.delivery.localeCompare(b.delivery, 'ru') || a.customer.localeCompare(b.customer, 'ru'));
  }

  // Низ портянки — плечи с забором в этот день, сгруппированные по направлению.
  // Плечо попадает только в рейс своего направления, поэтому группировка прямая.
  const legs = await prisma.requestCargoLeg.findMany({
    where: { plannedPickup: { gte: day, lt: dayEnd }, directionId: { not: null } },
    select: {
      direction: { select: { code: true, name: true, destination: { select: { name: true } } } },
      dropoffLocation: { select: { name: true } },
      cargo: {
        select: {
          pallets: true,
          request: { select: { customer: { select: { name: true } } } },
        },
      },
    },
  });

  const byDirection = new Map<string, { title: string; lines: Line[] }>();
  for (const l of legs) {
    if (!l.direction) continue;
    const code = l.direction.code;
    // Внутригородские перевалки (МСК→МСК) в письмо не идут: это движение внутри
    // хаба, подрядчику на межгороде оно ничего не говорит.
    if (l.direction.destination?.name && l.direction.code.startsWith('MSK-MSK')) continue;
    if (!byDirection.has(code)) {
      byDirection.set(code, {
        title: l.direction.destination?.name
          ? `в ${l.direction.destination.name}`
          : (l.direction.name ?? code),
        lines: [],
      });
    }
    byDirection.get(code)!.lines.push({
      delivery: l.dropoffLocation?.name ?? '?',
      customer: l.cargo.request.customer.name,
      pallets: l.cargo.pallets ?? 0,
    });
  }
  for (const g of Array.from(byDirection.values())) {
    g.lines.sort((a, b) => a.delivery.localeCompare(b.delivery, 'ru') || a.customer.localeCompare(b.customer, 'ru'));
  }

  return renderPortyanka(ru(day), ru(dayEnd), byPickup, byDirection);
}
