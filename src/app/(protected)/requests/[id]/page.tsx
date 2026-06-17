'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, Form, Input, InputNumber, Select, DatePicker, TimePicker, Space, Popconfirm, Tag, message,
  Modal, Divider, Card, Table, Descriptions, Typography, Empty, Segmented, Spin, Alert,
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined,
  FileTextOutlined, CarOutlined, DisconnectOutlined, ThunderboltOutlined, LinkOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useParams, useRouter } from 'next/navigation';
import { LocationSelect } from '@/components/selects/EntitySelects';
import AsyncSelect from '@/components/selects/AsyncSelect';
import { usePermissions } from '@/hooks/usePermissions';
import {
  getRequest, changeRequestStatus,
  addRequestCargo, updateRequestCargo, removeRequestCargo,
  createInvoiceFromRequest, createTripFromRequest, createTripFromLeg, addCargoLegToTrip, unassignCargoLeg, getAssignableTripOptions,
} from '@/lib/actions/requests';
import { getCustomerDeliveryLocations } from '@/lib/actions/references';
import { findGroupSiblings, linkGroupRequests, unlinkGroupRequest } from '@/lib/actions/contracts';

const { Text } = Typography;

const statusCfg: Record<string, { color: string; label: string }> = {
  NEW: { color: 'blue', label: 'Новая' },
  CONFIRMED: { color: 'cyan', label: 'Подтверждена' },
  IN_PLANNING: { color: 'geekblue', label: 'В планировании' },
  IN_TRANSIT: { color: 'orange', label: 'В пути' },
  DELIVERED: { color: 'green', label: 'Доставлена' },
  CANCELLED: { color: 'red', label: 'Отменена' },
};
const nextStatus: Record<string, string[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PLANNING', 'CANCELLED'],
  IN_PLANNING: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};
const tripStatusCfg: Record<string, string> = {
  DRAFT: 'Черновик', PLANNED: 'Запланирован', IN_TRANSIT: 'В пути', COMPLETED: 'Завершён', CANCELLED: 'Отменён',
};
const productCatOptions = [
  { value: 'READY_FOOD', label: 'Готовая еда' }, { value: 'RAW', label: 'Сырьё' },
  { value: 'EQUIPMENT', label: 'Оборудование' }, { value: 'CONFECTIONERY', label: 'Кондитерка' }, { value: 'OTHER', label: 'Прочее' },
];
const tempRegimeOptions = [
  { value: 'FROZEN', label: 'Заморозка' }, { value: 'COOLED', label: 'Охлаждение' }, { value: 'AMBIENT', label: 'Без режима' },
];
const unitTypeOptions = [
  { value: 'PALLET', label: 'Паллета' }, { value: 'BOX', label: 'Короб' }, { value: 'CARTON', label: 'Коробка' },
];
const pricingModeOptions = [
  { value: 'CARGO', label: 'Цена на груз' },
  { value: 'LEG', label: 'Цена по плечам' },
  { value: 'TARIFF', label: 'По тарифу точки' },
];
const pricingLabel = (m: string) => (m === 'LEG' ? 'цена по плечам' : m === 'TARIFF' ? 'по тарифу точки' : 'цена на груз');

const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
const fmtt = (d: any) => (d ? dayjs(d).format('DD.MM HH:mm') : '—');
const rub = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');

function TariffPreview({ tariff, pallets, discount, scope }: { tariff?: { method: string | null; amount: number }; pallets: any; discount: any; scope: string }) {
  if (!tariff || !tariff.method)
    return <Text type="warning">Тариф для выбранной точки не задан.</Text>;
  const amount = Number(tariff.amount) || 0;
  const base = tariff.method === 'PER_PALLET' ? amount * (Number(pallets) || 0) : amount;
  const final = Math.max(0, base - (Number(discount) || 0));
  const methodLabel = tariff.method === 'PER_PALLET' ? 'за паллету' : 'за рейс';
  return (
    <Text type="secondary">
      Тариф: {amount.toLocaleString('ru')} ₽ {methodLabel}
      {tariff.method === 'PER_PALLET' ? ` × ${Number(pallets) || 0} пал` : ''} = база {base.toLocaleString('ru')} ₽
      {discount ? ` − ${Number(discount).toLocaleString('ru')} ₽ скидка` : ''} → итого {final.toLocaleString('ru')} ₽
    </Text>
  );
}

