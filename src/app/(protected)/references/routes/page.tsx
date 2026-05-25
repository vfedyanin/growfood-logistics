'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, Space, Popconfirm, Tag, message, InputNumber } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { LocationSelect } from '@/components/selects/EntitySelects';
import { getRoutes, createRoute, updateRoute, deleteRoute } from '@/lib/actions/references';

const routeTypeOptions = [
  { value: 'DIRECT', label: 'Прямой' },
  { value: 'HUB', label: 'Через хаб' },
  { value: 'MILK_RUN', label: 'Milk-run' },
];

export default function RoutesPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getRoutes()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ routeType: 'DIRECT', isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (id: string) => {
    try { await deleteRoute(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (маршрут используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateRoute(editing.id, v); else await createRoute(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 140 },
    { title: 'Название', dataIndex: 'name', key: 'name', render: (v: string) => v || '—' },
    { title: 'Маршрут', key: 'route', render: (_: any, r: any) => `${r.origin?.name || '—'} → ${r.destination?.name || '—'}` },
    { title: 'Км', dataIndex: 'distanceKm', key: 'distanceKm', render: (v: any) => v ? Number(v) : '—', responsive: ['lg'] as any },
    { title: 'Тип', dataIndex: 'routeType', key: 'routeType', render: (t: string) => <Tag>{routeTypeOptions.find((o) => o.value === t)?.label}</Tag> },
    { title: 'Активен', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag> },
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
      <DataTable title="Маршруты" data={data} columns={columns} loading={loading}
        searchableKeys={['code', 'name']}
        toolbar={w ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button> : undefined} />
      <EntityForm open={open} title={editing ? 'Редактировать маршрут' : 'Новый маршрут'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:route">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="KLP-MSK" /></Form.Item>
        <Form.Item name="name" label="Название"><Input placeholder="Колпино → Москва" /></Form.Item>
        <Form.Item name="originId" label="Откуда" rules={[{ required: true }]}><LocationSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="destinationId" label="Куда" rules={[{ required: true }]}><LocationSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="distanceKm" label="Расстояние (км)"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        <Form.Item name="estimatedHours" label="Время в пути (ч)"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        <Form.Item name="routeType" label="Тип" rules={[{ required: true }]}><Select options={routeTypeOptions} /></Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
