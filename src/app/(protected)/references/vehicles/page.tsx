'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Switch, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { VehicleTypeSelect, CarrierSelect } from '@/components/selects/EntitySelects';
import { getVehicles, createVehicle, updateVehicle, deleteVehicle } from '@/lib/actions/references';

export default function VehiclesPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getVehicles()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (id: string) => {
    try { await deleteVehicle(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (ТС используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateVehicle(editing.id, v); else await createVehicle(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Гос. номер', dataIndex: 'plateNumber', key: 'plateNumber', width: 140 },
    { title: 'Марка/модель', dataIndex: 'brandModel', key: 'brandModel', render: (v: string) => v || '—' },
    { title: 'Тип ТС', key: 'vehicleType', render: (_: any, r: any) => r.vehicleType?.name || r.vehicleTypeCode },
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
      <DataTable title="Транспортные средства" data={data} columns={columns} loading={loading}
        searchableKeys={['plateNumber', 'brandModel']}
        toolbar={<Space><ImportExportButtons resource="vehicles" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать ТС' : 'Новое ТС'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:vehicle">
        <Form.Item name="plateNumber" label="Гос. номер" rules={[{ required: true }]}><Input placeholder="А123БВ77" /></Form.Item>
        <Form.Item name="brandModel" label="Марка/модель"><Input placeholder="Volvo FH" /></Form.Item>
        <Form.Item name="vehicleTypeCode" label="Тип ТС" rules={[{ required: true }]}><VehicleTypeSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="carrierId" label="Перевозчик"><CarrierSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
