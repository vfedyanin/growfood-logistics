'use server';

// ВРЕМЕННАЯ МЕРА. «Портянка» — единое письмо с объёмами на день, которое
// рассылают подрядчикам и складам. Живёт до тех пор, пока рассылку не заменит
// нормальный механизм. Держим одним файлом плюс одна кнопка в планировании,
// чтобы удалить можно было не выискивая куски по проекту.
//
// Состав и порядок блоков заданы вручную и намеренно: письмо читают люди,
// привыкшие к определённому виду. Названия в вывод идут ИЗ БАЗЫ как есть,
// без переименований — иначе текст письма разъедется со справочником.

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';

// Порядок строк внутри блока задан вручную: письмо читают глазами, и привычный
// порядок важнее алфавитного. Правило срабатывает по вхождению в название
// конечной точки; меньше ранг — выше строка, без правила строка идёт в середину.
type OrderRule = { match: string; rank: number };
const DEFAULT_RANK = 50;

function orderRows<T extends { label: string }>(rows: T[], rules: OrderRule[]): T[] {
  const rank = (label: string) => rules.find((r) => label.includes(r.match))?.rank ?? DEFAULT_RANK;
  // Сортировка устойчивая: строки с одинаковым рангом сохраняют исходный порядок.
  return rows
    .map((row, i) => ({ row, i, r: rank(row.label) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.row);
}

// Блоки 1–2: отгрузка с конкретной точки забора. Ключ — code локации.
const PICKUP_BLOCKS: { locationCode: string; title: string; order: OrderRule[] }[] = [
  { locationCode: 'UMI', title: 'Йуми', order: [{ match: 'Дикси', rank: 90 }] },
  { locationCode: 'INGREDICA', title: 'Ингредика', order: [] },
];

// Блок 3: ритейлы LaaS. Фиксированный список пар «точка выгрузки + клиент»
// в заданном порядке. Ключи — code локации и code клиента.
const RETAIL_LAAS = [
  { locationCode: 'LOC_MG_TULA', customerCode: 'POLYANA' },
  // Магнит НН — это РЦ Магнит Дзержинск, отдельной точки под Нижний у Магнита нет.
  { locationCode: 'LOC_MG_DZR', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_VRN', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_YAR', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_KLP', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_SHUSH', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_VRN', customerCode: 'FRESHMARKET' },
  { locationCode: 'LOC_MG_YAR', customerCode: 'FRESHMARKET' },
  { locationCode: 'LOC-PEREKRESTOK-VESHKI', customerCode: 'ROSTICS' },
];

// Во всех региональных направлениях КД ГФ идёт первой строкой.
const KD_FIRST: OrderRule = { match: 'КД ', rank: 10 };

// Блоки направлений в порядке письма. Ключ — code направления, подпись — как в письме.
const DIRECTION_BLOCKS: { directionCode: string; title: string; order: OrderRule[] }[] = [
  { directionCode: 'MSK-VRN', title: 'в Воронеж', order: [KD_FIRST] },
  { directionCode: 'MSK-NN', title: 'в Нижний Новгород', order: [KD_FIRST] },
  { directionCode: 'MSK-NN-5KA', title: 'в Пятёрочку Нижний Новгород', order: [KD_FIRST] },
  {
    directionCode: 'MSK-KZN',
    title: 'в Казань',
    // Казань-город закрывает список, Яндекс Лавка Казань — самой последней.
    // Разбивку на машины не делаем: развозят люди, объём блока может быть
    // больше фуры и это нормально.
    order: [KD_FIRST, { match: 'Яндекс Лавка Казань', rank: 90 }, { match: 'Самокат Казань', rank: 80 }],
  },
  { directionCode: 'MSK-VLG', title: 'в Волгоград', order: [KD_FIRST] },
  { directionCode: 'MSK-RND', title: 'в Ростов-на-Дону', order: [KD_FIRST] },
  { directionCode: 'MSK-KRS', title: 'в Краснодар', order: [KD_FIRST] },
  { directionCode: 'MSK-PNZ', title: 'в Пензу', order: [KD_FIRST] },
  { directionCode: 'MSK-FRESH', title: 'в Фрешмаркет', order: [KD_FIRST] },
];

// В справочнике встречаются названия с задвоенными пробелами («РЦ Магнит  Воронеж»).
// В письме это лишняя дыра, поэтому пробелы схлопываем на выводе. Сам справочник
// не правим: письмо — не место чинить данные.
const clean = (s: string | null | undefined) => (s ?? '?').replace(/\s+/g, ' ').trim();

const ddmm = (d: Date | null) =>
  d ? String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') : '—';

type Row = { label: string; pallets: number };

/** Пустые строки и нули в письмо не идут — так просил заказчик письма. */
function block(header: string, rows: Row[], totalWord: string): string[] {
  const kept = rows.filter((r) => r.pallets > 0);
  if (!kept.length) return []; // блока целиком нет, если в нём ничего не осталось
  const total = kept.reduce((a, r) => a + r.pallets, 0);
  return [header, ...kept.map((r) => `${r.label} - ${r.pallets}`), `Итого: ${total} ${totalWord}`, ''];
}

export async function buildPortyanka(dateISO: string): Promise<string> {
  await requireAuth();

  const day = new Date(dateISO.slice(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(day.getTime() + 86400000);

  // Один запрос на всё: плечи с отгрузкой в этот день. Дальше раскладываем их
  // по блокам в памяти — трёх походов в базу за одним и тем же не делаем.
  const legs = await prisma.requestCargoLeg.findMany({
    where: { plannedPickup: { gte: day, lt: dayEnd } },
    select: {
      plannedPickup: true,
      plannedDropoff: true,
      pickupLocation: { select: { code: true } },
      direction: { select: { code: true } },
      cargo: {
        select: {
          id: true,
          pallets: true,
          request: {
            select: {
              customer: { select: { code: true, name: true } },
              deliveryLocation: { select: { code: true, name: true } },
            },
          },
        },
      },
    },
  });

  const out: string[] = [];
  const dayLabel = ddmm(day);

  // Груз, у которого в один день несколько плеч, в блоке считается один раз.
  const dedupe = (ls: typeof legs) => {
    const seen = new Set<string>();
    return ls.filter((l) => (seen.has(l.cargo.id) ? false : (seen.add(l.cargo.id), true)));
  };

  // Блоки 1–2: отгрузка с точки забора. Строка — конечная точка выгрузки заявки.
  for (const b of PICKUP_BLOCKS) {
    const rows = dedupe(legs.filter((l) => l.pickupLocation?.code === b.locationCode)).map((l) => ({
      label: `${clean(l.cargo.request.deliveryLocation?.name)} - ${clean(l.cargo.request.customer.name)}`,
      pallets: l.cargo.pallets ?? 0,
    }));
    out.push(...block(`Отгрузка ${b.title} ${dayLabel}`, orderRows(rows, b.order), 'палл'));
  }

  // Блок 3: ритейлы LaaS. Порядок строк задан списком, а не данными.
  const retailRows: Row[] = [];
  for (const pair of RETAIL_LAAS) {
    const matched = dedupe(
      legs.filter(
        (l) =>
          l.cargo.request.deliveryLocation?.code === pair.locationCode &&
          l.cargo.request.customer.code === pair.customerCode,
      ),
    );
    if (!matched.length) continue;
    retailRows.push({
      label: `${clean(matched[0].cargo.request.deliveryLocation?.name)} - ${clean(matched[0].cargo.request.customer.name)}`,
      pallets: matched.reduce((a, l) => a + (l.cargo.pallets ?? 0), 0),
    });
  }
  out.push(...block(`Отгрузка Ритейлы LAAS ${dayLabel}`, retailRows, 'палл'));

  // Блоки направлений. Даты в шапке берутся с самих плеч направления —
  // это и есть отгрузка и доставка магистрального плеча.
  for (const b of DIRECTION_BLOCKS) {
    const mine = dedupe(legs.filter((l) => l.direction?.code === b.directionCode));
    const rows = mine.map((l) => ({
      label: `${clean(l.cargo.request.deliveryLocation?.name)} - ${clean(l.cargo.request.customer.name)}`,
      pallets: l.cargo.pallets ?? 0,
    }));
    const dropoffs = mine.map((l) => l.plannedDropoff).filter(Boolean) as Date[];
    const arrival = dropoffs.length
      ? new Date(Math.min(...dropoffs.map((d) => d.getTime())))
      : null;
    out.push(...block(`С ${dayLabel} на ${ddmm(arrival)} ${b.title} едет:`, orderRows(rows, b.order), 'паллет'));
  }

  return out.join('\n').trimEnd() || `На ${dayLabel} отгрузок нет.`;
}
