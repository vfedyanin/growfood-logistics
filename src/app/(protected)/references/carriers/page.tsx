'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Switch, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { getCarriers, createCarrier, updateCarrier, deleteCarrier } from '@/lib/actions/references';

export default function CarriersPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getCarriers()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (id: string) => {
    try { await deleteCarrier(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (перевозчик используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateCarrier(editing.id, v); else await createCarrier(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 130 },
    { title: 'Название', dataIndex: 'name', key: 'name' },
    { title: 'ИНН', dataIndex: 'inn', key: 'inn', render: (v: string) => v || '—', responsive: ['lg'] as any },
    { title: 'Контакт', dataIndex: 'contactPerson', key: 'contactPerson', render: (v: string) => v || '—', responsive: ['lg'] as any },
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
      <DataTable title="Перевозчики" data={data} columns={columns} loading={loading}
        searchableKeys={['code', 'name', 'inn']}
        toolbar={<Space><ImportExportButtons resource="carriers" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать перевозчика' : 'Новый перевозчик'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:carrier">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="DELLIN" /></Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="inn" label="ИНН"><Input /></Form.Item>
        <Form.Item name="kpp" label="КПП"><Input /></Form.Item>
        <Form.Item name="contactPerson" label="Контактное лицо"><Input /></Form.Item>
        <Form.Item name="phone" label="Телефон"><Input /></Form.Item>
        <Form.Item name="email" label="Email"><Input /></Form.Item>
        <Form.Item name="notes" label="Заметки"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
