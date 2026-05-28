'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, DatePicker, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { RouteSelect, VehicleTypeSelect } from '@/components/selects/EntitySelects';
import { getMarketPrices, createMarketPrice, updateMarketPrice, deleteMarketPrice } from '@/lib/actions/contracts';

const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
const money = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');

export default function MarketPricesPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getMarketPrices()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const onEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ ...r, validFrom: r.validFrom ? dayjs(r.validFrom) : null, validTo: r.validTo ? dayjs(r.validTo) : null });
    setOpen(true);
  };
  const onDelete = async (id: string) => {
    try { await deleteMarketPrice(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    const payload = { ...v, validFrom: v.validFrom?.toISOString(), validTo: v.validTo ? v.validTo.toISOString() : null };
    try {
      if (editing) await updateMarketPrice(editing.id, payload); else await createMarketPrice(payload);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Маршрут', key: 'route', render: (_: any, r: any) => r.route?.code || '—' },
    { title: 'Тип ТС', key: 'vt', render: (_: any, r: any) => r.vehicleType?.name || r.vehicleTypeCode },
    { title: '₽/рейс', dataIndex: 'pricePerTrip', key: 'pricePerTrip', render: money },
    { title: '₽/паллета', dataIndex: 'pricePerPallet', key: 'pricePerPallet', render: money, responsive: ['lg'] as any },
    { title: 'Источник', dataIndex: 'source', key: 'source', render: (v: string) => v || '—', responsive: ['lg'] as any },
    { title: 'Действует с', dataIndex: 'validFrom', key: 'validFrom', render: fmt, responsive: ['lg'] as any },
    {
      title: 'Действия', key: 'actions', width: 110,
      render: (_: any, r: any) => w ? (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          <Popconfirm title="Удалить?" onConfirm={() => onDelete(r.id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <>
      <DataTable title="Рыночные цены" data={data} columns={columns} loading={loading}
        toolbar={<Space><ImportExportButtons resource="market-prices" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать цену' : 'Новая рыночная цена'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing}>
        <Form.Item name="routeId" label="Маршрут" rules={[{ required: true }]}><RouteSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="vehicleTypeCode" label="Тип ТС" rules={[{ required: true }]}><VehicleTypeSelect style={{ width: '100%' }} /></Form.Item>
        <Space size="large" wrap>
          <Form.Item name="pricePerTrip" label="₽/рейс"><InputNumber style={{ width: 150 }} min={0} /></Form.Item>
          <Form.Item name="pricePerPallet" label="₽/паллета"><InputNumber style={{ width: 150 }} min={0} /></Form.Item>
          <Form.Item name="pricePerKm" label="₽/км"><InputNumber style={{ width: 150 }} min={0} /></Form.Item>
        </Space>
        <Space size="large">
          <Form.Item name="validFrom" label="Действует с" rules={[{ required: true }]}><DatePicker format="DD.MM.YYYY" /></Form.Item>
          <Form.Item name="validTo" label="по"><DatePicker format="DD.MM.YYYY" /></Form.Item>
        </Space>
        <Form.Item name="source" label="Источник"><Input placeholder="ПФГК прайс, звонок ИП..." /></Form.Item>
      </EntityForm>
    </>
  );
}
