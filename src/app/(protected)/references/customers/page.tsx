'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, Space, Popconfirm, Tag, message, Drawer, List, Tooltip, InputNumber } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EnvironmentOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { VerticalSelect, LocationSelect } from '@/components/selects/EntitySelects';
import {
  getCustomers, createCustomer, updateCustomer, deleteCustomer,
  getCustomerDeliveryLocations, addCustomerDeliveryLocation,
  updateCustomerDeliveryLocationTariff, removeCustomerDeliveryLocation,
} from '@/lib/actions/references';

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
const tariffMethodOptions = [
  { value: 'PER_PALLET', label: 'За паллет' },
  { value: 'PER_TRIP', label: 'За рейс' },
];

export default function CustomersPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  // Drawer точек выгрузки
  const [dlOpen, setDlOpen] = useState(false);
  const [dlCustomer, setDlCustomer] = useState<any>(null);
  const [dlItems, setDlItems] = useState<any[]>([]);
  const [dlLoading, setDlLoading] = useState(false);
  const [dlAdding, setDlAdding] = useState(false);
  const [dlNewLocationId, setDlNewLocationId] = useState<string | undefined>(undefined);
  const [dlNewTariff, setDlNewTariff] = useState<string | undefined>(undefined);
  const [dlNewAmount, setDlNewAmount] = useState<number | undefined>(undefined);

  const load = async () => { setLoading(true); try { setData(await getCustomers()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const loadDl = async (customerId: string) => {
    setDlLoading(true);
    try { setDlItems(await getCustomerDeliveryLocations(customerId)); }
    finally { setDlLoading(false); }
  };

  const openDlDrawer = (r: any) => {
    setDlCustomer(r);
    setDlNewLocationId(undefined);
    setDlNewTariff(undefined);
    setDlNewAmount(undefined);
    setDlOpen(true);
    loadDl(r.id);
  };

  const handleAddDl = async () => {
    if (!dlNewLocationId || !dlCustomer) return;
    setDlAdding(true);
    try {
      await addCustomerDeliveryLocation(dlCustomer.id, dlNewLocationId, dlNewTariff, dlNewAmount);
      setDlNewLocationId(undefined);
      setDlNewTariff(undefined);
      setDlNewAmount(undefined);
      await loadDl(dlCustomer.id);
    } catch {
      message.error('Уже добавлено или ошибка');
    } finally {
      setDlAdding(false);
    }
  };

  const handleTariffChange = async (item: any, method: string | null, amount: number | null) => {
    try {
      await updateCustomerDeliveryLocationTariff(dlCustomer.id, item.locationId, method, amount);
      await loadDl(dlCustomer.id);
    } catch {
      message.error('Ошибка сохранения');
    }
  };

  const handleRemoveDl = async (locationId: string) => {
    if (!dlCustomer) return;
    try {
      await removeCustomerDeliveryLocation(dlCustomer.id, locationId);
      await loadDl(dlCustomer.id);
    } catch {
      message.error('Ошибка удаления');
    }
  };

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
      title: 'Действия', key: 'actions', width: 140,
      render: (_: any, r: any) => (
        <Space>
          <Tooltip title="Точки выгрузки">
            <Button type="link" icon={<EnvironmentOutlined />} onClick={() => openDlDrawer(r)} />
          </Tooltip>
          {w && <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />}
          {w && (
            <Popconfirm title="Удалить?" onConfirm={() => onDelete(r.id)}>
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <DataTable title="Контрагенты" data={data} columns={columns} loading={loading}
        searchableKeys={['code', 'name', 'inn']}
        toolbar={w ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button> : undefined} />

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

      <Drawer
        title={dlCustomer ? `Точки выгрузки — ${dlCustomer.name}` : 'Точки выгрузки'}
        width={520}
        open={dlOpen}
        onClose={() => setDlOpen(false)}
      >
        {w && (
          <Space style={{ width: '100%', marginBottom: 16 }} wrap>
            <LocationSelect
              style={{ width: 200 }}
              placeholder="Локация"
              value={dlNewLocationId}
              onChange={(v: any) => setDlNewLocationId(v)}
            />
            <Select
              style={{ width: 120 }}
              placeholder="Тариф"
              allowClear
              options={tariffMethodOptions}
              value={dlNewTariff}
              onChange={(v) => setDlNewTariff(v)}
            />
            <InputNumber
              style={{ width: 110 }}
              placeholder="Сумма ₽"
              min={0}
              precision={2}
              value={dlNewAmount}
              onChange={(v) => setDlNewAmount(v ?? undefined)}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={dlAdding}
              disabled={!dlNewLocationId}
              onClick={handleAddDl}
            >
              Добавить
            </Button>
          </Space>
        )}

        <List
          loading={dlLoading}
          dataSource={dlItems}
          locale={{ emptyText: 'Точки выгрузки не добавлены' }}
          renderItem={(item: any) => (
            <List.Item
              actions={w ? [
                <Popconfirm key="del" title="Убрать точку выгрузки?" onConfirm={() => handleRemoveDl(item.locationId)}>
                  <Button type="link" danger size="small" icon={<DeleteOutlined />} />
                </Popconfirm>,
              ] : []}
            >
              <List.Item.Meta
                title={item.location.name}
                description={[item.location.type, item.location.city].filter(Boolean).join(' · ')}
              />
              <Space>
                <Select
                  style={{ width: 120 }}
                  placeholder="Тариф"
                  allowClear
                  disabled={!w}
                  options={tariffMethodOptions}
                  value={item.tariffMethod ?? undefined}
                  onChange={(v) => handleTariffChange(item, v ?? null, item.tariffAmount ? Number(item.tariffAmount) : null)}
                />
                <InputNumber
                  style={{ width: 110 }}
                  placeholder="Сумма ₽"
                  min={0}
                  precision={2}
                  disabled={!w}
                  value={item.tariffAmount ? Number(item.tariffAmount) : undefined}
                  onBlur={(e) => {
                    const val = e.target.value ? parseFloat(e.target.value) : null;
                    handleTariffChange(item, item.tariffMethod ?? null, val);
                  }}
                />
              </Space>
            </List.Item>
          )}
        />
      </Drawer>
    </>
  );
}
