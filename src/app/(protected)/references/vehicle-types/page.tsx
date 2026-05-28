'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Switch, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { getVehicleTypes, createVehicleType, updateVehicleType, deleteVehicleType } from '@/lib/actions/references';

export default function VehicleTypesPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getVehicleTypes()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ isRefrigerator: false }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (code: string) => {
    try { await deleteVehicleType(code); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (тип используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateVehicleType(editing.code, v); else await createVehicleType(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 140 },
    { title: 'Название', dataIndex: 'name', key: 'name' },
    { title: 'Грузоподъёмность (кг)', dataIndex: 'capacityKg', key: 'capacityKg', render: (v: any) => v ? Number(v).toLocaleString('ru') : '—' },
    { title: 'Паллеты', dataIndex: 'capacityPallets', key: 'capacityPallets', render: (v: any) => v ?? '—' },
    { title: 'Реф', dataIndex: 'isRefrigerator', key: 'isRefrigerator', render: (v: boolean) => v ? <Tag color="blue">Да</Tag> : <Tag>Нет</Tag> },
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
      <DataTable title="Типы транспорта" data={data} columns={columns} loading={loading} rowKey="code"
        searchableKeys={['code', 'name']}
        toolbar={<Space><ImportExportButtons resource="vehicle-types" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать тип ТС' : 'Новый тип ТС'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:vehicleType">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="REF_20T" /></Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input placeholder="Рефрижератор 20т" /></Form.Item>
        <Form.Item name="capacityKg" label="Грузоподъёмность (кг)"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        <Form.Item name="capacityPallets" label="Кол-во паллет"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        <Form.Item name="isRefrigerator" label="Рефрижератор" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
