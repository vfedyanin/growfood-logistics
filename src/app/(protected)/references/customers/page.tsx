'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { VerticalSelect } from '@/components/selects/EntitySelects';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '@/lib/actions/references';

const customerTypeOptions = [
  { value: 'INTERNAL', label: 'Внутренний' },
  { value: 'RETAIL_CHAIN', label: 'Розничная сеть' },
  { value: 'EXTERNAL_COMPANY', label: 'Внешняя компания' },
];
const partyRoleOptions = [
  { value: 'SHIPPER', label: 'Грузоотправитель' },
  { value: 'CONSIGNEE', label: 'Грузополучатель' },
  { value: 'BOTH', label: 'Оба' },
];

export default function CustomersPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getCustomers()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ partyRole: 'BOTH', customerType: 'EXTERNAL_COMPANY', isActive: true }); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (id: string) => {
    try { await deleteCustomer(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (контрагент используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateCustomer(editing.id, v); else await createCustomer(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 120 },
    { title: 'Название', dataIndex: 'name', key: 'name' },
    { title: 'ИНН', dataIndex: 'inn', key: 'inn', render: (v: string) => v || '—', responsive: ['lg'] as any },
    { title: 'Вертикаль', key: 'vertical', render: (_: any, r: any) => r.vertical?.name || r.verticalCode, responsive: ['lg'] as any },
    { title: 'Тип', dataIndex: 'customerType', key: 'customerType', render: (t: string) => customerTypeOptions.find((o) => o.value === t)?.label || t },
    { title: 'Роль', dataIndex: 'partyRole', key: 'partyRole', render: (t: string) => <Tag>{partyRoleOptions.find((o) => o.value === t)?.label}</Tag> },
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
      <DataTable title="Контрагенты" data={data} columns={columns} loading={loading}
        searchableKeys={['code', 'name', 'inn']}
        toolbar={<Space><ImportExportButtons resource="customers" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать контрагента' : 'Новый контрагент'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:customer">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="MAGNIT" /></Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="verticalCode" label="Вертикаль" rules={[{ required: true }]}><VerticalSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="customerType" label="Тип" rules={[{ required: true }]}><Select options={customerTypeOptions} /></Form.Item>
        <Form.Item name="partyRole" label="Роль стороны" rules={[{ required: true }]}><Select options={partyRoleOptions} /></Form.Item>
        <Form.Item name="inn" label="ИНН"><Input /></Form.Item>
        <Form.Item name="kpp" label="КПП"><Input /></Form.Item>
        <Form.Item name="fullLegalName" label="Полное юр. название"><Input /></Form.Item>
        <Form.Item name="contactPerson" label="Контактное лицо"><Input /></Form.Item>
        <Form.Item name="phone" label="Телефон"><Input /></Form.Item>
        <Form.Item name="email" label="Email"><Input /></Form.Item>
        <Form.Item name="notes" label="Заметки"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
