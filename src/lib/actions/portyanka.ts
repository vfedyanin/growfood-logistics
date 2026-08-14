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

// Блоки 1–2: отгрузка с конкретной точки забора. Ключ — code локации.
const PICKUP_BLOCKS = [
  { locationCode: 'UMI', title: 'Йуми' },
  { locationCode: 'INGREDICA', title: 'Ингредика' },
];

// Блок 3: ритейлы LaaS. Фиксированный список пар «точка выгрузки + клиент»
// в заданном порядке. Ключи — code локации и code клиента.
const RETAIL_LAAS = [
  { locationCode: 'LOC_MG_TULA', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_DZR', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_VRN', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_YAR', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_KLP', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_SHUSH', customerCode: 'POLYANA' },
  { locationCode: 'LOC_MG_VRN', customerCode: 'FRESHMARKET' },
  { locationCode: 'LOC_MG_YAR', customerCode: 'FRESHMARKET' },
  { locationCode: 'LOC-PEREKRESTOK-VESHKI', customerCode: 'ROSTICS' },
];

// Блоки 4–7: направления. Ключ — code направления, подпись — как в письме.
const DIRECTION_BLOCKS = [
  { directionCode: 'MSK-VRN', title: 'в Воронеж' },
  { directionCode: 'MSK-NN', title: 'в Нижний Новгород' },
  { directionCode: 'MSK-NN-5KA', title: 'в Пятёрочку Нижний Новгород' },
  { directionCode: 'MSK-KZN', title: 'в Казань' },
];

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
      label: l.cargo.request.deliveryLocation?.name ?? '?',
      pallets: l.cargo.pallets ?? 0,
    }));
    out.push(...block(`Отгрузка ${b.title} ${dayLabel}`, rows, 'палл'));
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
      label: `${matched[0].cargo.request.deliveryLocation?.name ?? '?'}\t${matched[0].cargo.request.customer.name}`,
      pallets: matched.reduce((a, l) => a + (l.cargo.pallets ?? 0), 0),
    });
  }
  out.push(...block(`Отгрузка Ритейлы LAAS ${dayLabel}`, retailRows, 'палл'));

  // Блоки 4–7: направления. Даты в шапке берутся с самих плеч направления —
  // это и есть отгрузка и доставка магистрального плеча.
  for (const b of DIRECTION_BLOCKS) {
    const mine = dedupe(legs.filter((l) => l.direction?.code === b.directionCode));
    const rows = mine.map((l) => ({
      label: l.cargo.request.deliveryLocation?.name ?? '?',
      pallets: l.cargo.pallets ?? 0,
    }));
    const dropoffs = mine.map((l) => l.plannedDropoff).filter(Boolean) as Date[];
    const arrival = dropoffs.length
      ? new Date(Math.min(...dropoffs.map((d) => d.getTime())))
      : null;
    out.push(...block(`С ${dayLabel} на ${ddmm(arrival)} ${b.title} едет:`, rows, 'паллет'));
  }

  return out.join('\n').trimEnd() || `На ${dayLabel} отгрузок нет.`;
}
