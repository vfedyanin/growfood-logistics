'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Segmented, DatePicker, Space, Popconfirm, Tag, Switch, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import ImportExportButtons from '@/components/ImportExportButtons';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { DirectionSelect, VehicleTypeSelect, CustomerContractSelect, CarrierContractSelect } from '@/components/selects/EntitySelects';
import { getTariffs, createTariff, updateTariff, deleteTariff, getContractVat } from '@/lib/actions/contracts';

const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
const money = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');
// ставка НДС договора тарифа (вычисляется из связанного договора)
const tariffVat = (r: any): number => r.customerContract?.vatRatePct ?? r.carrierContract?.vatRatePct ?? 0;
const grossOf = (v: any, vat: number) => (v != null ? Math.round(Number(v) * (1 + vat / 100) * 100) / 100 : null);

export default function TariffsPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const contractSide = Form.useWatch('contractSide', form);
  const custId = Form.useWatch('customerContractId', form);
  const carrId = Form.useWatch('carrierContractId', form);
  const pTrip = Form.useWatch('pricePerTrip', form);
  const pPallet = Form.useWatch('pricePerPallet', form);
  const pKm = Form.useWatch('pricePerKm', form);
  const [vatRate, setVatRate] = useState(0);
  const [priceIncludesVat, setPriceIncludesVat] = useState(false);

  const load = async () => { setLoading(true); try { setData(await getTariffs()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  // ставка НДС подтягивается из выбранного договора
  useEffect(() => {
    const id = contractSide === 'CARRIER' ? carrId : custId;
    if (!open || !id) { setVatRate(0); return; }
    getContractVat(contractSide === 'CARRIER' ? 'CARRIER' : 'CUSTOMER', id).then(setVatRate).catch(() => setVatRate(0));
    // eslint-disable-next-line
  }, [contractSide, custId, carrId, open]);

  const onAdd = () => { setEditing(null); form.resetFields(); setVatRate(0); setPriceIncludesVat(false); form.setFieldsValue({ contractSide: 'CUSTOMER' }); setOpen(true); };
  const onEdit = (r: any) => {
    setEditing(r);
    setVatRate(tariffVat(r));
    setPriceIncludesVat(false);
    form.setFieldsValue({
      ...r,
      contractSide: r.carrierContractId ? 'CARRIER' : 'CUSTOMER',
      validFrom: r.validFrom ? dayjs(r.validFrom) : null,
      validTo: r.validTo ? dayjs(r.validTo) : null,
    });
    setOpen(true);
  };
  const onDelete = async (id: string) => {
    try { await deleteTariff(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить'); }
  };
  const toNet = (v: any) => {
    if (v == null || !priceIncludesVat || !vatRate) return v;
    return Math.round(Number(v) / (1 + vatRate / 100) * 100) / 100;
  };

  const onSubmit = async () => {
    const v = await form.validateFields();
    const payload = {
      ...v,
      pricePerTrip: toNet(v.pricePerTrip),
      pricePerPallet: toNet(v.pricePerPallet),
      pricePerKm: toNet(v.pricePerKm),
      validFrom: v.validFrom?.toISOString(),
      validTo: v.validTo ? v.validTo.toISOString() : null,
    };
    try {
      if (editing) await updateTariff(editing.id, payload); else await createTariff(payload);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    {
      title: 'Договор', key: 'contract',
      render: (_: any, r: any) =>
        r.customerContract
          ? <span><Tag color="blue">Клиент</Tag>{r.customerContract.contractNumber} — {r.customerContract.customer?.name}</span>
          : r.carrierContract
            ? <span><Tag color="orange">Перевозчик</Tag>{r.carrierContract.contractNumber} — {r.carrierContract.carrier?.name}</span>
            : '—',
    },
    { title: 'НДС', key: 'vat', width: 80, render: (_: any, r: any) => { const v = tariffVat(r); return v ? `${v}%` : 'без НДС'; } },
    { title: 'Направление', key: 'direction', render: (_: any, r: any) => r.direction?.name || r.direction?.code || 'любое', responsive: ['lg'] as any },
    { title: 'Тип ТС', key: 'vt', render: (_: any, r: any) => r.vehicleType?.name || r.vehicleTypeCode },
    { title: '₽/рейс', dataIndex: 'pricePerTrip', key: 'pricePerTrip', render: money },
    { title: '₽/рейс с НДС', key: 'pricePerTripGross', render: (_: any, r: any) => money(grossOf(r.pricePerTrip, tariffVat(r))), responsive: ['lg'] as any },
    { title: '₽/паллета', dataIndex: 'pricePerPallet', key: 'pricePerPallet', render: money, responsive: ['lg'] as any },
    { title: 'Действует с', dataIndex: 'validFrom', key: 'validFrom', render: fmt, responsive: ['lg'] as any },
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
      <DataTable title="Тарифы" data={data} columns={columns} loading={loading} scrollX={1100}
        toolbar={<Space><ImportExportButtons resource="tariffs" onChanged={load} canWrite={w} />{w && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>}</Space>} />
      <EntityForm open={open} title={editing ? 'Редактировать тариф' : 'Новый тариф'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing}>
        <Form.Item name="contractSide" label="Сторона договора" rules={[{ required: true }]}>
          <Segmented options={[{ value: 'CUSTOMER', label: 'Клиент' }, { value: 'CARRIER', label: 'Перевозчик' }]} />
        </Form.Item>
        {contractSide === 'CARRIER' ? (
          <Form.Item name="carrierContractId" label="Договор с перевозчиком" rules={[{ required: true }]}>
            <CarrierContractSelect style={{ width: '100%' }} />
          </Form.Item>
        ) : (
          <Form.Item name="customerContractId" label="Договор с клиентом" rules={[{ required: true }]}>
            <CustomerContractSelect style={{ width: '100%' }} />
          </Form.Item>
        )}
        <div style={{ marginTop: -8, marginBottom: 12, padding: '6px 10px', background: '#f6f6f6', borderRadius: 6, fontSize: 13 }}>
          Ставка НДС по договору: <b>{vatRate ? `${vatRate}%` : 'без НДС'}</b>
        </div>
        {vatRate > 0 && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch checked={priceIncludesVat} onChange={setPriceIncludesVat} size="small" />
            <span style={{ fontSize: 13 }}>
              {priceIncludesVat
                ? <><b>Ввожу с НДС</b> — система сохранит нетто автоматически</>
                : <>Ввожу без НДС</>}
            </span>
          </div>
        )}
        <Form.Item name="directionId" label="Направление (опц., пусто = любое)"><DirectionSelect style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="vehicleTypeCode" label="Тип ТС" rules={[{ required: true }]}><VehicleTypeSelect style={{ width: '100%' }} /></Form.Item>
        <Space size="large" wrap>
          <Form.Item name="pricePerTrip" label={priceIncludesVat ? '₽/рейс (с НДС)' : '₽/рейс (без НДС)'}>
            <InputNumber style={{ width: 150 }} min={0} precision={2} step={100} />
          </Form.Item>
          <Form.Item name="pricePerPallet" label={priceIncludesVat ? '₽/паллета (с НДС)' : '₽/паллета (без НДС)'}>
            <InputNumber style={{ width: 150 }} min={0} precision={2} step={100} />
          </Form.Item>
          <Form.Item name="pricePerKm" label={priceIncludesVat ? '₽/км (с НДС)' : '₽/км (без НДС)'}>
            <InputNumber style={{ width: 150 }} min={0} precision={2} step={1} />
          </Form.Item>
        </Space>
        <div style={{ marginBottom: 12, padding: '6px 10px', background: '#f6ffed', border: '1px solid #d9f7be', borderRadius: 6, fontSize: 13 }}>
          {priceIncludesVat && vatRate > 0 ? (
            <>Будет сохранено нетто: ₽/рейс <b>{money(toNet(pTrip))}</b> · ₽/паллета <b>{money(toNet(pPallet))}</b> · ₽/км <b>{money(toNet(pKm))}</b></>
          ) : (
            <>Итоговая цена с НДС{vatRate ? ` ${vatRate}%` : ''}: ₽/рейс <b>{money(grossOf(pTrip, vatRate))}</b> · ₽/паллета <b>{money(grossOf(pPallet, vatRate))}</b> · ₽/км <b>{money(grossOf(pKm, vatRate))}</b></>
          )}
        </div>
        <Space size="large">
          <Form.Item name="validFrom" label="Действует с" rules={[{ required: true }]}><DatePicker format="DD.MM.YYYY" /></Form.Item>
          <Form.Item name="validTo" label="по"><DatePicker format="DD.MM.YYYY" /></Form.Item>
        </Space>
        <Form.Item name="notes" label="Заметки"><Input.TextArea rows={2} /></Form.Item>
      </EntityForm>
    </>
  );
}
