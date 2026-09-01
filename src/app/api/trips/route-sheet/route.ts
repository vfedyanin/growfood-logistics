// Маршрутный лист в PDF: GET /api/trips/route-sheet?ids=id1,id2
//
// Почему route handler, а не серверное действие: браузер должен получить файл
// на скачивание, а действие возвращает значение. Здесь отдаём поток с
// Content-Disposition, и работает обычная ссылка.
//
// Права те же, что у списка рейсов: tripTypeScopeFor. Иначе LAAS-менеджер
// выгрузил бы PDF по чужому рейсу, которого не видит на экране.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, tripTypeScopeFor } from '@/lib/authz';
import { buildRouteSheet } from '@/lib/routeSheet';
import { renderRouteSheetsPdf } from '@/lib/pdf/routeSheetPdf';

export const dynamic = 'force-dynamic';

const MAX_TRIPS = 50; // разумный потолок на массовую выгрузку

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Требуется вход в систему' }, { status: 401 });
  }

  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) {
    return NextResponse.json({ error: 'Не переданы рейсы' }, { status: 400 });
  }
  if (ids.length > MAX_TRIPS) {
    return NextResponse.json(
      { error: `За раз можно выгрузить не больше ${MAX_TRIPS} рейсов` },
      { status: 400 },
    );
  }

  const trips = await prisma.trip.findMany({
    where: { id: { in: ids }, ...tripTypeScopeFor(user) },
    include: {
      direction: true,
      carrier: true,
      vehicleType: true,
      vehicle: { include: { vehicleType: true } },
      driver: true,
      cargoUnits: {
        include: {
          customer: true,
          request: { include: { deliveryLocation: true } },
          requestCargoLeg: {
            include: {
              pickupLocation: true,
              dropoffLocation: true,
              cargo: { include: { consigneeLocation: true } },
            },
          },
        },
      },
    },
    orderBy: { plannedDeparture: 'asc' },
  });

  if (!trips.length) {
    return NextResponse.json({ error: 'Рейсы не найдены или недоступны' }, { status: 404 });
  }

  // Порядок объезда берём из справочника направлений — по одному запросу на все
  // задействованные направления, а не по разу на рейс.
  const directionIds = Array.from(
    new Set(trips.map((t) => t.directionId).filter((x): x is string => Boolean(x))),
  );
  const stops = directionIds.length
    ? await prisma.routeStop.findMany({
        where: { directionId: { in: directionIds } },
        orderBy: { position: 'asc' },
      })
    : [];
  const orderByDirection = new Map<string, Map<string, number>>();
  for (const s of stops) {
    if (!orderByDirection.has(s.directionId)) orderByDirection.set(s.directionId, new Map());
    orderByDirection.get(s.directionId)!.set(s.locationId, s.position);
  }

  // Сохраняем порядок, в котором рейсы выбрал пользователь на экране.
  const rank = new Map(ids.map((id, i) => [id, i]));
  const ordered = [...trips].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  const sheets = ordered.map((t) =>
    buildRouteSheet(t, orderByDirection.get(t.directionId ?? '') ?? new Map()),
  );

  const pdf = await renderRouteSheetsPdf(sheets);
  const filename =
    sheets.length === 1
      ? `marshrutnyy-list-${sheets[0].tripNumber}.pdf`
      : `marshrutnye-listy-${sheets.length}.pdf`;

  return new NextResponse(pdf as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    },
  });
}
