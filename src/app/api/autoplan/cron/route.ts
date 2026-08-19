// Ночное автораспределение плеч по рейсам. Вызывается Vercel Cron (vercel.json).
// Защита: Authorization: Bearer ${CRON_SECRET} — Vercel Cron шлёт его сам.
//
// Логику берём из @/lib/autoplanRun, а не из серверного действия: у крона нет
// сессии, а действие требует роль. Обратное — открыть действие без авторизации —
// сделало бы создание рейсов доступным из браузера кому угодно.
//
// ПОЧЕМУ 20:00 UTC И ПОЧЕМУ «завтра» СЧИТАЕТСЯ ПО МОСКВЕ. Cron у Vercel идёт по
// UTC, а работают с системой по московскому времени. В расписании стоит 20:00 UTC
// = 23:00 МСК, то есть прогон идёт ВЕЧЕРОМ, до московской полуночи: заявки на
// завтра к этому времени уже внесены, и рейсы готовы к утренней отгрузке.
//
// Срабатывать после московской полуночи нельзя, и на этом уже обожглись: при
// 22:00 UTC (01:00 МСК) московские сутки в момент запуска уже наступили, и
// «сегодня плюс один день» давало ПОСЛЕЗАВТРАШНИЙ рейс. Каждый день при этом
// раскладывался в час ночи предыдущих суток, поэтому заявки, внесённые днём на
// завтра, не подхватывал никто: отвечавший за этот день прогон прошёл раньше,
// чем появились данные, а к пройденной дате крон не возвращается.
import { NextResponse } from 'next/server';
import { applyAutoPlan } from '@/lib/autoplanRun';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // день может дать десятки рейсов, каждый пишется отдельно

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Дата «завтра» по московскому времени в формате YYYY-MM-DD.
 *
 * Верно только при запуске ДО московской полуночи (см. расписание в vercel.json):
 * 23:00 МСК 18.08 даёт 2026-08-19. Переходы через месяц и год считаются сами —
 * арифметика идёт в миллисекундах, а не по компонентам даты.
 */
function tomorrowMsk(now = new Date()): string {
  return new Date(now.getTime() + MSK_OFFSET_MS + 86400000).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Дату можно передать явно — так проверяют прогон руками, не дожидаясь ночи.
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || tomorrowMsk();

  try {
    // actor = null: рейсы созданы автоматикой, а не человеком, и в аудите это
    // должно быть видно именно так, а не подписано случайным пользователем.
    const res = await applyAutoPlan(date, null);
    return NextResponse.json({
      ok: true,
      date,
      createdTrips: res.createdTripNumbers.length,
      tripNumbers: res.createdTripNumbers,
      overloads: res.trips.filter((t) => t.overload).length,
      unassignedLegs: res.unassignedLegs,
      legsWithoutDirection: res.legsWithoutDirection,
      skipped: res.skipped,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, date, error: e?.message || String(e) }, { status: 500 });
  }
}
