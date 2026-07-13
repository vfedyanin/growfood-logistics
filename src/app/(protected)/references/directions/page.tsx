'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Switch, Space, Popconfirm, Tag, message, InputNumber } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { getDirections, createDirection, updateDirection, deleteDirection } from '@/lib/actions/references';

export default function DirectionsPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getDirections()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (id: string) => {
    try { await deleteDirection(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (направление используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateDirection(editing.id, v); else await createDirection(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 140 },
    { title: 'Название', dataIndex: 'name', key: 'name', render: (v: string) => v || '—' },
    { title: 'Км', dataIndex: 'distanceKm', key: 'distanceKm', render: (v: any) => v ? Number(v) : '—', responsive: ['lg'] as any },
    { title: 'Активно', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag> },
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
      <DataTable title="Направления" data={data} columns={columns} loading={loading}
        searchableKeys={['code', 'name']}
        toolbar={w ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button> : undefined} />
      <EntityForm open={open} title={editing ? 'Редактировать направление' : 'Новое направление'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:direction">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="MSK-NN" /></Form.Item>
        <Form.Item name="name" label="Название"><Input placeholder="Москва — Нижний Новгород" /></Form.Item>
        <Form.Item name="distanceKm" label="Расстояние (км)"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        <Form.Item name="isActive" label="Активно" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