function LegFields({ name, restField, showPrice }: { name: number; restField: any; showPrice: boolean }) {
  return (
    <Space wrap size="small">
      <Form.Item {...restField} name={[name, 'pickupLocationId']} label="Забор"><LocationSelect style={{ width: 180 }} /></Form.Item>
      <Form.Item {...restField} name={[name, 'dropoffLocationId']} label="Выгрузка"><LocationSelect style={{ width: 180 }} /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedPickupDate']} label="Дата забора"><DatePicker format="DD.MM.YYYY" /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedPickupFrom']} label="с"><TimePicker format="HH:mm" minuteStep={15} placeholder="HH:mm" style={{ width: 95 }} /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedPickupTo']} label="до"><TimePicker format="HH:mm" minuteStep={15} placeholder="HH:mm" style={{ width: 95 }} /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedDropoffDate']} label="Дата выгрузки"><DatePicker format="DD.MM.YYYY" /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedDropoffFrom']} label="с"><TimePicker format="HH:mm" minuteStep={15} placeholder="HH:mm" style={{ width: 95 }} /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedDropoffTo']} label="до"><TimePicker format="HH:mm" minuteStep={15} placeholder="HH:mm" style={{ width: 95 }} /></Form.Item>
      {showPrice && <Form.Item {...restField} name={[name, 'cost']} label="Стоимость, ₽"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>}
      {showPrice && <Form.Item {...restField} name={[name, 'discount']} label="Скидка, ₽"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>}
    </Space>
  );
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const canWrite = can('trips.write');

  const [req, setReq] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tariffMap, setTariffMap] = useState<Record<string, { method: string | null; amount: number }>>({});
  const [siblings, setSiblings] = useState<any[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await getRequest(id);
      setReq(data);
      if (data?.customerId) {
        const locs = await getCustomerDeliveryLocations(data.customerId);
        const map: Record<string, { method: string | null; amount: number }> = {};
        for (const l of locs as any[]) map[l.locationId] = { method: l.tariffMethod ?? null, amount: l.tariffAmount != null ? Number(l.tariffAmount) : 0 };
        setTariffMap(map);
      }
      const sibs = await findGroupSiblings(id);
      setSiblings(sibs || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [id]); // eslint-disable-line

  // ---- груз ----
  const [cargoForm] = Form.useForm();
  const [cargoOpen, setCargoOpen] = useState(false);
  const [editingCargo, setEditingCargo] = useState<any>(null);
  const cargoMode = Form.useWatch('pricingMode', cargoForm) || 'CARGO';
  const cargoLocId = Form.useWatch('consigneeLocationId', cargoForm);
  const cargoPallets = Form.useWatch('pallets', cargoForm);
  const cargoDiscount = Form.useWatch('discount', cargoForm);

  const openAddCargo = () => {
    setEditingCargo(null);
    cargoForm.resetFields();
    cargoForm.setFieldsValue({ unitType: 'PALLET', pricingMode: 'CARGO', legs: [{}] });
    setCargoOpen(true);
  };
  const openEditCargo = (c: any) => {
    setEditingCargo(c);
    cargoForm.resetFields();
    cargoForm.setFieldsValue({
      consigneeLocationId: c.consigneeLocationId,
      unitType: c.unitType,
      pallets: c.pallets,
      traysCount: c.traysCount,
      weightKg: c.weightKg != null ? Number(c.weightKg) : null,
      tempRegime: c.tempRegime,
      pricingMode: c.pricingMode,
      cost: c.cost != null ? Number(c.cost) : null,
      discount: c.discount != null ? Number(c.discount) : null,
      legs: (c.legs || []).filter((l: any) => !l.tripCargoUnitId).map((l: any) => ({
        pickupLocationId: l.pickupLocationId,
        dropoffLocationId: l.dropoffLocationId,
        plannedPickupDate: l.plannedPickup ? dayjs(l.plannedPickup) : null,
        plannedPickupFrom: l.plannedPickup ? dayjs(l.plannedPickup) : null,
        plannedPickupTo: l.plannedPickupTo ? dayjs(l.plannedPickupTo, 'HH:mm') : null,
        plannedDropoffDate: l.plannedDropoff ? dayjs(l.plannedDropoff) : null,
        plannedDropoffFrom: l.plannedDropoff ? dayjs(l.plannedDropoff) : null,
        plannedDropoffTo: l.plannedDropoffTo ? dayjs(l.plannedDropoffTo, 'HH:mm') : null,
        cost: l.cost != null ? Number(l.cost) : null,
        discount: l.discount != null ? Number(l.discount) : null,
      })),
    });
    setCargoOpen(true);
  };

  const toTimeStr = (v: any) => !v ? null : (typeof v === 'string' ? v : v.format('HH:mm'));
  const combineDT = (datePart: any, timePart: any) => {
    if (!datePart) return null;
    if (!timePart) return datePart.startOf('day').toISOString();
    return datePart.clone().hour(timePart.hour()).minute(timePart.minute()).second(0).millisecond(0).toISOString();
  };
  const serializeLegs = (legs: any[]) => (legs || []).map((l: any) => ({
    ...l,
    plannedPickup: combineDT(l.plannedPickupDate, l.plannedPickupFrom),
    plannedPickupTo: toTimeStr(l.plannedPickupTo),
    plannedDropoff: combineDT(l.plannedDropoffDate, l.plannedDropoffFrom),
    plannedDropoffTo: toTimeStr(l.plannedDropoffTo),
  }));

  const submitCargo = async () => {
    const v = await cargoForm.validateFields();
    const payload = { ...v, legs: serializeLegs(v.legs) };
    try {
      if (editingCargo) await updateRequestCargo(editingCargo.id, payload);
      else await addRequestCargo(id, payload);
      message.success('Сохранено');
      setCargoOpen(false);
      refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const removeCargo = async (cargoId: string) => {
    try { await removeRequestCargo(cargoId); message.success('Удалено'); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // ---- плечо в рейс ----
  const [assignForm] = Form.useForm();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigningLeg, setAssigningLeg] = useState<any>(null);

  const openAssign = (leg: any) => { setAssigningLeg(leg); assignForm.resetFields(); setAssignOpen(true); };
  const submitAssign = async () => {
    const v = await assignForm.validateFields();
    try { await addCargoLegToTrip(assigningLeg.id, v.tripId); message.success('Плечо добавлено в рейс'); setAssignOpen(false); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onUnassignLeg = async (legId: string) => {
    try { await unassignCargoLeg(legId); message.success('Плечо отвязано'); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onCreateTripFromLeg = async (legId: string) => {
    try { const r = await createTripFromLeg(legId); message.success(`Создан рейс ${r.tripNumber} на плечо`); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // ---- счёт / рейс ----
  const onCreateInvoice = async () => {
    try { const r = await createInvoiceFromRequest(id); message.success(`Счёт ${r.invoiceNumber} на ${rub(r.amount)}`); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onCreateTrip = async () => {
    try { const r = await createTripFromRequest(id); message.success(`Создан рейс ${r.tripNumber}`); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onStatus = async (to: string) => {
    try { await changeRequestStatus(id, to as any); message.success('Статус изменён'); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const reqSum = (r: any) => (r?.cargoes || []).reduce((s: number, c: any) => s + (c.finalCost != null ? Number(c.finalCost) : 0), 0);

  const legColumns = (cargo: any) => [
    { title: 'Маршрут', key: 'route', render: (_: any, l: any) => `${l.pickupLocation?.name || '—'} → ${l.dropoffLocation?.name || '—'}` },
    {
      title: 'Забор / выгрузка', key: 'dates',
      render: (_: any, l: any) => {
        const pickup = fmtt(l.plannedPickup) + (l.plannedPickupTo ? `–${l.plannedPickupTo}` : '');
        const dropoff = fmtt(l.plannedDropoff) + (l.plannedDropoffTo ? `–${l.plannedDropoffTo}` : '');
        return `${pickup} / ${dropoff}`;
      },
      responsive: ['lg'] as any,
    },
    { title: 'Итого', dataIndex: 'finalCost', key: 'fc', render: rub, responsive: ['lg'] as any },
    {
      title: 'Рейс', key: 'trip',
      render: (_: any, l: any) => l.tripCargoUnit?.trip
        ? <a href={`/operations/trips/${l.tripCargoUnit.tripId}`} style={{ textDecoration: 'none' }}>
            <Tag color="green" style={{ cursor: 'pointer' }}>{l.tripCargoUnit.trip.tripNumber} · {tripStatusCfg[l.tripCargoUnit.trip.status]}</Tag>
          </a>
        : <Tag>Без рейса</Tag>,
    },
    {
      title: '', key: 'x', width: 120,
      render: (_: any, l: any) => canWrite ? (
        !l.tripCargoUnitId
          ? <Space size={0}>
              <Popconfirm title="Создать новый рейс на это плечо?" onConfirm={() => onCreateTripFromLeg(l.id)}>
                <Button type="link" size="small" icon={<ThunderboltOutlined />} title="Создать рейс на плечо" />
              </Popconfirm>
              <Button type="link" size="small" icon={<CarOutlined />} title="В существующий рейс" onClick={() => openAssign(l)} />
            </Space>
          : <Popconfirm title="Отвязать плечо?" onConfirm={() => onUnassignLeg(l.id)}>
              <Button type="link" size="small" icon={<DisconnectOutlined />} title="Отвязать" />
            </Popconfirm>
      ) : null,
    },
  ];

  if (loading && !req) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  if (!req) {
    return (
      <div style={{ padding: 40 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/requests')} style={{ marginBottom: 16 }}>Назад</Button>
        <Empty description="Заявка не найдена" />
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/requests')}>Назад</Button>
        <h2 style={{ margin: 0, fontSize: 20 }}>Заявка {req.requestNumber}</h2>
        <Tag color={statusCfg[req.status]?.color} style={{ fontSize: 13 }}>{statusCfg[req.status]?.label}</Tag>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canWrite && (nextStatus[req.status] || []).map((s) => (
            <Popconfirm key={s} title={`Перевести в «${statusCfg[s]?.label}»?`} onConfirm={() => onStatus(s)}>
              <Button size="small" danger={s === 'CANCELLED'}>{statusCfg[s]?.label}</Button>
            </Popconfirm>
          ))}
          {canWrite && (
            <Button size="small" icon={<CarOutlined />} onClick={onCreateTrip}>Создать рейс</Button>
          )}
          {canWrite && (
            <Popconfirm title={`Создать счёт на ${rub(reqSum(req))}?`} onConfirm={onCreateInvoice}>
              <Button size="small" icon={<FileTextOutlined />}>Создать счёт</Button>
            </Popconfirm>
          )}
        </div>
      </div>

      {/* Групповые заявки */}
      {req.parentRequestId && (
        <Alert
          type="info"
          icon={<LinkOutlined />}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              Групповая заявка — дочерняя к{' '}
              <a href={`/requests/${req.parentRequestId}`}>#{req.parent?.requestNumber || req.parentRequestId.slice(-6)}</a>
              {canWrite && (
                <Button size="small" type="link" danger onClick={async () => { await unlinkGroupRequest(id); refresh(); }}>
                  Отвязать
                </Button>
              )}
            </span>
          }
        />
      )}
      {!req.parentRequestId && siblings.length > 0 && (
        <Alert
          type="warning"
          icon={<LinkOutlined />}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              Найдены заявки из той же группы с той же датой и точкой доставки:{' '}
              {siblings.map((s: any) => (
                <Tag key={s.id} style={{ cursor: 'default' }}>
                  <a href={`/requests/${s.id}`}>#{s.requestNumber}</a> {s.customer?.name}
                </Tag>
              ))}
              {canWrite && (
                <Button
                  size="small"
                  type="primary"
                  icon={<LinkOutlined />}
                  style={{ marginLeft: 8 }}
                  onClick={async () => {
                    await linkGroupRequests(id, siblings[0].id);
                    refresh();
                  }}
                >
                  Связать с {siblings[0]?.requestNumber}
                </Button>
              )}
            </span>
          }
        />
      )}

      {/* Детали */}
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 24 }}>
        <Descriptions.Item label="Заявитель">{req.customer?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="Плательщик">{req.payer?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="Вертикаль">{req.vertical?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="Дата заявки">{fmt(req.requestDate)}</Descriptions.Item>
        <Descriptions.Item label="Отправитель">{req.shipper?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="Откуда (общее)">{req.pickupLocation?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="Куда (общее)">{req.deliveryLocation?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="Дата забора">
          {req.pickupDate ? fmt(req.pickupDate) : '—'}
          {(req.pickupTimeFrom || req.pickupTimeTo) ? ` · ${req.pickupTimeFrom || '?'}–${req.pickupTimeTo || '?'}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Дата доставки">
          {req.deliveryDate ? fmt(req.deliveryDate) : '—'}
          {(req.deliveryTimeFrom || req.deliveryTimeTo) ? ` · ${req.deliveryTimeFrom || '?'}–${req.deliveryTimeTo || '?'}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Паллет">{req.requestedPallets ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Сумма (итого)">{rub(reqSum(req))}</Descriptions.Item>
        <Descriptions.Item label="Счета">{req.invoices?.length ? req.invoices.map((i: any) => `${i.invoiceNumber} (${rub(i.amount)})`).join(', ') : '—'}</Descriptions.Item>
        {req.notes && <Descriptions.Item label="Примечания" span={2}>{req.notes}</Descriptions.Item>}
      </Descriptions>

      {/* Грузы */}
      <Divider orientation={"left" as any}>Грузы и плечи</Divider>
      {canWrite && (
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={openAddCargo} style={{ marginBottom: 8 }}>
          Добавить груз
        </Button>
      )}
      {(req.cargoes || []).length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет грузов" />
      )}
      {(req.cargoes || []).map((c: any) => (
        <Card key={c.id} size="small" style={{ marginBottom: 8 }}
          title={`${c.consigneeLocation?.name || c.consignee?.name || 'Груз'} · ${c.pallets ?? '—'}пал/${c.traysCount ?? '—'}лот · итого ${rub(c.finalCost)} · ${pricingLabel(c.pricingMode)}`}
          extra={canWrite && (
            <Space>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditCargo(c)} />
              <Popconfirm title="Удалить груз?" onConfirm={() => removeCargo(c.id)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}>
          <Table size="small" rowKey="id" pagination={false} dataSource={c.legs || []} columns={legColumns(c)}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет плеч" /> }} />
        </Card>
      ))}

      {/* ===== Груз (add/edit) ===== */}
      <Modal open={cargoOpen} title={editingCargo ? 'Редактировать груз' : 'Добавить груз'}
        onOk={submitCargo} onCancel={() => setCargoOpen(false)} okText="Сохранить" cancelText="Отмена" width={720}>
        <Form form={cargoForm} layout="vertical">
          <Space wrap size="middle">
            <Form.Item name="consigneeLocationId" label="Получатель"><LocationSelect style={{ width: 200 }} /></Form.Item>
            <Form.Item name="unitType" label="Ед. изм." initialValue="PALLET"><Select style={{ width: 120 }} options={unitTypeOptions} /></Form.Item>
            <Form.Item name="pallets" label="Паллет"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
            <Form.Item name="traysCount" label="Лотков"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
            <Form.Item name="weightKg" label="Вес, кг"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
            <Form.Item name="tempRegime" label="Режим"><Select style={{ width: 130 }} options={tempRegimeOptions} allowClear /></Form.Item>
          </Space>
          <Form.Item name="pricingMode" label="Ценообразование" initialValue="CARGO">
            <Segmented options={pricingModeOptions} />
          </Form.Item>
          {cargoMode === 'CARGO' && (
            <Space>
              <Form.Item name="cost" label="Стоимость, ₽"><InputNumber min={0} style={{ width: 130 }} /></Form.Item>
              <Form.Item name="discount" label="Скидка, ₽"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            </Space>
          )}
          {cargoMode === 'TARIFF' && (
            <Space direction="vertical" size={4} style={{ marginBottom: 8 }}>
              <Form.Item name="discount" label="Скидка, ₽" style={{ marginBottom: 4 }}><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
              <TariffPreview tariff={tariffMap[cargoLocId]} pallets={cargoPallets} discount={cargoDiscount} scope="CARGO" />
            </Space>
          )}
          <Divider orientation={"left" as any} style={{ margin: '8px 0' }}>Плечи маршрута</Divider>
          {editingCargo && (editingCargo.legs || []).some((l: any) => l.tripCargoUnitId) && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Плечи, привязанные к рейсам, редактируются отдельно.
            </Text>
          )}
          <Form.List name="legs">
            {(legFields, { add: addLeg, remove: removeLeg }) => (
              <>
                {legFields.map(({ key, name, ...lr }) => (
                  <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                    <LegFields name={name} restField={lr} showPrice={cargoMode === 'LEG'} />
                    <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => removeLeg(name)} />
                  </div>
                ))}
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => addLeg({})}>Добавить плечо</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* ===== Плечо в рейс ===== */}
      <Modal open={assignOpen} title="Добавить плечо в рейс"
        onOk={submitAssign} onCancel={() => setAssignOpen(false)} okText="Добавить" cancelText="Отмена">
        <Form form={assignForm} layout="vertical">
          <Form.Item name="tripId" label="Рейс" rules={[{ required: true, message: 'Выберите рейс' }]}>
            <AsyncSelect fetchOptions={() => getAssignableTripOptions()} placeholder="Выберите рейс (черновик/план/в пути)" style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary">Плечо груза станет грузовой единицей выбранного рейса.</Text>
        </Form>
      </Modal>
    </div>
  );
}
