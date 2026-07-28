// Cron-эндпоинт авто-импорта. Вызывается Vercel Cron ежечасно (vercel.json).
// Защита: заголовок Authorization: Bearer ${CRON_SECRET} (Vercel Cron шлёт его автоматически).
import { NextResponse } from 'next/server';
import { runEmailImport } from '@/lib/import/runEmailImport';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // OCR ~9с/страница × несколько писем (Vercel Pro)

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runEmailImport({ trigger: 'CRON' });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
