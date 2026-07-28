'use client';

import React, { useEffect, useState } from 'react';
import { Button, Select, Upload, Card, Table, Tag, Space, message, Modal, Typography, Descriptions, Alert } from 'antd';
import { InboxOutlined, ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePermissions } from '@/hooks/usePermissions';
import { getImportLogs, getImportCustomers, runManualImport, runEmailImportNow } from '@/lib/actions/import';

const { Text, Paragraph } = Typography;

const statusCfg: Record<string, { color: string; label: string }> = {
  SUCCESS: { color: 'green', label: 'Успех' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  EMPTY: { color: 'default', label: 'Пусто' },
  ERROR: { color: 'red', label: 'Ошибка' },
};
const triggerCfg: Record<string, string> = { MANUAL: 'Вручную', CRON: 'Крон' };
const dt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—');

export default function ImportLogPage() {
  const { can } = usePermissions();
  const canWrite = can('trips.write');

  const [logs, setLogs] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selCustomer, setSelCustomer] = useState<string>();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingMail, setCheckingMail] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const onCheckMail = async () => {
    setCheckingMail(true);
    try {
      const s = await runEmailImportNow();
      if (!s.configured) message.warning('Gmail не настроен (нет OAuth-кредов в окружении).');
      else message.success(`Проверено контрагентов: ${s.customersChecked}, писем: ${s.emailsFound}, создано заявок: ${s.createdRequests}${s.errors.length ? `, ошибок: ${s.errors.length}` : ''}`);
      load();
    } catch (e: any) {
      message.error(e?.message || 'Ошибка проверки почты');
    } finally { setCheckingMail(false); }
  };

  const load = async () => {
    setLoading(true);
    try { setLogs(await getImportLogs(100)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); getImportCustomers().then(setCustomers); }, []);

  const onRun = async () => {
    if (!selCustomer) { message.warning('Выберите контрагента'); return; }
    if (!file) { message.warning('Приложите PDF-файл'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('customerId', selCustomer);
      fd.append('file', file);
      const res = await runManualImport(fd);
      if (!res?.status) { message.error('Пустой ответ сервера (возможно, таймаут)'); load(); return; }
      const cfg = statusCfg[res.status];
      message[res.status === 'ERROR' ? 'error' : res.status === 'SUCCESS' ? 'success' : 'info'](`${cfg?.label}: ${res.message}`);
      setFile(null);
      load();
    } catch (e: any) {
      message.error(e?.message || 'Ошибка импорта');
    } finally { setSubmitting(false); }
  };

  const selCust = customers.find((c) => c.id === selCustomer);

  const columns = [
    { title: 'Дата/время', dataIndex: 'createdAt', key: 'createdAt', width: 150, render: dt },
    { title: 'Запуск', dataIndex: 'trigger', key: 'trigger', width: 90, render: (t: string) => triggerCfg[t] || t },
    { title: 'Контрагент', key: 'customer', render: (_: any, r: any) => r.customer?.name || '—' },
    { title: 'Источник', dataIndex: 'source', key: 'source', ellipsis: true, responsive: ['lg'] as any },
    { title: 'Статус', dataIndex: 'status', key: 'status', width: 110, render: (s: string) => <Tag color={statusCfg[s]?.color}>{statusCfg[s]?.label || s}</Tag> },
    { title: 'Создано', dataIndex: 'createdCount', key: 'createdCount', width: 90 },
    { title: 'Резюме', dataIndex: 'message', key: 'message', ellipsis: true, responsive: ['lg'] as any },
    {
      title: '', key: 'x', width: 110,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => setDetail(r)}>Детали</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card size="small" style={{ marginBottom: 16 }} title="Ручной импорт из PDF">
        {!canWrite && <Alert type="info" showIcon message="Недостаточно прав для запуска импорта." style={{ marginBottom: 12 }} />}
        <Space wrap align="start">
          <div>
            <div style={{ marginBottom: 4 }}><Text type="secondary">Контрагент (с настроенным парсером)</Text></div>
            <Select placeholder="Выберите контрагента" style={{ width: 260 }} value={selCustomer} onChange={setSelCustomer}
              options={customers.map((c) => ({ value: c.id, label: c.name }))} disabled={!canWrite} />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}><Text type="secondary">PDF-файл заявки</Text></div>
            <Upload.Dragger accept="application/pdf" multiple={false} maxCount={1} beforeUpload={(f) => { setFile(f); return false; }}
              fileList={file ? [{ uid: '1', name: file.name } as any] : []} onRemove={() => setFile(null)} disabled={!canWrite}
              style={{ width: 320 }}>
              <p style={{ margin: 0 }}><InboxOutlined /> Перетащите PDF сюда или нажмите</p>
            </Upload.Dragger>
          </div>
          <div style={{ paddingTop: 20 }}>
            <Button type="primary" loading={submitting} disabled={!canWrite || !selCustomer || !file} onClick={onRun}>
              Загрузить и создать заявки
            </Button>
          </div>
        </Space>
        {selCust && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">
              Парсер: <b>{selCust.parserKey}</b> · Авто-импорт: {selCust.autoImportEnabled ? 'вкл' : 'выкл'}
              {' · '}Забирать письма с: {selCust.importSince ? dt(selCust.importSince) : '— (не задано)'}
              {!selCust.email && ' · ⚠ email не заполнен'}
            </Text>
          </div>
        )}
      </Card>

      <Card size="small" title="Журнал импорта" extra={
        <Space>
          {canWrite && <Button size="small" type="primary" loading={checkingMail} onClick={onCheckMail}>Проверить почту сейчас</Button>}
          <Button size="small" icon={<ReloadOutlined />} onClick={load}>Обновить</Button>
        </Space>
      }>
        <Table size="small" rowKey="id" loading={loading} dataSource={logs} columns={columns} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} />
      </Card>

      <Modal open={!!detail} onCancel={() => setDetail(null)} footer={null} width={720} title={`Импорт · ${dt(detail?.createdAt)}`}>
        {detail && (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Статус"><Tag color={statusCfg[detail.status]?.color}>{statusCfg[detail.status]?.label}</Tag></Descriptions.Item>
              <Descriptions.Item label="Этап">{detail.stage || '—'}</Descriptions.Item>
              <Descriptions.Item label="Контрагент">{detail.customer?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Файл">{detail.source || '—'}</Descriptions.Item>
              <Descriptions.Item label="OCR символов">{detail.ocrChars ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Создано">{detail.createdCount}</Descriptions.Item>
            </Descriptions>
            {!!detail.createdNumbers?.length && (
              <Paragraph><b>Заявки:</b> {detail.createdNumbers.map((n: string) => <a key={n} href={`/requests`} style={{ marginRight: 8 }}>{n}</a>)}</Paragraph>
            )}
            {renderList('Извлечено / создано', detail.details?.created?.map((c: any) => `${c.destination} — ${c.pallets} пал (${c.requestNumber})`))}
            {renderList('Пропущено', detail.details?.skipped?.map((s: any) => `${s.destination}: ${s.reason}`), 'orange')}
            {renderList('Ошибки', detail.details?.errors ?? (detail.details?.fatalError ? [detail.details.fatalError] : []), 'red')}
            {renderList('Предупреждения', detail.details?.warnings, 'orange')}
          </>
        )}
      </Modal>
    </>
  );
}

function renderList(title: string, items?: string[], color?: string) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <Text strong>{title}:</Text>
      <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
        {items.map((it, i) => <li key={i} style={{ color: color === 'red' ? '#cf1322' : color === 'orange' ? '#d46b08' : undefined }}>{it}</li>)}
      </ul>
    </div>
  );
}
