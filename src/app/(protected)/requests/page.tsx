'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, Form, Input, InputNumber, Select, DatePicker, TimePicker, Space, Popconfirm, Tag, message,
  Dropdown, Modal, Divider, Card, Table, Descriptions, Typography, Empty, Segmented,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, MoreOutlined, MinusCircleOutlined, EyeOutlined, FileTextOutlined, CarOutlined, DisconnectOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import EntityForm from '@/components/EntityForm';
import FilterBar from '@/components/FilterBar';
import AsyncSelect from '@/components/selects/AsyncSelect';
import { CustomerSelect, LocationSelect, VerticalSelect } from '@/components/selects/EntitySelects';
import { usePermissions } from '@/hooks/usePermissions';
import {
  getRequests, getRequest, createRequest, updateRequest, deleteRequest, changeRequestStatus, getCustomerVerticalCode,
  addRequestCargo, updateRequestCargo, removeRequestCargo,
  createInvoiceFromRequest, createTripFromRequest, createTripFromLeg, addCargoLegToTrip, unassignCargoLeg, getAssignableTripOptions,
} from '@/lib/actions/requests';
import {
  getRequestTemplates, getRequestTemplate, createRequestTemplate, updateRequestTemplate, deleteRequestTemplate,
} from '@/lib/actions/templates';
import { getCustomerTariffLocations } from '@/lib/actions/references';

const { Text } = Typography;

const statusCfg: Record<string, { color: string; label: string }> = {
  NEW: { color: 'blue', label: 'Новая' }, CONFIRMED: { color: 'cyan', label: 'Подтверждена' },
  IN_PLANNING: { color: 'geekblue', label: 'В планировании' }, IN_TRANSIT: { color: 'orange', label: 'В пути' },
  DELIVERED: { color: 'green', label: 'Доставлена' }, CANCELLED: { color: 'red', label: 'Отменена' },
};
const tripStatusCfg: Record<string, string> = { DRAFT: 'Черновик', PLANNED: 'Запланирован', IN_TRANSIT: 'В пути', COMPLETED: 'Завершён', CANCELLED: 'Отменён' };
const nextStatus: Record<string, string[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['IN_PLANNING', 'CANCELLED'],
  IN_PLANNING: ['IN_TRANSIT', 'CANCELLED'], IN_TRANSIT: ['DELIVERED', 'CANCELLED'], DELIVERED: [], CANCELLED: [],
};
const productCatOptions = [
  { value: 'READY_FOOD', label: 'Готовая еда' }, { value: 'RAW', label: 'Сырьё' },
  { value: 'EQUIPMENT', label: 'Оборудование' }, { value: 'CONFECTIONERY', label: 'Кондитерка' }, { value: 'OTHER', label: 'Прочее' },
];
const tempRegimeOptions = [{ value: 'FROZEN', label: 'Заморозка' }, { value: 'COOLED', label: 'Охлаждение' }, { value: 'AMBIENT', label: 'Без режима' }];
const unitTypeOptions = [{ value: 'PALLET', label: 'Паллета' }, { value: 'BOX', label: 'Короб' }, { value: 'CARTON', label: 'Коробка' }];
const pricingModeOptions = [
  { value: 'CARGO', label: 'Цена на груз' },
  { value: 'LEG', label: 'Цена по плечам' },
  { value: 'TARIFF', label: 'По тарифу точки' },
];
const perTripScopeOptions = [
  { value: 'CARGO', label: 'на каждый груз' },
  { value: 'REQUEST', label: 'одна на заявку' },
];
const pricingLabel = (m: string) => (m === 'LEG' ? 'цена по плечам' : m === 'TARIFF' ? 'по тарифу точки' : 'цена на груз');
const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
const fmtt = (d: any) => (d ? dayjs(d).format('DD.MM HH:mm') : '—');
const rub = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');

// Предпросчёт тарифной выручки за доставку груза в точку (авторитетный расчёт — на сервере).
function getTieredPrice(tariff: { method: string | null; amount: number; tiers?: { capacityPallets: number; price: number }[] }, pallets: number): number {
  if (tariff.method === 'PER_TRIP' && tariff.tiers && tariff.tiers.length > 0) {
    const sorted = [...tariff.tiers].sort((a, b) => a.capacityPallets - b.capacityPallets);
    const match = sorted.find((t) => t.capacityPallets >= pallets);
    return match ? match.price : sorted[sorted.length - 1].price;
  }
  return tariff.amount;
}

