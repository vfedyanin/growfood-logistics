// Печатная форма маршрутного листа в PDF.
//
// ШРИФТЫ. Берём Roboto из самого pdfmake: в пакете лежит vfs_fonts.js — те же
// ttf в base64. Так в репозиторий не попадают бинарники, а в сборку Vercel не
// надо тащить файлы шрифтов отдельно (трассировка статики в serverless их бы
// не подхватила). Кириллица в этом Roboto есть, проверено на выводе.
//
// Версия pdfmake — 0.2.x: там классический серверный API `new PdfPrinter(fonts)`.
// В 0.3 его убрали, при обновлении форма сломается.
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { RouteSheet, tempLabel } from '@/lib/routeSheet';

// @types/pdfmake описывает браузерный API (createPdf), а нам нужен серверный
// принтер из pdfmake 0.2 — конструктор `new PdfPrinter(fonts)`, которого в тайпингах
// нет. Поэтому подключаем через require и типизируем свободно; типы документа
// (TDocumentDefinitions, Content) при этом остаются настоящими.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const PdfPrinter: any = require('pdfmake');
const vfs = require('pdfmake/build/vfs_fonts.js');
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const fontTable: Record<string, string> = vfs.pdfMake?.vfs ?? vfs.vfs ?? vfs;
const ttf = (name: string) => Buffer.from(fontTable[name], 'base64');

const printer = new PdfPrinter({
  Roboto: {
    normal: ttf('Roboto-Regular.ttf'),
    bold: ttf('Roboto-Medium.ttf'),
    italics: ttf('Roboto-Italic.ttf'),
    bolditalics: ttf('Roboto-MediumItalic.ttf'),
  },
});

// Времена в базе в UTC, а работают с системой по Москве.
const MSK = 3 * 60 * 60 * 1000;
const msk = (d: Date | null) => (d ? new Date(d.getTime() + MSK) : null);
const pad = (n: number) => String(n).padStart(2, '0');

const hhmm = (d: Date | null) => {
  const m = msk(d);
  return m ? `${pad(m.getUTCHours())}:${pad(m.getUTCMinutes())}` : '—';
};
const ddmm = (d: Date | null) => {
  const m = msk(d);
  return m ? `${pad(m.getUTCDate())}.${pad(m.getUTCMonth() + 1)}` : '—';
};

const STATUS: Record<string, string> = {
  DRAFT: 'черновик',
  PLANNED: 'запланирован',
  IN_TRANSIT: 'в пути',
  COMPLETED: 'завершён',
  CANCELLED: 'отменён',
};

const GREY = '#666666';
const LINE = '#cccccc';

function header(s: RouteSheet): Content[] {
  const machine = [
    s.vehicleType ?? 'тип ТС не задан',
    s.capacityPallets ? `до ${s.capacityPallets} палл.` : null,
    s.plate ?? 'госномер не назначен',
  ]
    .filter(Boolean)
    .join(' · ');
  const driver = s.driver
    ? [s.driver, s.driverPhone].filter(Boolean).join(', ')
    : 'водитель не назначен';

  return [
    {
      columns: [
        { text: 'МАРШРУТНЫЙ ЛИСТ', style: 'h1' },
        { text: s.tripNumber, style: 'h1', alignment: 'right' },
      ],
    },
    {
      text: [
        { text: s.directionName ?? 'направление не задано', bold: true },
        { text: `   ${ddmm(s.plannedDeparture)} — ${ddmm(s.plannedArrival)}` },
      ],
      margin: [0, 6, 0, 0],
    },
    {
      // Шапка в две колонки: слева кто везёт, справа чем и сколько.
      columns: [
        {
          width: '55%',
          stack: [
            { text: `Перевозчик: ${s.carrier ?? 'не задан'}` },
            { text: `Водитель: ${driver}`, color: s.driver ? undefined : GREY },
          ],
        },
        {
          width: '45%',
          stack: [
            { text: `Машина: ${machine}` },
            { text: `План: ${s.totalPallets} палл. · статус ${STATUS[s.status] ?? s.status}` },
          ],
        },
      ],
      margin: [0, 8, 0, 10],
      fontSize: 10,
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: LINE }],
      margin: [0, 0, 0, 12],
    },
  ];
}

