'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Switch, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { CarrierSelect } from '@/components/selects/EntitySelects';
import { getDrivers, createDriver, updateDriver, deleteDriver } from '@/lib/actions/references';

export default function DriversPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getDrivers()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (id: string) => {
    try { await deleteDriver(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (водитель используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateDriver(editing.id, v); else await createDriver(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'ФИО', dataIndex: 'fullName', key: 'fullName' },
    { title: 'Телефон', dataIndex: 'phone', key: 'phone', render: (v: string) => v || '—' },
    { title: 'Вод. удостоверение', dataIndex: 'licenseNumber', key: 'licenseNumber', render: (v: string) => v || '—', responsive: ['lg'] as any },
    { title: 'Перевозчик', key: 'carrier', render: (_: any, r: any) => r.carrier?.name || '—', responsive: ['lg'] as any },
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
      <DataTable title="Водители" data={data} columns={columns} loading={loading}
        searchableKeys={['fullName', 'phone', 'licenseNumber']}
        toolbar={<Space><ImportExportButtons resource="drivers" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать водителя' : 'Новый водитель'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:driver">
        <Form.Item name="fullName" label="ФИО" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="phone" label="Телефон"><Input /></Form.Item>
        <Form.Item name="licenseNumber" label="Вод. удостоверение"><Input /></Form.Item>
        <Form.Item name="carrierId" label="Перевозчик"><CarrierSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