function TariffPreview({ tariff, pallets, discount, scope }: { tariff?: { method: string | null; amount: number; tiers?: { capacityPallets: number; price: number }[] }; pallets: any; discount: any; scope: string }) {
  const { Text: T } = Typography;
  if (!tariff || !tariff.method)
    return <T type="warning">Тариф для выбранной точки не задан — добавьте его в карточке контрагента (точки доставки).</T>;
  const numPallets = Number(pallets) || 0;
  const amount = getTieredPrice(tariff, numPallets);
  const hasTiers = tariff.method === 'PER_TRIP' && tariff.tiers && tariff.tiers.length > 0;
  const base = tariff.method === 'PER_PALLET' ? amount * numPallets : amount;
  const final = Math.max(0, base - (Number(discount) || 0));
  const methodLabel = tariff.method === 'PER_PALLET' ? 'за паллету' : 'за рейс';
  const vtLabel = hasTiers ? (() => { const sorted = [...tariff.tiers!].sort((a, b) => a.capacityPallets - b.capacityPallets); const match = sorted.find((t) => t.capacityPallets >= numPallets); return match ? ` (${numPallets} пал → ТС до ${match.capacityPallets} пал)` : ''; })() : '';
  return (
    <T type="secondary">
      Тариф: {amount.toLocaleString('ru')} ₽ {methodLabel}{vtLabel}
      {tariff.method === 'PER_PALLET' ? ` × ${numPallets} пал` : ''} = база {base.toLocaleString('ru')} ₽
      {discount ? ` − ${Number(discount).toLocaleString('ru')} ₽ скидка` : ''} → итого {final.toLocaleString('ru')} ₽
      {tariff.method === 'PER_TRIP' && !hasTiers && scope === 'REQUEST' ? ' · фикс делится между PER_TRIP-грузами заявки при сохранении' : ''}
    </T>
  );
}

// Поля одного плеча (используются в Form.List создания и в модалке груза)
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

// Карточка одного груза в форме создания (вложенный список плеч)
function CargoCard({ name, restField, onRemove, form, tariffMap, scope }: { name: number; restField: any; onRemove: () => void; form: any; tariffMap: Record<string, { method: string | null; amount: number }>; scope: string }) {
  const mode = Form.useWatch(['cargoes', name, 'pricingMode'], form) || 'CARGO';
  const locId = Form.useWatch(['cargoes', name, 'consigneeLocationId'], form);
  const pallets = Form.useWatch(['cargoes', name, 'pallets'], form);
  const discount = Form.useWatch(['cargoes', name, 'discount'], form);
  return (
    <Card size="small" style={{ marginBottom: 8 }} title={`Груз №${name + 1}`}
      extra={<Button type="text" danger icon={<MinusCircleOutlined />} onClick={onRemove} />}>
      <Space wrap size="middle">
        <Form.Item {...restField} name={[name, 'consigneeLocationId']} label="Получатель"><LocationSelect style={{ width: 200 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'unitType']} label="Ед. изм." initialValue="PALLET"><Select style={{ width: 120 }} options={unitTypeOptions} /></Form.Item>
        <Form.Item {...restField} name={[name, 'pallets']} label="Паллет"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'traysCount']} label="Лотков"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'weightKg']} label="Вес, кг"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'tempRegime']} label="Режим"><Select style={{ width: 130 }} options={tempRegimeOptions} allowClear /></Form.Item>
      </Space>
      <Form.Item {...restField} name={[name, 'pricingMode']} label="Ценообразование" initialValue="CARGO"><Segmented options={pricingModeOptions} /></Form.Item>
      {mode === 'CARGO' && (
        <Space>
          <Form.Item {...restField} name={[name, 'cost']} label="Стоимость, ₽"><InputNumber min={0} style={{ width: 130 }} /></Form.Item>
          <Form.Item {...restField} name={[name, 'discount']} label="Скидка, ₽"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
        </Space>
      )}
      {mode === 'TARIFF' && (
        <Space direction="vertical" size={4} style={{ marginBottom: 8 }}>
          <Form.Item {...restField} name={[name, 'discount']} label="Скидка, ₽" style={{ marginBottom: 4 }}><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
          <TariffPreview tariff={tariffMap[locId]} pallets={pallets} discount={discount} scope={scope} />
        </Space>
      )}
      <Divider titlePlacement="left" style={{ margin: '8px 0' }}>Плечи маршрута</Divider>
      <Form.List name={[name, 'legs']}>
        {(legFields, { add: addLeg, remove: removeLeg }) => (
          <>
            {legFields.map(({ key, name: ln, ...lr }) => (
              <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                <LegFields name={ln} restField={lr} showPrice={mode === 'LEG'} />
                <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => removeLeg(ln)} />
              </div>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => addLeg({})}>Добавить плечо</Button>
          </>
        )}
      </Form.List>
    </Card>
  );
}

