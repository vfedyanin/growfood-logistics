'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Segmented, DatePicker, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { RouteSelect, VehicleTypeSelect, CustomerContractSelect, CarrierContractSelect } from '@/components/selects/EntitySelects';
import { getTariffs, createTariff, updateTariff, deleteTariff } from '@/lib/actions/contracts';

const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
const money = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');

export default function TariffsPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const contractSide = Form.useWatch('contractSide', form);

  const load = async () => { setLoading(true); try { setData(await getTariffs()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ contractSide: 'CUSTOMER' }); setOpen(true); };
  const onEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({
      ...r,
      contractSide: r.carrierContractId ? 'CARRIER' : 'CUSTOMER',
      validFrom: r.validFrom ? dayjs(r.validFrom) : null,
      validTo: r.validTo ? dayjs(r.validTo) : null,
    });
    setOpen(true);
  };
  const onDelete = async (id: string) => {
    try { await deleteTariff(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    const payload = { ...v, validFrom: v.validFrom?.toISOString(), validTo: v.validTo ? v.validTo.toISOString() : null };
    try {
      if (editing) await updateTariff(editing.id, payload); else await createTariff(payload);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    {
      title: 'Договор', key: 'contract',
      render: (_: any, r: any) =>
        r.customerContract
          ? <span><Tag color="blue">Клиент</Tag>{r.customerContract.contractNumber} — {r.customerContract.customer?.name}</span>
          : r.carrierContract
            ? <span><Tag color="orange">Перевозчик</Tag>{r.carrierContract.contractNumber} — {r.carrierContract.carrier?.name}</span>
            : '—',
    },
    { title: 'Маршрут', key: 'route', render: (_: any, r: any) => r.route?.code || 'любой', responsive: ['lg'] as any },
    { title: 'Тип ТС', key: 'vt', render: (_: any, r: any) => r.vehicleType?.name || r.vehicleTypeCode },
    { title: '₽/рейс', dataIndex: 'pricePerTrip', key: 'pricePerTrip', render: money },
    { title: '₽/паллета', dataIndex: 'pricePerPallet', key: 'pricePerPallet', render: money, responsive: ['lg'] as any },
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
      <DataTable title="Тарифы" data={data} columns={columns} loading={loading} scrollX={1000}
        toolbar={<Space><ImportExportButtons resource="tariffs" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать тариф' : 'Новый тариф'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing}>
        <Form.Item name="contractSide" label="Сторона договора" rules={[{ required: true }]}>
          <Segmented options={[{ value: 'CUSTOMER', label: 'Клиент' }, { value: 'CARRIER', label: 'Перевозчик' }]} />
        </Form.Item>
        {contractSide === 'CARRIER' ? (
          <Form.Item name="carrierContractId" label="Договор с перевозчиком" rules={[{ required: true }]}>
            <CarrierContractSelect style={{ width: '100%' }} />
          </Form.Item>
        ) : (
          <Form.Item name="customerContractId" label="Договор с клиентом" rules={[{ required: true }]}>
            <CustomerContractSelect style={{ width: '100%' }} />
          </Form.Item>
        )}
        <Form.Item name="routeId" label="Маршрут (опц., пусто = любой)"><RouteSelect style={{ width: '100%' }} /></Form.Item>
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
        <Form.Item name="notes" label="Заметки"><Input.TextArea rows={2} /></Form.Item>
      </EntityForm>
    </>
  );
}
