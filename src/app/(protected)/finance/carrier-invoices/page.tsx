'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, DatePicker, Select, Space, Popconfirm, Tag, message, Modal } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import { usePermissions } from '@/hooks/usePermissions';
import AsyncSelect from '@/components/selects/AsyncSelect';
import {
  getTripInvoices, getTripsEligibleForInvoice,
  createTripInvoice, updateTripInvoice, deleteTripInvoice,
} from '@/lib/actions/finance';

const statusOptions = [
  { value: 'ISSUED', label: 'Выставлен', color: 'blue' },
  { value: 'SENT', label: 'Отправлен', color: 'cyan' },
  { value: 'PAID', label: 'Оплачен', color: 'green' },
  { value: 'PARTIAL', label: 'Частично', color: 'orange' },
  { value: 'OVERDUE', label: 'Просрочен', color: 'red' },
  { value: 'CANCELLED', label: 'Отменён', color: 'default' },
];
const statusCfg: Record<string, { color: string; label: string }> = Object.fromEntries(statusOptions.map((o) => [o.value, { color: o.color, label: o.label }]));

const rub = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');
const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');

export default function CarrierInvoicesPage() {
  const { can } = usePermissions();
  const canWrite = can('finance.write');

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [tripCost, setTripCost] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try { setData(await getTripInvoices()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ invoiceDate: dayjs(), status: 'ISSUED' });
    setTripCost(null);
    setOpen(true);
  };
  const onEdit = (r: any) => {
    setEditing(r);
    form.resetFields();
    form.setFieldsValue({
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate ? dayjs(r.invoiceDate) : dayjs(),
      amount: r.amount != null ? Number(r.amount) : null,
      dueDate: r.dueDate ? dayjs(r.dueDate) : null,
      status: r.status,
      notes: r.notes || null,
    });
    setOpen(true);
  };

  const onSubmit = async () => {
    try {
      const v = await form.validateFields();
      const payload = {
        invoiceNumber: v.invoiceNumber || undefined,
        invoiceDate: v.invoiceDate ? v.invoiceDate.toISOString() : null,
        amount: v.amount != null ? Number(v.amount) : null,
        dueDate: v.dueDate ? v.dueDate.toISOString() : null,
        notes: v.notes || null,
      };
      if (editing) {
        await updateTripInvoice(editing.id, { ...payload, status: v.status });
        message.success('Счёт обновлён');
      } else {
        if (!v.tripId) throw new Error('Выберите рейс');
        await createTripInvoice({ tripId: v.tripId, ...payload });
        message.success('Счёт создан');
      }
      setOpen(false); load();
    } catch (e: any) {
      if (e?.errorFields) message.error('Заполните обязательные поля');
      else Modal.error({ title: 'Не удалось сохранить счёт', width: 600, content: <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{e?.message || String(e)}</pre> });
    }
  };
  const onDelete = async (id: string) => {
    try { await deleteTripInvoice(id); message.success('Удалено'); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const fetchEligible = async () => {
    const opts = await getTripsEligibleForInvoice();
    return opts.map((o) => ({ value: o.value, label: o.label, _cost: o.actualCost }));
  };
  const onTripChange = (_tripId: any, option: any) => {
    const cost = option?._cost ?? null;
    setTripCost(cost);
    if (cost != null) form.setFieldsValue({ amount: cost });
  };

  const columns = [
    {
      title: 'Дата рейса', key: 'tripDate', width: 140,
      render: (_: any, r: any) => fmt(r.trip?.actualDeparture || r.trip?.plannedDeparture),
    },
    { title: 'Перевозчик', key: 'carrier', render: (_: any, r: any) => r.trip?.carrier?.name || r.carrier?.name || '—' },
    {
      title: 'Маршрут', key: 'route',
      render: (_: any, r: any) => `${r.trip?.origin?.name || '—'} → ${r.trip?.destination?.name || '—'}`,
    },
    { title: '№ рейса', key: 'tripNumber', render: (_: any, r: any) => r.trip?.tripNumber || '—', width: 150, responsive: ['lg'] as any },
    { title: 'Стоимость перевозки', dataIndex: 'amount', key: 'amount', render: rub, width: 170 },
    {
      title: 'Статус', dataIndex: 'status', key: 'status', width: 130,
      render: (s: string) => <Tag color={statusCfg[s]?.color || 'default'}>{statusCfg[s]?.label || s}</Tag>,
    },
    {
      title: '№ счёта', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 200,
      render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span>,
    },
    { title: 'Дата счёта', dataIndex: 'invoiceDate', key: 'invoiceDate', render: fmt, width: 120, responsive: ['lg'] as any },
    {
      title: 'Действия', key: 'actions', width: 110, fixed: 'right' as any,
      render: (_: any, r: any) => canWrite ? (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          <Popconfirm title="Удалить счёт?" onConfirm={() => onDelete(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <>
      <DataTable
        title="Счета за перевозки"
        data={data} columns={columns} loading={loading} scrollX={1200}
        searchableKeys={['invoiceNumber']}
        toolbar={canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Сформировать счёт</Button> : undefined}
      />

      <Modal
        open={open}
        title={editing ? `Счёт ${editing.invoiceNumber}` : 'Новый счёт за перевозку'}
        onOk={onSubmit}
        onCancel={() => setOpen(false)}
        okText="Сохранить" cancelText="Отмена" width={640}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item name="tripId" label="Рейс" rules={[{ required: true, message: 'Выберите рейс' }]}>
              <AsyncSelect fetchOptions={fetchEligible} onChange={onTripChange} placeholder="Выберите рейс (без существующего счёта)" style={{ width: '100%' }} />
            </Form.Item>
          )}
          {!editing && tripCost != null && (
            <div style={{ marginTop: -8, marginBottom: 12, color: '#999', fontSize: 12 }}>
              Себестоимость рейса по тарифу: <b>{rub(tripCost)}</b> — подставлена в «Сумма»
            </div>
          )}
          <Space wrap size="middle">
            <Form.Item name="invoiceNumber" label="№ счёта (опц., будет сгенерирован)" tooltip="Если оставите пустым — сгенерируется автоматически">
              <Input placeholder="напр. от перевозчика" style={{ width: 280 }} />
            </Form.Item>
            <Form.Item name="invoiceDate" label="Дата счёта">
              <DatePicker format="DD.MM.YYYY" style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Space wrap size="middle">
            <Form.Item name="amount" label="Сумма, ₽">
              <InputNumber min={0} style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="dueDate" label="Срок оплаты">
              <DatePicker format="DD.MM.YYYY" style={{ width: 160 }} />
            </Form.Item>
            {editing && (
              <Form.Item name="status" label="Статус">
                <Select options={statusOptions} style={{ width: 160 }} />
              </Form.Item>
            )}
          </Space>
          <Form.Item name="notes" label="Примечания">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
