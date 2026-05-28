'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { getVerticals, createVertical, updateVertical, deleteVertical } from '@/lib/actions/references';

const typeOptions = [
  { value: 'INTERNAL', label: 'Внутренняя' },
  { value: 'EXTERNAL', label: 'Внешняя' },
];

export default function VerticalsPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getVerticals()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ type: 'INTERNAL', isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (code: string) => {
    try { await deleteVertical(code); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (вертикаль используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateVertical(editing.code, v); else await createVertical(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 140 },
    { title: 'Название', dataIndex: 'name', key: 'name' },
    { title: 'Тип', dataIndex: 'type', key: 'type', render: (t: string) => <Tag color={t === 'INTERNAL' ? 'blue' : 'orange'}>{typeOptions.find((o) => o.value === t)?.label}</Tag> },
    { title: 'Активна', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag> },
    {
      title: 'Действия', key: 'actions', width: 110,
      render: (_: any, r: any) => w ? (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          <Popconfirm title="Удалить?" onConfirm={() => onDelete(r.code)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <>
      <DataTable title="Вертикали" data={data} columns={columns} loading={loading} rowKey="code"
        searchableKeys={['code', 'name']}
        toolbar={<Space><ImportExportButtons resource="verticals" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать вертикаль' : 'Новая вертикаль'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:vertical">
        <Form.Item name="code" label="Код" rules={[{ required: true, message: 'Введите код' }]}>
          <Input disabled={!!editing} placeholder="GROWFOOD" />
        </Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="type" label="Тип" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item>
        <Form.Item name="isActive" label="Активна" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
