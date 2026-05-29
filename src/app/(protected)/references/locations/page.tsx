'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, Space, Popconfirm, Tag, message, InputNumber } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { getLocations, createLocation, updateLocation, deleteLocation } from '@/lib/actions/references';

const typeOptions = [
  { value: 'WAREHOUSE', label: 'Склад' },
  { value: 'HUB', label: 'Хаб' },
  { value: 'KITCHEN', label: 'Кухня' },
  { value: 'DC', label: 'РЦ' },
  { value: 'RETAIL_POINT', label: 'Точка розницы' },
  { value: 'FACTORY', label: 'Производство' },
];
const ownerOptions = [
  { value: 'OWN', label: 'Собственная' },
  { value: 'CUSTOMER', label: 'Клиента' },
  { value: 'PARTNER', label: 'Партнёра' },
];

export default function LocationsPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getLocations()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ ownerType: 'OWN', isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (id: string) => {
    try { await deleteLocation(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (локация используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateLocation(editing.id, v); else await createLocation(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 130 },
    { title: 'Название', dataIndex: 'name', key: 'name' },
    { title: 'Тип', dataIndex: 'type', key: 'type', render: (t: string) => typeOptions.find((o) => o.value === t)?.label || t },
    { title: 'Владелец', dataIndex: 'ownerType', key: 'ownerType', render: (t: string) => ownerOptions.find((o) => o.value === t)?.label || t, responsive: ['lg'] as any },
    { title: 'Город', dataIndex: 'city', key: 'city', render: (v: string) => v || '—', responsive: ['lg'] as any },
    { title: 'Активна', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag> },
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
      <DataTable title="Локации" data={data} columns={columns} loading={loading}
        searchableKeys={['code', 'name', 'city']}
        toolbar={<Space><ImportExportButtons resource="locations" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать локацию' : 'Новая локация'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:location">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="MSK_DC" /></Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="type" label="Тип" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item>
        <Form.Item name="ownerType" label="Владелец" rules={[{ required: true }]}><Select options={ownerOptions} /></Form.Item>
        <Form.Item name="city" label="Город"><Input /></Form.Item>
        <Form.Item name="region" label="Регион"><Input /></Form.Item>
        <Form.Item name="address" label="Адрес"><Input.TextArea rows={2} /></Form.Item>
        <Space size="large">
          <Form.Item name="lat" label="Широта"><InputNumber style={{ width: 160 }} /></Form.Item>
          <Form.Item name="lon" label="Долгота"><InputNumber style={{ width: 160 }} /></Form.Item>
        </Space>
        <Form.Item name="isActive" label="Активна" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