export default function RequestsPage() {
  const { can } = usePermissions();
  const canWrite = can('trips.write');

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const [fStatus, setFStatus] = useState<string>();
  const [fCustomer, setFCustomer] = useState<string>();
  const [fVertical, setFVertical] = useState<string>();
  const [fRange, setFRange] = useState<any>(null);

  // шаблоны
  const [templates, setTemplates] = useState<any[]>([]);
  const [selTemplate, setSelTemplate] = useState<string | undefined>();
  const [tplForm] = Form.useForm();
  const [tplSaveOpen, setTplSaveOpen] = useState(false);

  // детальная карточка (только для edit-формы)
  const [viewReq, setViewReq] = useState<any>(null);

  // груз (add/edit) в карточке
  const [cargoForm] = Form.useForm();
  const [cargoOpen, setCargoOpen] = useState(false);
  const [editingCargo, setEditingCargo] = useState<any>(null);
  const cargoMode = Form.useWatch('pricingMode', cargoForm) || 'CARGO';
  const cargoLocId = Form.useWatch('consigneeLocationId', cargoForm);
  const cargoPallets = Form.useWatch('pallets', cargoForm);
  const cargoDiscount = Form.useWatch('discount', cargoForm);

  // плечо в рейс
  const [assignForm] = Form.useForm();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigningLeg, setAssigningLeg] = useState<any>(null);

  // тарифы точек доставки текущего контрагента (для предпросчёта TARIFF-грузов)
  const [tariffMap, setTariffMap] = useState<Record<string, { method: string | null; amount: number }>>({});
  const perTripScope = Form.useWatch('perTripScope', form) || 'CARGO';
  const loadTariffs = async (custId?: string) => {
    if (!custId) { setTariffMap({}); return; }
    const locs = await getCustomerTariffLocations(custId);
    const map: Record<string, { method: string | null; amount: number; tiers: { capacityPallets: number; price: number }[] }> = {};
    for (const l of locs as any[]) map[l.locationId] = { method: l.tariffMethod ?? null, amount: l.tariffAmount != null ? Number(l.tariffAmount) : 0, tiers: l.tiers ?? [] };
    setTariffMap(map);
  };

  // автоподстановка вертикали из заявителя (в форме создания/редактирования)
  const customerId = Form.useWatch('customerId', form);
  useEffect(() => {
    if (!open || !customerId) return;
    getCustomerVerticalCode(customerId).then((vc) => { if (vc) form.setFieldsValue({ verticalCode: vc }); });
    loadTariffs(customerId);
    // eslint-disable-next-line
  }, [customerId, open]);

  const load = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (fStatus) filters.status = fStatus;
      if (fCustomer) filters.customerId = fCustomer;
      if (fVertical) filters.verticalCode = fVertical;
      if (fRange?.[0]) filters.dateFrom = fRange[0].startOf('day').toISOString();
      if (fRange?.[1]) filters.dateTo = fRange[1].endOf('day').toISOString();
      setData(await getRequests(filters));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fStatus, fCustomer, fVertical, fRange]);
  const loadTemplates = async () => setTemplates(await getRequestTemplates());
  useEffect(() => { loadTemplates(); }, []);

  const refreshView = async (id: string) => setViewReq(await getRequest(id));

  const onAdd = () => {
    setEditing(null); setSelTemplate(undefined); form.resetFields();
    form.setFieldsValue({ requestDate: dayjs(), cargoes: [] });
    setOpen(true);
  };
  const onEdit = async (r: any) => {
    setEditing(r);
    form.setFieldsValue({
      ...r,
      requestDate: r.requestDate ? dayjs(r.requestDate) : null,
      pickupDate: r.pickupDate ? dayjs(r.pickupDate) : null,
      pickupTimeFrom: r.pickupTimeFrom ? dayjs(r.pickupTimeFrom, 'HH:mm') : null,
      pickupTimeTo: r.pickupTimeTo ? dayjs(r.pickupTimeTo, 'HH:mm') : null,
      deliveryDate: r.deliveryDate ? dayjs(r.deliveryDate) : null,
      deliveryTimeFrom: r.deliveryTimeFrom ? dayjs(r.deliveryTimeFrom, 'HH:mm') : null,
      deliveryTimeTo: r.deliveryTimeTo ? dayjs(r.deliveryTimeTo, 'HH:mm') : null,
      requestedWeightKg: r.requestedWeightKg != null ? Number(r.requestedWeightKg) : null,
      cargoes: [],
    });
    setOpen(true);
    setViewReq(await getRequest(r.id)); // для управления грузами/плечами прямо в форме
  };
  const onDelete = async (id: string) => {
    try { await deleteRequest(id); message.success('Удалено'); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onStatus = async (id: string, to: string) => {
    try { await changeRequestStatus(id, to as any); message.success('Статус изменён'); load(); if (viewReq?.id === id) refreshView(id); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
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
  const serializeCargoes = (arr: any[]) => (arr || []).map((c: any) => ({ ...c, legs: serializeLegs(c.legs) }));
  // Груз из БД (на существующей заявке) → формат данных шаблона
  const dbCargoToTpl = (c: any) => ({
    consigneeId: c.consigneeId ?? undefined,
    consigneeLocationId: c.consigneeLocationId ?? undefined,
    unitType: c.unitType || 'PALLET',
    pallets: c.pallets ?? undefined,
    traysCount: c.traysCount ?? undefined,
    weightKg: c.weightKg != null ? Number(c.weightKg) : undefined,
    productCategory: c.productCategory ?? undefined,
    tempRegime: c.tempRegime ?? undefined,
    pricingMode: c.pricingMode || 'CARGO',
    cost: c.cost != null ? Number(c.cost) : undefined,
    discount: c.discount != null ? Number(c.discount) : undefined,
    legs: (c.legs || []).map((l: any) => ({
      pickupLocationId: l.pickupLocationId ?? undefined,
      dropoffLocationId: l.dropoffLocationId ?? undefined,
      plannedPickupDate: l.plannedPickup ? new Date(l.plannedPickup).toISOString() : null,
      plannedPickupFrom: l.plannedPickup ? new Date(l.plannedPickup).toISOString() : null,
      plannedPickupTo: l.plannedPickupTo || null,
      plannedDropoffDate: l.plannedDropoff ? new Date(l.plannedDropoff).toISOString() : null,
      plannedDropoffFrom: l.plannedDropoff ? new Date(l.plannedDropoff).toISOString() : null,
      plannedDropoffTo: l.plannedDropoffTo || null,
      cost: l.cost != null ? Number(l.cost) : undefined,
      discount: l.discount != null ? Number(l.discount) : undefined,
    })),
  });
  const onSubmit = async () => {
    const v = await form.validateFields();
    const payload = {
      ...v,
      requestDate: v.requestDate ? v.requestDate.toISOString() : null,
      pickupDate: v.pickupDate ? v.pickupDate.toISOString() : null,
      pickupTimeFrom: toTimeStr(v.pickupTimeFrom),
      pickupTimeTo: toTimeStr(v.pickupTimeTo),
      deliveryDate: v.deliveryDate ? v.deliveryDate.toISOString() : null,
      deliveryTimeFrom: toTimeStr(v.deliveryTimeFrom),
      deliveryTimeTo: toTimeStr(v.deliveryTimeTo),
    };
    try {
      if (editing) await updateRequest(editing.id, payload);
      else await createRequest({ ...payload, cargoes: serializeCargoes(v.cargoes) });
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  // ---- груз в карточке (с плечами) ----
  const openAddCargo = () => { setEditingCargo(null); cargoForm.resetFields(); cargoForm.setFieldsValue({ unitType: 'PALLET', pricingMode: 'CARGO', legs: [{}] }); setCargoOpen(true); };
  const openEditCargo = (c: any) => {
    setEditingCargo(c);
    cargoForm.resetFields();
    cargoForm.setFieldsValue({
      consigneeLocationId: c.consigneeLocationId, unitType: c.unitType, pallets: c.pallets, traysCount: c.traysCount,
      weightKg: c.weightKg != null ? Number(c.weightKg) : null, tempRegime: c.tempRegime,
      pricingMode: c.pricingMode, cost: c.cost != null ? Number(c.cost) : null, discount: c.discount != null ? Number(c.discount) : null,
      // редактируем только непривязанные плечи
      legs: (c.legs || []).filter((l: any) => !l.tripCargoUnitId).map((l: any) => ({
        pickupLocationId: l.pickupLocationId, dropoffLocationId: l.dropoffLocationId,
        plannedPickupDate: l.plannedPickup ? dayjs(l.plannedPickup) : null,
        plannedPickupFrom: l.plannedPickup ? dayjs(l.plannedPickup) : null,
        plannedPickupTo: l.plannedPickupTo ? dayjs(l.plannedPickupTo, 'HH:mm') : null,
        plannedDropoffDate: l.plannedDropoff ? dayjs(l.plannedDropoff) : null,
        plannedDropoffFrom: l.plannedDropoff ? dayjs(l.plannedDropoff) : null,
        plannedDropoffTo: l.plannedDropoffTo ? dayjs(l.plannedDropoffTo, 'HH:mm') : null,
        cost: l.cost != null ? Number(l.cost) : null, discount: l.discount != null ? Number(l.discount) : null,
      })),
    });
    setCargoOpen(true);
  };
  const submitCargo = async () => {
    const v = await cargoForm.validateFields();
    const payload = { ...v, legs: serializeLegs(v.legs) };
    try {
      if (editingCargo) await updateRequestCargo(editingCargo.id, payload);
      else await addRequestCargo(viewReq.id, payload);
      message.success('Сохранено'); setCargoOpen(false); refreshView(viewReq.id); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const removeCargo = async (id: string) => {
    try { await removeRequestCargo(id); message.success('Удалено'); refreshView(viewReq.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // ---- счёт / рейс / привязка плеча ----
  const onCreateInvoice = async () => {
    try { const r = await createInvoiceFromRequest(viewReq.id); message.success(`Счёт ${r.invoiceNumber} на ${rub(r.amount)}`); refreshView(viewReq.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onCreateTrip = async () => {
    try { const r = await createTripFromRequest(viewReq.id); message.success(`Создан рейс ${r.tripNumber}`); refreshView(viewReq.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const openAssign = (leg: any) => { setAssigningLeg(leg); assignForm.resetFields(); setAssignOpen(true); };
  const submitAssign = async () => {
    const v = await assignForm.validateFields();
    try { await addCargoLegToTrip(assigningLeg.id, v.tripId); message.success('Плечо добавлено в рейс'); setAssignOpen(false); refreshView(viewReq.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onUnassignLeg = async (legId: string) => {
    try { await unassignCargoLeg(legId); message.success('Плечо отвязано'); refreshView(viewReq.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onCreateTripFromLeg = async (legId: string) => {
    try { const r = await createTripFromLeg(legId); message.success(`Создан рейс ${r.tripNumber} на плечо`); refreshView(viewReq.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // ---- шаблоны ----
  const applyTemplate = async (id?: string) => {
    setSelTemplate(id);
    if (!id) return;
    const tpl = await getRequestTemplate(id);
    const d: any = tpl?.data || {};
    form.setFieldsValue({
      ...d,
      requestDate: null,
      requestedPallets: null,
      cargoes: (d.cargoes || []).map((c: any) => ({
        ...c,
        pallets: null,
        weightKg: null,
        legs: (c.legs || []).map((l: any) => ({
          ...l,
          plannedPickupDate: null,
          plannedPickupFrom: l.plannedPickupFrom ? dayjs(l.plannedPickupFrom) : null,
          plannedPickupTo: l.plannedPickupTo ? dayjs(l.plannedPickupTo, 'HH:mm') : null,
          plannedDropoffDate: null,
          plannedDropoffFrom: l.plannedDropoffFrom ? dayjs(l.plannedDropoffFrom) : null,
          plannedDropoffTo: l.plannedDropoffTo ? dayjs(l.plannedDropoffTo, 'HH:mm') : null,
        })),
      })),
    });
    message.success(`Форма заполнена из шаблона «${tpl?.name}»`);
  };
  const openSaveTemplate = () => { const cur = templates.find((t) => t.id === selTemplate); tplForm.resetFields(); tplForm.setFieldsValue({ name: cur?.name }); setTplSaveOpen(true); };
  const submitSaveTemplate = async () => {
    const { name } = await tplForm.validateFields();
    const v = form.getFieldsValue(true);
    // В режиме создания грузы берём из формы; при сохранении из существующей
    // заявки (редактирование) форма грузов не содержит — берём их из заявки.
    const cargoes = Array.isArray(v.cargoes) && v.cargoes.length
      ? serializeCargoes(v.cargoes)
      : (editing?.cargoes || []).map(dbCargoToTpl);
    const data = { ...v, requestDate: v.requestDate ? v.requestDate.toISOString() : null, cargoes };
    try {
      const existing = templates.find((t) => t.name === name);
      if (existing) { await updateRequestTemplate(existing.id, { name, data }); setSelTemplate(existing.id); }
      else { const r = await createRequestTemplate(name, data); setSelTemplate(r.id); }
      message.success('Шаблон сохранён'); setTplSaveOpen(false); loadTemplates();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const deleteSelectedTemplate = async () => {
    if (!selTemplate) return;
    try { await deleteRequestTemplate(selTemplate); message.success('Шаблон удалён'); setSelTemplate(undefined); loadTemplates(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const reqSum = (r: any) => (r?.cargoes || []).reduce((s: number, c: any) => s + (c.finalCost != null ? Number(c.finalCost) : 0), 0);

  const columns = [
    { title: '№ заявки', dataIndex: 'requestNumber', key: 'requestNumber', width: 160 },
    { title: 'Заявитель', key: 'customer', render: (_: any, r: any) => r.customer?.name || '—' },
    { title: 'Куда', key: 'dest', responsive: ['lg'] as any, render: (_: any, r: any) => {
      if (r.deliveryLocation?.name) return r.deliveryLocation.name;
      const locs = (r.cargoes || []).flatMap((c: any) => (c.legs || []).map((l: any) => l.dropoffLocation?.name)).filter(Boolean);
      return locs[locs.length - 1] || '—';
    } },
    { title: 'Отправка', key: 'dateFrom', responsive: ['lg'] as any, render: (_: any, r: any) => {
      const dates = (r.cargoes || []).flatMap((c: any) => (c.legs || []).map((l: any) => l.plannedPickup)).filter(Boolean).sort();
      return dates.length ? fmt(dates[0]) : '—';
    } },
    { title: 'Доставка', key: 'dateTo', responsive: ['lg'] as any, render: (_: any, r: any) => {
      const dates = (r.cargoes || []).flatMap((c: any) => (c.legs || []).map((l: any) => l.plannedDropoff)).filter(Boolean).sort();
      return dates.length ? fmt(dates[dates.length - 1]) : '—';
    } },
    { title: 'Паллет', key: 'pallets', width: 80, render: (_: any, r: any) => { const t = (r.cargoes || []).reduce((s: number, c: any) => s + (c.pallets != null ? Number(c.pallets) : 0), 0); return t || '—'; } },
    { title: 'Сумма', key: 'sum', render: (_: any, r: any) => rub(reqSum(r)) },
    { title: 'Статус', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusCfg[s]?.color}>{statusCfg[s]?.label || s}</Tag> },
    {
      title: 'Действия', key: 'actions', width: 160,
      render: (_: any, r: any) => (
        <Space>
          <a href={`/requests/${r.id}`} style={{ color: '#1677ff', padding: '4px', display: 'inline-flex', alignItems: 'center' }}><EyeOutlined /></a>
          {canWrite && <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />}
          {canWrite && (
            <Dropdown menu={{ items: (nextStatus[r.status] || []).map((s) => ({ key: s, label: statusCfg[s]?.label, danger: s === 'CANCELLED' })), onClick: ({ key }) => onStatus(r.id, key) }} disabled={!(nextStatus[r.status] || []).length}>
              <Button type="link" icon={<MoreOutlined />} />
            </Dropdown>
          )}
          {canWrite && <Popconfirm title="Удалить заявку?" onConfirm={() => onDelete(r.id)}><Button type="link" danger icon={<DeleteOutlined />} /></Popconfirm>}
        </Space>
      ),
    },
  ];

  // Колонки таблицы плеч внутри карточки груза
  const legColumns = (cargo: any) => [
    { title: 'Маршрут', key: 'route', render: (_: any, l: any) => `${l.pickupLocation?.name || '—'} → ${l.dropoffLocation?.name || '—'}` },
    { title: 'Забор/выгрузка', key: 'dates', render: (_: any, l: any) => {
      const pickup = fmtt(l.plannedPickup) + (l.plannedPickupTo ? `–${l.plannedPickupTo}` : '');
      const dropoff = fmtt(l.plannedDropoff) + (l.plannedDropoffTo ? `–${l.plannedDropoffTo}` : '');
      return `${pickup} / ${dropoff}`;
    }, responsive: ['lg'] as any },
    { title: 'Итого', dataIndex: 'finalCost', key: 'fc', render: rub, responsive: ['lg'] as any },
    { title: 'Рейс', key: 'trip', render: (_: any, l: any) => l.tripCargoUnit?.trip ? <Tag color="green">{l.tripCargoUnit.trip.tripNumber} · {tripStatusCfg[l.tripCargoUnit.trip.status]}</Tag> : <Tag>Без рейса</Tag> },
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
          : <Popconfirm title="Отвязать плечо?" onConfirm={() => onUnassignLeg(l.id)}><Button type="link" size="small" icon={<DisconnectOutlined />} title="Отвязать" /></Popconfirm>
      ) : null,
    },
  ];

  // Блок управления грузами и плечами — общий для детальной карточки и формы редактирования
  const renderCargoes = (req: any) => (
    <>
      <Divider titlePlacement="left">Грузы и плечи</Divider>
      {canWrite && <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={openAddCargo} style={{ marginBottom: 8 }}>Добавить груз</Button>}
      {(req.cargoes || []).length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет грузов" />}
      {(req.cargoes || []).map((c: any) => (
        <Card key={c.id} size="small" style={{ marginBottom: 8 }}
          title={`${c.consigneeLocation?.name || c.consignee?.name || 'Груз'} · ${c.pallets ?? '—'}пал/${c.traysCount ?? '—'}лот · итого ${rub(c.finalCost)} · ${pricingLabel(c.pricingMode)}`}
          extra={canWrite && (
            <Space>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditCargo(c)} />
              <Popconfirm title="Удалить груз?" onConfirm={() => removeCargo(c.id)}><Button type="link" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
            </Space>
          )}>
          <Table size="small" rowKey="id" pagination={false} dataSource={c.legs || []} columns={legColumns(c)}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет плеч" /> }} />
        </Card>
      ))}
    </>
  );

  return (
    <>
      <FilterBar onReset={() => { setFStatus(undefined); setFCustomer(undefined); setFVertical(undefined); setFRange(null); }}>
        <Select placeholder="Статус" allowClear style={{ width: 170 }} value={fStatus} onChange={setFStatus} options={Object.entries(statusCfg).map(([v, c]) => ({ value: v, label: c.label }))} />
        <CustomerSelect placeholder="Заявитель" style={{ width: 200 }} value={fCustomer} onChange={setFCustomer} />
        <VerticalSelect placeholder="Вертикаль" style={{ width: 180 }} value={fVertical} onChange={setFVertical} />
        <DatePicker.RangePicker value={fRange} onChange={setFRange} format="DD.MM.YYYY" />
      </FilterBar>

      <DataTable title="Заявки на перевозку" data={data} columns={columns} loading={loading} scrollX={1100}
        searchableKeys={['requestNumber', 'customer.name']}
        toolbar={canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Создать заявку</Button> : undefined} />

      {/* ===== Создание / редактирование ===== */}
      <EntityForm open={open} title={editing ? `Заявка ${editing.requestNumber}` : 'Новая заявка'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} width={860} isEditing={!!editing}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 8, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 12 }}>
          <Text type="secondary">Шаблон:</Text>
          <Select
            placeholder="Заполнить из шаблона"
            style={{ minWidth: 240 }}
            allowClear
            showSearch
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            value={selTemplate}
            onChange={(v) => applyTemplate(v)}
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Button onClick={openSaveTemplate}>Сохранить как шаблон</Button>
          {selTemplate && <Popconfirm title="Удалить шаблон?" onConfirm={deleteSelectedTemplate}><Button danger>Удалить шаблон</Button></Popconfirm>}
        </div>

        <Divider titlePlacement="left">Шапка</Divider>
        <Space wrap size="large">
          <Form.Item name="customerId" label="Заявитель" rules={[{ required: true }]}><CustomerSelect style={{ width: 240 }} /></Form.Item>
          <Form.Item name="payerId" label="Плательщик"><CustomerSelect style={{ width: 240 }} /></Form.Item>
        </Space>
        <Space wrap size="large">
          <Form.Item name="verticalCode" label="Вертикаль (из заявителя)" tooltip="Подтягивается автоматически по заявителю"><VerticalSelect style={{ width: 240 }} disabled /></Form.Item>
          <Form.Item name="shipperId" label="Грузоотправитель"><CustomerSelect partyRole="SHIPPER" style={{ width: 240 }} /></Form.Item>
        </Space>
        <Space wrap size="large">
          <Form.Item name="pickupLocationId" label="Откуда (общее)"><LocationSelect style={{ width: 240 }} allowClear /></Form.Item>
          <Form.Item name="deliveryLocationId" label="Куда (общее)"><LocationSelect style={{ width: 240 }} allowClear /></Form.Item>
        </Space>
        <Space wrap size="large">
          <Form.Item name="requestDate" label="Дата заявки"><DatePicker format="DD.MM.YYYY" style={{ width: 240 }} /></Form.Item>
          <Form.Item name="requestedPallets" label="Кол-во паллет"><InputNumber min={0} style={{ width: 240 }} /></Form.Item>
        </Space>
        <Form.Item name="perTripScope" label="Тариф «за рейс» (PER_TRIP)" initialValue="CARGO"
          tooltip="Как считать фикс-тариф точки для грузов с ценообразованием «По тарифу точки»: на каждый груз отдельно или одной суммой на всю заявку (делится поровну).">
          <Segmented options={perTripScopeOptions} />
        </Form.Item>
        <Form.Item name="notes" label="Примечания"><Input.TextArea rows={2} /></Form.Item>

        <Divider titlePlacement="left">Сопроводительные документы</Divider>
        <Space wrap size="large">
          <Form.Item name="clientUpd" label="УПД Клиента"><Input style={{ width: 240 }} placeholder="Номер УПД" /></Form.Item>
          <Form.Item name="transportNote" label="ТрН"><Input style={{ width: 240 }} placeholder="Номер транспортной накладной" /></Form.Item>
        </Space>

        {!editing && (
          <>
            <Divider titlePlacement="left">Грузы</Divider>
            <Form.List name="cargoes">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <CargoCard key={key} name={name} restField={rest} onRemove={() => remove(name)} form={form} tariffMap={tariffMap} scope={perTripScope} />
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ unitType: 'PALLET', pricingMode: 'CARGO', legs: [{}] })}>Добавить груз</Button>
                </>
              )}
            </Form.List>
          </>
        )}
        {editing && viewReq && viewReq.id === editing.id && renderCargoes(viewReq)}
      </EntityForm>

      {/* ===== Груз (add/edit) с плечами ===== */}
      <Modal open={cargoOpen} title={editingCargo ? 'Редактировать груз' : 'Добавить груз'} onOk={submitCargo} onCancel={() => setCargoOpen(false)} okText="Сохранить" cancelText="Отмена" width={720}>
        <Form form={cargoForm} layout="vertical">
          <Space wrap size="middle">
            <Form.Item name="consigneeLocationId" label="Получатель"><LocationSelect style={{ width: 200 }} /></Form.Item>
            <Form.Item name="unitType" label="Ед. изм." initialValue="PALLET"><Select style={{ width: 120 }} options={unitTypeOptions} /></Form.Item>
            <Form.Item name="pallets" label="Паллет"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
            <Form.Item name="traysCount" label="Лотков"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
            <Form.Item name="weightKg" label="Вес, кг"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
            <Form.Item name="tempRegime" label="Режим"><Select style={{ width: 130 }} options={tempRegimeOptions} allowClear /></Form.Item>
          </Space>
          <Form.Item name="pricingMode" label="Ценообразование" initialValue="CARGO"><Segmented options={pricingModeOptions} /></Form.Item>
          {cargoMode === 'CARGO' && (
            <Space>
              <Form.Item name="cost" label="Стоимость, ₽"><InputNumber min={0} style={{ width: 130 }} /></Form.Item>
              <Form.Item name="discount" label="Скидка, ₽"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            </Space>
          )}
          {cargoMode === 'TARIFF' && (
            <Space direction="vertical" size={4} style={{ marginBottom: 8 }}>
              <Form.Item name="discount" label="Скидка, ₽" style={{ marginBottom: 4 }}><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
              <TariffPreview tariff={tariffMap[cargoLocId]} pallets={cargoPallets} discount={cargoDiscount} scope={perTripScope} />
            </Space>
          )}
          <Divider titlePlacement="left" style={{ margin: '8px 0' }}>Плечи маршрута</Divider>
          {editingCargo && (editingCargo.legs || []).some((l: any) => l.tripCargoUnitId) && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>Плечи, привязанные к рейсам, редактируются отдельно (отвяжите в карточке).</Text>
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
      <Modal open={assignOpen} title="Добавить плечо в рейс" onOk={submitAssign} onCancel={() => setAssignOpen(false)} okText="Добавить" cancelText="Отмена">
        <Form form={assignForm} layout="vertical">
          <Form.Item name="tripId" label="Рейс" rules={[{ required: true, message: 'Выберите рейс' }]}>
            <AsyncSelect fetchOptions={() => getAssignableTripOptions()} placeholder="Выберите рейс (черновик/план/в пути)" style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary">Плечо груза станет грузовой единицей выбранного рейса.</Text>
        </Form>
      </Modal>

      {/* ===== Сохранение шаблона ===== */}
      <Modal open={tplSaveOpen} title="Сохранить шаблон заявки" onOk={submitSaveTemplate} onCancel={() => setTplSaveOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={tplForm} layout="vertical">
          <Form.Item name="name" label="Название шаблона" rules={[{ required: true, message: 'Введите название' }]}><Input placeholder="Напр. LAAS Поляна еженедельно" /></Form.Item>
          <Text type="secondary">Совпадение имени — обновит существующий шаблон. Сохранятся значения формы (включая грузы и плечи).</Text>
        </Form>
      </Modal>
    </>
  );
}
