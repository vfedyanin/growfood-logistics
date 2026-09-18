'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Upload, Card, Table, Tag, Space, message, Typography, Alert, Statistic, Row, Col, DatePicker } from 'antd';
import { InboxOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { usePermissions } from '@/hooks/usePermissions';
import { planFrom1c, type OrderRow, type PlannedDelivery } from '@/lib/ingest1c';
import { applyIngest, ingestFrom1c, is1cConfigured, missing1cEnv, listIngestRuns, getIngestRunOutcomes, type IngestOutcome, type IngestOutcomeKind, type IngestRunSummary } from '@/lib/actions/ingest1c';

const { Text, Paragraph } = Typography;

const producerLabel: Record<string, string> = {
  BIRYULEVO: 'Завод Бирюлёво', PRIEM: 'Завод Приём', FUDHOLDING: 'ГФ Фудхолдинг',
  SENDWICH: 'Сендвич-Цех', SKIP: '— (пропуск)',
};
const kindCfg: Record<IngestOutcomeKind, { color: string; label: string }> = {
  created: { color: 'green', label: 'Создана' },
  updated: { color: 'blue', label: 'Обновлена' },
  skipped_inwork: { color: 'orange', label: 'В работе — пропуск' },
  skipped_producer: { color: 'default', label: 'Производитель вне периметра' },
  error: { color: 'red', label: 'Ошибка' },
};

// Достаём массив строк из файла 1С: либо { data: [...] }, либо голый массив.
function extractRows(parsed: any): OrderRow[] {
  if (Array.isArray(parsed)) return parsed as OrderRow[];
  if (Array.isArray(parsed?.data)) return parsed.data as OrderRow[];
  throw new Error('Не нашёл массив заказов: ожидаю { data: [...] } или [...]');
}

export default function Import1cPage() {
  const { can } = usePermissions();
  const canWrite = can('trips.write');

  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<PlannedDelivery[] | null>(null);
  const [outcomes, setOutcomes] = useState<IngestOutcome[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Забор напрямую из 1С за период
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [missingEnv, setMissingEnv] = useState<string[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs().add(1, 'day')]);
  const [fetching, setFetching] = useState(false);

  // Журнал прошлых прогонов
  const [runs, setRuns] = useState<IngestRunSummary[]>([]);
  const [openedRun, setOpenedRun] = useState<IngestRunSummary | null>(null);
  const loadRuns = () => { if (canWrite) listIngestRuns().then(setRuns).catch(() => setRuns([])); };
  const openRun = async (r: IngestRunSummary) => {
    setOpenedRun(r);
    setPreview(null);
    try { setOutcomes(await getIngestRunOutcomes(r.id)); }
    catch { message.error('Не удалось открыть прогон'); }
  };

  useEffect(() => {
    if (canWrite) is1cConfigured().then(setConfigured).catch(() => setConfigured(false));
    if (canWrite) missing1cEnv().then(setMissingEnv).catch(() => setMissingEnv([]));
    loadRuns();
  }, [canWrite]);

  const onFetch = async () => {
    const [from, to] = range;
    if (!from || !to) { message.warning('Укажите период'); return; }
    setFetching(true);
    setOpenedRun(null);
    try {
      const res = await ingestFrom1c(from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD'));
      setOutcomes(res.outcomes);
      setPreview(null);
      const c = res.outcomes.filter((o) => o.kind === 'created').length;
      const u = res.outcomes.filter((o) => o.kind === 'updated').length;
      const err = res.outcomes.filter((o) => o.kind === 'error').length;
      message[err ? 'warning' : 'success'](`Получено строк из 1С: ${res.fetched}. Создано ${c}, обновлено ${u}${err ? `, ошибок ${err}` : ''}`);
      loadRuns();
    } catch (e: any) {
      message.error(e?.message || 'Ошибка забора из 1С');
    } finally { setFetching(false); }
  };

  const onFile = async (f: File) => {
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const r = extractRows(parsed);
      setRows(r);
      setFileName(f.name);
      setPreview(planFrom1c(r)); // dry-run: считаем поставки локально, без записи
      setOutcomes(null);
      message.success(`Файл разобран: строк ${r.length}`);
    } catch (e: any) {
      setRows(null); setPreview(null); setOutcomes(null);
      message.error(e?.message || 'Не удалось разобрать файл');
    }
    return false; // не загружать на сервер через Upload
  };

  const onRun = async () => {
    if (!rows) { message.warning('Приложите файл выгрузки 1С'); return; }
    setSubmitting(true);
    setOpenedRun(null);
    try {
      const res = await applyIngest(rows, { source: 'FILE', fileName });
      setOutcomes(res.outcomes);
      const c = res.outcomes.filter((o) => o.kind === 'created').length;
      const u = res.outcomes.filter((o) => o.kind === 'updated').length;
      const err = res.outcomes.filter((o) => o.kind === 'error').length;
      message[err ? 'warning' : 'success'](`Создано ${c}, обновлено ${u}${err ? `, ошибок ${err}` : ''}`);
      loadRuns();
    } catch (e: any) {
      message.error(e?.message || 'Ошибка приёма');
    } finally { setSubmitting(false); }
  };

  const previewStats = useMemo(() => {
    if (!preview) return null;
    const inScope = preview.filter((d) => d.producer !== 'SKIP');
    const skip = preview.length - inScope.length;
    const pallets = inScope.reduce((s, d) => s + d.pallets, 0);
    return { total: preview.length, inScope: inScope.length, skip, pallets };
  }, [preview]);

  const previewCols = [
    { title: 'Дата на РЦ', dataIndex: 'deliveryDate', key: 'd', width: 110 },
    { title: 'РЦ', dataIndex: 'rc', key: 'rc' },
    { title: 'Направление', dataIndex: 'direction', key: 'dir', width: 130 },
    { title: 'Производитель', dataIndex: 'producer', key: 'p', width: 160, render: (p: string) => p === 'SKIP' ? <Tag>{producerLabel[p]}</Tag> : producerLabel[p] || p },
    { title: 'Паллет', dataIndex: 'pallets', key: 'pal', width: 80, align: 'right' as const },
    { title: 'Заказов', dataIndex: 'sourceOrderGuids', key: 'n', width: 80, align: 'right' as const, render: (g: string[]) => g.length },
  ];
  const sourceLabel = (s: string) => (s === 'API_1C' ? 'Забор 1С' : 'Файл');
  const runCols = [
    { title: 'Когда', dataIndex: 'createdAt', key: 't', width: 150, render: (t: string) => dayjs(t).format('DD.MM.YYYY HH:mm') },
    { title: 'Источник', dataIndex: 'source', key: 's', width: 100, render: (s: string) => <Tag color={s === 'API_1C' ? 'blue' : 'default'}>{sourceLabel(s)}</Tag> },
    { title: 'Период / файл', key: 'pf', ellipsis: true, render: (_: any, r: IngestRunSummary) => r.source === 'API_1C' ? `${r.dateFrom ?? '?'} … ${r.dateTo ?? '?'}` : (r.fileName || '—') },
    { title: 'Строк', dataIndex: 'fetched', key: 'f', width: 70, align: 'right' as const },
    { title: 'Итоги', key: 'res', width: 240, render: (_: any, r: IngestRunSummary) => (
      <Space size={4} wrap>
        {r.created > 0 && <Tag color="green">+{r.created}</Tag>}
        {r.updated > 0 && <Tag color="blue">~{r.updated}</Tag>}
        {(r.skippedInwork + r.skippedProducer) > 0 && <Tag>⤼{r.skippedInwork + r.skippedProducer}</Tag>}
        {r.errors > 0 && <Tag color="red">✕{r.errors}</Tag>}
      </Space>
    ) },
    { title: 'Кто', dataIndex: 'createdByName', key: 'u', width: 160, ellipsis: true, render: (n?: string | null) => n || '—' },
  ];
  const outcomeCols = [
    { title: 'Дата на РЦ', dataIndex: 'deliveryDate', key: 'd', width: 110 },
    { title: 'РЦ', dataIndex: 'rc', key: 'rc' },
    { title: 'Производитель', dataIndex: 'producer', key: 'p', width: 160, render: (p: string) => producerLabel[p] || p },
    { title: 'Паллет', dataIndex: 'pallets', key: 'pal', width: 80, align: 'right' as const },
    { title: 'Результат', dataIndex: 'kind', key: 'k', width: 200, render: (k: IngestOutcomeKind) => <Tag color={kindCfg[k]?.color}>{kindCfg[k]?.label || k}</Tag> },
    { title: 'Заявка', dataIndex: 'requestNumber', key: 'rn', width: 150, render: (n?: string) => n ? <a href="/requests">{n}</a> : '—' },
    { title: 'Комментарий', dataIndex: 'message', key: 'm', ellipsis: true },
  ];

  return (
    <>
      <Card size="small" style={{ marginBottom: 16 }} title="Забрать заказы напрямую из 1С (за период)">
        {configured === false && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }}
            message="Забор из 1С не настроен"
            description={`Не заданы переменные окружения: ${missingEnv.length ? missingEnv.join(', ') : 'ONEC_ORDERS_URL / ONEC_LOGIN / ONEC_PASSWORD'}. Пока можно грузить файл выгрузки вручную (ниже).`} />
        )}
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Дёргает GET-сервис 1С за выбранный период и сразу принимает заказы (тот же разбор и
          идемпотентный UPSERT, что при загрузке файла). Период — по дате в сервисе 1С.
        </Paragraph>
        <Space wrap align="center">
          <DatePicker.RangePicker value={range} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            format="DD.MM.YYYY" allowClear={false} disabled={!canWrite} />
          <Button type="primary" icon={<CloudDownloadOutlined />} loading={fetching}
            disabled={!canWrite || configured === false} onClick={onFetch}>
            Забрать из 1С и принять
          </Button>
        </Space>
      </Card>

      <Card size="small" style={{ marginBottom: 16 }} title="Приём заказов из 1С (файл выгрузки)">
        {!canWrite && <Alert type="info" showIcon message="Недостаточно прав для приёма заказов." style={{ marginBottom: 12 }} />}
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Загрузка файла выгрузки 1С («Заказы на производство»). Времена, окна и маршрут берутся
          из шаблонов заявок по производителю и РЦ — из 1С только количества и дата отгрузки на РЦ.
          Приём идемпотентен: повторная загрузка обновляет те же заявки (по ключу заказа), а не плодит дубли.
        </Paragraph>
        <Space wrap align="start">
          <Upload.Dragger accept="application/json,.json" multiple={false} maxCount={1}
            beforeUpload={onFile} fileList={fileName ? [{ uid: '1', name: fileName } as any] : []}
            onRemove={() => { setRows(null); setPreview(null); setOutcomes(null); setFileName(''); }}
            disabled={!canWrite} style={{ width: 360 }}>
            <p style={{ margin: 0 }}><InboxOutlined /> Перетащите JSON-файл 1С сюда или нажмите</p>
          </Upload.Dragger>
          <div style={{ paddingTop: 20 }}>
            <Button type="primary" loading={submitting} disabled={!canWrite || !rows} onClick={onRun}>
              Создать / обновить заявки
            </Button>
          </div>
        </Space>
      </Card>

      <Card size="small" style={{ marginBottom: 16 }} title="Журнал загрузок"
        extra={<Button size="small" onClick={loadRuns}>Обновить</Button>}>
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Все прошлые прогоны приёма (файл и забор из 1С). Клик по строке — открыть отчёт того прогона внизу.
        </Paragraph>
        <Table size="small" rowKey="id" dataSource={runs} columns={runCols}
          pagination={{ pageSize: 10 }} scroll={{ x: 900 }}
          rowClassName={(r) => (openedRun?.id === r.id ? 'ant-table-row-selected' : '')}
          onRow={(r) => ({ onClick: () => openRun(r), style: { cursor: 'pointer' } })} />
      </Card>

      {previewStats && (
        <Card size="small" style={{ marginBottom: 16 }} title="Предпросмотр (без записи)">
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col><Statistic title="Поставок всего" value={previewStats.total} /></Col>
            <Col><Statistic title="В работу" value={previewStats.inScope} /></Col>
            <Col><Statistic title="Паллет (в работу)" value={previewStats.pallets} /></Col>
            <Col><Statistic title="Пропуск (вне периметра)" value={previewStats.skip} /></Col>
          </Row>
          <Table size="small" rowKey="key" dataSource={preview!} columns={previewCols} pagination={{ pageSize: 50 }} scroll={{ x: 800 }} />
        </Card>
      )}

      {outcomes && (
        <Card size="small"
          title={openedRun
            ? `Отчёт прогона от ${dayjs(openedRun.createdAt).format('DD.MM.YYYY HH:mm')} · ${sourceLabel(openedRun.source)}`
            : 'Результат приёма'}
          extra={openedRun ? <Button size="small" onClick={() => { setOpenedRun(null); setOutcomes(null); }}>Закрыть</Button> : undefined}>
          <Table size="small" rowKey="key" dataSource={outcomes} columns={outcomeCols} pagination={{ pageSize: 30 }} scroll={{ x: 900 }} />
        </Card>
      )}
    </>
  );
}