function cargoRows(list: RouteSheet['stops'][number]['load'], kind: 'load' | 'unload'): Content {
  const sign = kind === 'load' ? '+' : '−';
  return {
    table: {
      widths: [12, 42, 'auto', '*', 'auto'],
      body: list.map((c) => [
        { text: sign, bold: true, color: kind === 'load' ? '#0a7d32' : '#a33' },
        { text: `${c.pallets ?? '?'} палл.`, alignment: 'right' },
        { text: c.weightKg != null ? `${Math.round(c.weightKg)} кг` : '', color: GREY },
        {
          text: [
            { text: c.client ?? '—' },
            kind === 'load' && c.finalTo ? { text: `  →  ${c.finalTo}`, color: GREY } : '',
            c.tempRegime ? { text: `  ${tempLabel(c.tempRegime)}`, color: GREY } : '',
          ],
        },
        { text: c.requestNumber ?? '', color: GREY, alignment: 'right' },
      ]),
    },
    layout: 'noBorders',
    fontSize: 9.5,
    margin: [10, 2, 0, 0],
  };
}

function stopBlock(stop: RouteSheet['stops'][number], index: number): Content[] {
  const kind =
    stop.load.length && stop.unload.length
      ? 'погрузка и выгрузка'
      : stop.load.length
        ? 'погрузка'
        : 'выгрузка';

  const out: Content[] = [
    {
      columns: [
        { width: 16, text: `${index}.`, bold: true },
        { width: '*', text: stop.name, bold: true },
        { width: 'auto', text: `${kind}   ${hhmm(stop.time)}`, color: GREY, fontSize: 9.5 },
      ],
      margin: [0, 8, 0, 0],
    },
  ];
  if (stop.address) {
    out.push({ text: stop.address, color: GREY, fontSize: 9, margin: [16, 1, 0, 0] });
  }
  if (stop.load.length) out.push(cargoRows(stop.load, 'load'));
  if (stop.unload.length) out.push(cargoRows(stop.unload, 'unload'));
  return out;
}

function sheetContent(s: RouteSheet): Content[] {
  const body: Content[] = [...header(s)];

  if (!s.stops.length) {
    body.push({ text: 'В рейсе нет груза с плечами — маршрут собрать не из чего.', color: GREY });
    return body;
  }

  s.stops.forEach((stop, i) => body.push(...stopBlock(stop, i + 1)));

  body.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: LINE }],
    margin: [0, 14, 0, 8],
  });
  body.push({
    text: `Всего в рейсе: ${s.stops.length} точек, ${s.totalPallets} палл.`,
    bold: true,
    fontSize: 10,
  });
  body.push({
    columns: [
      { text: 'Водитель ____________________ / ____________________', fontSize: 9, color: GREY },
      { text: 'Логист ____________________', fontSize: 9, color: GREY, alignment: 'right' },
    ],
    margin: [0, 24, 0, 0],
  });
  return body;
}

/** Один PDF на все переданные рейсы: каждый лист с новой страницы. */
export function renderRouteSheetsPdf(sheets: RouteSheet[]): Promise<Buffer> {
  const content: Content[] = [];
  sheets.forEach((s, i) => {
    const block = sheetContent(s);
    if (i > 0) (block[0] as any).pageBreak = 'before';
    content.push(...block);
  });

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 40],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.15 },
    styles: { h1: { fontSize: 15, bold: true } },
    footer: (page, total) => ({
      text: `${page} / ${total}`,
      alignment: 'center',
      fontSize: 8,
      color: GREY,
      margin: [0, 10, 0, 0],
    }),
  };

  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(doc);
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}
