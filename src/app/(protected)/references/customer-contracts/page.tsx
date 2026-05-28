'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, DatePicker, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { CustomerSelect } from '@/components/selects/EntitySelects';
import {
  getCustomerContracts, createCustomerContract, updateCustomerContract, deleteCustomerContract,
} from '@/lib/actions/contracts';

const typeOptions = [
  { value: 'LAAS_SERVICE', label: 'LaaS-услуга' },
  { value: 'RETAIL_SUPPLY', label: 'Поставка в сеть' },
  { value: 'INTERNAL_AGREEMENT', label: 'Внутреннее соглашение' },
];

const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');

export default function CustomerContractsPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getCustomerContracts()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ contractType: 'LAAS_SERVICE', isActive: true }); setOpen(true); };
  const onEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ ...r, validFrom: r.validFrom ? dayjs(r.validFrom) : null, validTo: r.validTo ? dayjs(r.validTo) : null });
    setOpen(true);
  };
  const onDelete = async (id: string) => {
    try { await deleteCustomerContract(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (договор используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    const payload = { ...v, validFrom: v.validFrom?.toISOString(), validTo: v.validTo ? v.validTo.toISOString() : null };
    try {
      if (editing) await updateCustomerContract(editing.id, payload); else await createCustomerContract(payload);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: '№ договора', dataIndex: 'contractNumber', key: 'contractNumber' },
    { title: 'Клиент', key: 'customer', render: (_: any, r: any) => r.customer?.name || '—' },
    { title: 'Тип', dataIndex: 'contractType', key: 'contractType', render: (t: string) => <Tag>{typeOptions.find((o) => o.value === t)?.label}</Tag> },
    { title: 'Действует с', dataIndex: 'validFrom', key: 'validFrom', render: fmt, responsive: ['lg'] as any },
    { title: 'по', dataIndex: 'validTo', key: 'validTo', render: fmt, responsive: ['lg'] as any },
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
      <DataTable title="Договоры с клиентами" data={data} columns={columns} loading={loading}
        searchableKeys={['contractNumber']}
        toolbar={<Space><ImportExportButtons resource="customer-contracts" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать договор' : 'Новый договор'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing}>
        <Form.Item name="contractNumber" label="№ договора" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="customerId" label="Клиент" rules={[{ required: true }]}><CustomerSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="contractType" label="Тип договора" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item>
        <Space size="large">
          <Form.Item name="validFrom" label="Действует с" rules={[{ required: true }]}><DatePicker format="DD.MM.YYYY" /></Form.Item>
          <Form.Item name="validTo" label="по"><DatePicker format="DD.MM.YYYY" /></Form.Item>
        </Space>
        <Form.Item name="paymentTerms" label="Условия оплаты"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="notes" label="Заметки"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>
    </>
  );
}
