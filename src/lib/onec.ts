// HTTP-забор заказов из 1С (GET-сервис «Заказы на производство»).
// Только сеть: тянет сырой массив строк выгрузки; разбор/запись — в ingest1c.
//
// Реквизиты берём из переменных окружения (в код НЕ зашиваем — секреты):
//   ONEC_ORDERS_URL — базовый URL сервиса, напр.
//     http://rds.growfood.pro:40500/testbuh1/hs/internalgf/getdocforperiod/
//   ONEC_LOGIN, ONEC_PASSWORD — Basic-авторизация.
// Параметры выборки: dateFrom, dateTo (YYYY-MM-DD) + object=productionOrders.
//
// NB: сервис отдаётся по HTTP (без TLS) — Basic-логин идёт открытым текстом.
// Это сторона 1С; вызывать только из серверного кода (Vercel), не из браузера.

import type { OrderRow } from '@/lib/ingest1c';

export type OneCConfig = { url: string; login: string; password: string };

export function get1cConfig(): OneCConfig | null {
  const url = process.env.ONEC_ORDERS_URL;
  const login = process.env.ONEC_LOGIN;
  const password = process.env.ONEC_PASSWORD;
  if (!url || !login || !password) return null;
  return { url, login, password };
}

/** Имена переменных 1С, которые НЕ заданы в окружении (пустой список = всё на месте). */
export function missing1cConfig(): string[] {
  const miss: string[] = [];
  if (!process.env.ONEC_ORDERS_URL) miss.push('ONEC_ORDERS_URL');
  if (!process.env.ONEC_LOGIN) miss.push('ONEC_LOGIN');
  if (!process.env.ONEC_PASSWORD) miss.push('ONEC_PASSWORD');
  return miss;
}

/** Достаёт массив строк из ответа сервиса: { data: [...] } либо голый [...]. */
function extractRows(parsed: unknown): OrderRow[] {
  if (Array.isArray(parsed)) return parsed as OrderRow[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).data)) {
    return (parsed as any).data as OrderRow[];
  }
  throw new Error('Неожиданный формат ответа 1С: ожидаю { data: [...] } или [...]');
}

/**
 * Забирает заказы на производство за период [dateFrom, dateTo] (YYYY-MM-DD).
 * Бросает с понятным текстом, если не настроено окружение или сервис ответил не 2xx.
 */
export async function fetchProductionOrders(dateFrom: string, dateTo: string): Promise<OrderRow[]> {
  const cfg = get1cConfig();
  if (!cfg) {
    throw new Error('Не заданы переменные окружения ONEC_ORDERS_URL / ONEC_LOGIN / ONEC_PASSWORD');
  }
  const base = cfg.url.endsWith('/') ? cfg.url : cfg.url + '/';
  const qs = new URLSearchParams({ dateFrom, dateTo, object: 'productionOrders' });
  const url = `${base}?${qs.toString()}`;
  const auth = Buffer.from(`${cfg.login}:${cfg.password}`).toString('base64');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000); // сервис может отдавать мегабайты
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (e: any) {
    throw new Error(`Не удалось соединиться с 1С: ${String(e?.message ?? e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`1С ответила ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Ответ 1С не JSON (первые символы: ${text.slice(0, 120)})`);
  }
  return extractRows(parsed);
}
