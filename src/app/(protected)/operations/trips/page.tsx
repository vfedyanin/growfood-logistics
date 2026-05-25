'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Form, Input, InputNumber, Select, DatePicker, Space, Popconfirm, Tag, message,
  Divider, Card, Dropdown, Modal, Typography, Descriptions, Table, Empty,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, MoreOutlined, MinusCircleOutlined,
  EyeOutlined, LoginOutlined, LogoutOutlined, WarningOutlined, DollarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import EntityForm from '@/components/EntityForm';
import FilterBar from '@/components/FilterBar';
import {
  RouteSelect, LocationSelect, CarrierSelect,
  CustomerSelect, VerticalSelect,
} from '@/components/selects/EntitySelects';
import { VehicleSelectCreatable, DriverSelectCreatable } from '@/components/selects/CreatableSelects';
import {
  getTrips, getTrip, createTrip, updateTrip, deleteTrip, changeTripStatus,
  recordDeparture, recordArrival, completeTripQuick, addTripCargoUnit, removeTripCargoUnit, addQualityEvent, calculateTripEconomics, previewTripEconomics,
} from '@/lib/actions/trips';
import { getRoutes } from '@/lib/actions/references';
import {
  getTripTemplates, getTripTemplate, createTripTemplate, updateTripTemplate, deleteTripTemplate,
} from '@/lib/actions/templates';
import { usePermissions } from '@/hooks/usePermissions';
import AsyncSelect from '@/components/selects/AsyncSelect';
import { addCargoLegToTrip, getUnassignedCargoLegOptions } from '@/lib/actions/requests';

const { Text } = Typography;

const statusCfg: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: 'Черновик' },
  PLANNED: { color: 'blue', label: 'Запланирован' },
  IN_TRANSIT: { color: 'orange', label: 'В пути' },
  COMPLETED: { color: 'green', label: 'Завершён' },
  CANCELLED: { color: 'red', label: 'Отменён' },
};
const tripTypeOptions = [
  { value: 'OWN', label: 'OWN (свой)' },
  { value: 'LAAS', label: 'LAAS (услуга КА)' },
  { value: 'CONSOLIDATED', label: 'Консолидированный' },
];
const vatOptions = [{ value: 0, label: '0%' }, { value: 5, label: '5%' }, { value: 22, label: '22%' }];
const unitTypeOptions = [{ value: 'PALLET', label: 'Паллета' }, { value: 'BOX', label: 'Короб' }, { value: 'CARTON', label: 'Коробка' }];
const productCatOptions = [
  { value: 'READY_FOOD', label: 'Готовая еда' }, { value: 'RAW', label: 'Сырьё' },
  { value: 'EQUIPMENT', label: 'Оборудование' }, { value: 'CONFECTIONERY', label: 'Кондитерка' }, { value: 'OTHER', label: 'Прочее' },
];
const tempRegimeOptions = [{ value: 'FROZEN', label: 'Заморозка' }, { value: 'COOLED', label: 'Охлаждение' }, { value: 'AMBIENT', label: 'Без режима' }];
const eventTypeOptions = [
  { value: 'LATE_DEPARTURE', label: 'Поздний выезд' }, { value: 'LATE_ARRIVAL', label: 'Опоздание' },
  { value: 'TEMP_VIOLATION', label: 'Нарушение температуры' }, { value: 'CARGO_DAMAGE', label: 'Повреждение груза' },
  { value: 'ROUTE_DEVIATION', label: 'Отклонение от маршрута' }, { value: 'VEHICLE_BREAKDOWN', label: 'Поломка ТС' },
  { value: 'DOCUMENTATION_ISSUE', label: 'Проблема с документами' },
];
const severityOptions = [
  { value: 'MINOR', label: 'Незначительная' }, { value: 'MAJOR', label: 'Серьёзная' }, { value: 'CRITICAL', label: 'Критическая' },
];

const dt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—');
const money = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');

export default function TripsPage() {
  const { can, roles, isAdmin } = usePermissions();
  const canWrite = can('trips.write');
  const canStatus = canWrite || can('trips.status');
  const canCargo = canWrite || can('cargo.write');
  const canQuality = canWrite || can('quality.write');
  // Диспетчеры ограничены своим типом рейса (как и серверный скоуп)
  const forcedTripType: 'OWN' | 'LAAS' | null = (() => {
    if (isAdmin || roles.includes('LOGISTICS_MANAGER')) return null;
    const laas = roles.includes('LAAS_MANAGER');
    const own = roles.includes('OWN_DISPATCHER');
    if (laas && !own) return 'LAAS';
    if (own && !laas) return 'OWN';
    return null;
  })();

  const [data, setData] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [existingCargo, setExistingCargo] = useState<any[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const toggleRemove = (id: string) => setRemoveIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const [computedCost, setComputedCost] = useState<number | null>(null);
  const [economicsBasis, setEconomicsBasis] = useState<string>('');
  const [calcBusy, setCalcBusy] = useState(false);

  // фильтры
  const [fStatus, setFStatus] = useState<string>();
  const [fType, setFType] = useState<string>();
  const [fRange, setFRange] = useState<any>(null);

  // карточка просмотра
  const [viewOpen, setViewOpen] = useState(false);
  const [viewTrip, setViewTrip] = useState<any>(null);

  // под-модалки
  const [depForm] = Form.useForm();
  const [depOpen, setDepOpen] = useState(false);
  const [arrForm] = Form.useForm();
  const [arrOpen, setArrOpen] = useState(false);
  const [qForm] = Form.useForm();
  const [qOpen, setQOpen] = useState(false);
  const [cargoForm] = Form.useForm();
  const [cargoOpen, setCargoOpen] = useState(false);

  // привязка существующего груза из заявки (в карточке)
  const [attachForm] = Form.useForm();
  const [attachOpen, setAttachOpen] = useState(false);

  // быстрое завершение из списка
  const [completeForm] = Form.useForm();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completingTrip, setCompletingTrip] = useState<any>(null);

  // шаблоны
  const [templates, setTemplates] = useState<any[]>([]);
  const [selTemplate, setSelTemplate] = useState<string | undefined>();
  const [tplForm] = Form.useForm();
  const [tplSaveOpen, setTplSaveOpen] = useState(false);

  const loadTemplates = async () => { setTemplates(await getTripTemplates()); };
  useEffect(() => { loadTemplates(); }, []);

  const applyTemplate = async (id?: string) => {
    setSelTemplate(id);
    if (!id) return;
    const tpl = await getTripTemplate(id);
    const d: any = tpl?.data || {};
    form.setFieldsValue({
      ...d,
      plannedDeparture: d.plannedDeparture ? dayjs(d.plannedDeparture) : null,
      plannedArrival: d.plannedArrival ? dayjs(d.plannedArrival) : null,
      cargoUnits: d.cargoUnits || [],
    });
    message.success(`Форма заполнена из шаблона «${tpl?.name}»`);
  };
  const openSaveTemplate = () => {
    const cur = templates.find((t) => t.id === selTemplate);
    tplForm.resetFields();
    tplForm.setFieldsValue({ name: cur?.name });
    setTplSaveOpen(true);
  };
  const submitSaveTemplate = async () => {
    const { name } = await tplForm.validateFields();
    const v = form.getFieldsValue(true);
    const data = {
      ...v,
      plannedDeparture: v.plannedDeparture ? v.plannedDeparture.toISOString() : null,
      plannedArrival: v.plannedArrival ? v.plannedArrival.toISOString() : null,
    };
    try {
      const existing = templates.find((t) => t.name === name);
      if (existing) { await updateTripTemplate(existing.id, { name, data }); setSelTemplate(existing.id); }
      else { const r = await createTripTemplate(name, data); setSelTemplate(r.id); }
      message.success('Шаблон сохранён'); setTplSaveOpen(false); loadTemplates();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const deleteSelectedTemplate = async () => {
    if (!selTemplate) return;
    try { await deleteTripTemplate(selTemplate); message.success('Шаблон удалён'); setSelTemplate(undefined); loadTemplates(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const tripType = Form.useWatch('tripType', form);
  const routeId = Form.useWatch('routeId', form);
  const shipperId = Form.useWatch('shipperId', form);
  const consigneeId = Form.useWatch('consigneeId', form);

  const load = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (fStatus) filters.status = fStatus;
      if (fType) filters.tripType = fType;
      if (fRange?.[0]) filters.dateFrom = fRange[0].startOf('day').toISOString();
      if (fRange?.[1]) filters.dateTo = fRange[1].endOf('day').toISOString();
      const [trips, rts] = await Promise.all([getTrips(filters), getRoutes()]);
      setData(trips);
      setRoutes(rts);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fStatus, fType, fRange]);

  const routeMap = useMemo(() => Object.fromEntries(routes.map((r) => [r.id, r])), [routes]);

  useEffect(() => {
    if (routeId && routeMap[routeId]) {
      form.setFieldsValue({ originId: routeMap[routeId].originId, destinationId: routeMap[routeId].destinationId });
    }
    // eslint-disable-next-line
  }, [routeId]);

  useEffect(() => {
    if (tripType === 'LAAS' && shipperId) form.setFieldValue('payerId', shipperId);
    else if (tripType === 'OWN' && consigneeId) form.setFieldValue('payerId', consigneeId);
    // eslint-disable-next-line
  }, [tripType, shipperId, consigneeId]);

  const refreshView = async (id: string) => { setViewTrip(await getTrip(id)); };

  const onAdd = () => {
    setEditing(null);
    setSelTemplate(undefined);
    setExistingCargo([]); setRemoveIds([]);
    setComputedCost(null); setEconomicsBasis('');
    form.resetFields();
    form.setFieldsValue({ tripType: forcedTripType || 'OWN', cargoUnits: [], attachCargoIds: [] });
    setOpen(true);
  };
  const onEdit = async (r: any) => {
    const full = await getTrip(r.id);
    setEditing(full ?? r);
    setExistingCargo(full?.cargoUnits ?? []); setRemoveIds([]);
    setComputedCost(full?.actualCost != null ? Number(full.actualCost) : null);
    setEconomicsBasis('');
    form.setFieldsValue({
      ...(full ?? r),
      actualCost: full?.actualCost != null ? Number(full.actualCost) : null,
      plannedWeightKg: full?.plannedWeightKg != null ? Number(full.plannedWeightKg) : null,
      plannedDeparture: full?.plannedDeparture ? dayjs(full.plannedDeparture) : null,
      plannedArrival: full?.plannedArrival ? dayjs(full.plannedArrival) : null,
      cargoUnits: [], // здесь — только НОВЫЕ ручные грузы; существующие показаны отдельно
      attachCargoIds: [],
    });
    setOpen(true);
  };
  const onDelete = async (id: string) => {
    try { await deleteTrip(id); message.success('Рейс удалён'); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка удаления'); }
  };
  const onStatus = async (id: string, to: string) => {
    try { await changeTripStatus(id, to as any); message.success('Статус изменён'); load(); if (viewTrip?.id === id) refreshView(id); }
    catch (e: any) { message.error(e?.message || 'Ошибка перехода'); }
  };
  const openComplete = (r: any) => {
    setCompletingTrip(r);
    completeForm.resetFields();
    completeForm.setFieldsValue({
      actualDeparture: r.actualDeparture ? dayjs(r.actualDeparture) : dayjs(),
      actualArrival: dayjs(),
      actualPallets: r.actualPallets ?? r.plannedPallets ?? undefined,
    });
    setCompleteOpen(true);
  };
  const submitComplete = async () => {
    const v = await completeForm.validateFields();
    try {
      await completeTripQuick(completingTrip.id, {
        actualDeparture: v.actualDeparture ? v.actualDeparture.toISOString() : undefined,
        actualArrival: v.actualArrival.toISOString(),
        actualPallets: v.actualPallets,
        actualWeightKg: v.actualWeightKg ?? undefined,
      });
      message.success('Рейс завершён'); setCompleteOpen(false); load();
      if (viewTrip?.id === completingTrip.id) refreshView(completingTrip.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка завершения'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    const { attachCargoIds = [], cargoUnits = [], ...header } = v;
    const payload = {
      ...header,
      cargoUnits,
      plannedDeparture: v.plannedDeparture ? v.plannedDeparture.toISOString() : null,
      plannedArrival: v.plannedArrival ? v.plannedArrival.toISOString() : null,
    };
    try {
      let tripId = editing?.id;
      if (editing) {
        await updateTrip(editing.id, payload);
        for (const rid of removeIds) await removeTripCargoUnit(rid, editing.id);
      } else {
        const trip = await createTrip(payload);
        tripId = (trip as any)?.id;
      }
      for (const aid of attachCargoIds) if (tripId) await addCargoLegToTrip(aid, tripId);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const onPreviewEconomics = async () => {
    const v = form.getFieldsValue();
    const newPallets = (v.cargoUnits || []).reduce((s: number, c: any) => s + (Number(c?.pallets) || 0), 0);
    const existPallets = existingCargo.reduce((s: number, c: any) => s + (c.pallets || 0), 0);
    setCalcBusy(true);
    try {
      const r = await previewTripEconomics({
        carrierId: v.carrierId,
        vehicleId: v.vehicleId,
        routeId: v.routeId,
        plannedDeparture: v.plannedDeparture ? v.plannedDeparture.toISOString() : undefined,
        pallets: newPallets + existPallets,
      });
      setComputedCost(r.cost); setEconomicsBasis(r.basis);
      form.setFieldsValue({ actualCost: r.cost });
      message.success(`Себестоимость по тарифу (${r.basis}): ${money(r.cost)}`);
    } catch (e: any) { message.error(e?.message || 'Ошибка расчёта'); }
    finally { setCalcBusy(false); }
  };

  const openView = async (r: any) => { setViewTrip(await getTrip(r.id)); setViewOpen(true); };

  // отправление
  const openDeparture = () => { depForm.resetFields(); depForm.setFieldsValue({ actualDeparture: dayjs() }); setDepOpen(true); };
  const submitDeparture = async () => {
    const v = await depForm.validateFields();
    try {
      await recordDeparture(viewTrip.id, { actualDeparture: v.actualDeparture.toISOString() });
      message.success('Отправление зафиксировано'); setDepOpen(false); load(); refreshView(viewTrip.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  // приёмка
  const openArrival = () => { arrForm.resetFields(); arrForm.setFieldsValue({ actualArrival: dayjs() }); setArrOpen(true); };
  const submitArrival = async () => {
    const v = await arrForm.validateFields();
    try {
      await recordArrival(viewTrip.id, {
        actualArrival: v.actualArrival.toISOString(),
        actualPallets: v.actualPallets,
        actualWeightKg: v.actualWeightKg ?? undefined,
        discrepancyNote: v.discrepancyNote || undefined,
      });
      message.success('Приёмка зафиксирована'); setArrOpen(false); load(); refreshView(viewTrip.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  // качество
  const openQuality = () => { qForm.resetFields(); qForm.setFieldsValue({ severity: 'MINOR', eventTime: dayjs() }); setQOpen(true); };
  const submitQuality = async () => {
    const v = await qForm.validateFields();
    try {
      await addQualityEvent(viewTrip.id, { ...v, eventTime: v.eventTime ? v.eventTime.toISOString() : null });
      message.success('Инцидент зарегистрирован'); setQOpen(false); refreshView(viewTrip.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  // груз в карточке
  const openCargo = () => { cargoForm.resetFields(); cargoForm.setFieldsValue({ unitType: 'PALLET' }); setCargoOpen(true); };
  const submitCargo = async () => {
    const v = await cargoForm.validateFields();
    try {
      await addTripCargoUnit(viewTrip.id, v);
      message.success('Груз добавлен'); setCargoOpen(false); refreshView(viewTrip.id); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const removeCargo = async (id: string) => {
    try { await removeTripCargoUnit(id, viewTrip.id); message.success('Удалено'); refreshView(viewTrip.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const openAttach = () => { attachForm.resetFields(); setAttachOpen(true); };
  const submitAttach = async () => {
    const v = await attachForm.validateFields();
    try { await addCargoLegToTrip(v.cargoId, viewTrip.id); message.success('Груз привязан к рейсу'); setAttachOpen(false); refreshView(viewTrip.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onCalcEconomics = async () => {
    try { const r = await calculateTripEconomics(viewTrip.id); message.success(`Себестоимость по тарифу (${r.basis}): ${money(r.cost)}`); refreshView(viewTrip.id); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка расчёта'); }
  };

  const statusMenu = (r: any) => {
    const items: any[] = [];
    if (r.status === 'DRAFT') items.push({ key: 'PLANNED', label: 'В «Запланирован»' });
    if (r.status === 'PLANNED' || r.status === 'IN_TRANSIT') items.push({ key: 'complete', label: 'Завершить…' });
    if (r.status !== 'COMPLETED' && r.status !== 'CANCELLED') items.push({ key: 'CANCELLED', label: 'Отменить', danger: true });
    return items;
  };

  const columns = [
    { title: '№ рейса', dataIndex: 'tripNumber', key: 'tripNumber', width: 160 },
    { title: 'Тип', dataIndex: 'tripType', key: 'tripType', render: (t: string) => <Tag>{tripTypeOptions.find((o) => o.value === t)?.label?.split(' ')[0]}</Tag> },
    { title: 'Маршрут', key: 'route', render: (_: any, r: any) => `${r.origin?.name || '—'} → ${r.destination?.name || '—'}` },
    { title: 'Статус', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusCfg[s]?.color}>{statusCfg[s]?.label || s}</Tag> },
    { title: 'Перевозчик', key: 'carrier', render: (_: any, r: any) => r.carrier?.name || '—', responsive: ['lg'] as any },
    { title: 'Плательщик', key: 'payer', render: (_: any, r: any) => r.payer?.name || '—', responsive: ['lg'] as any },
    { title: 'Вместимость, пал', key: 'cap', width: 130, responsive: ['lg'] as any, render: (_: any, r: any) => r.vehicle?.vehicleType?.capacityPallets ?? '—' },
    {
      title: 'Загрузка, пал', key: 'load', width: 150,
      render: (_: any, r: any) => {
        const cap = r.vehicle?.vehicleType?.capacityPallets;
        const loaded = (r.cargoUnits || []).reduce((s: number, c: any) => s + (c.pallets || 0), 0);
        if (!cap) return loaded ? `${loaded} / —` : '—';
        const pct = Math.round((loaded / cap) * 100);
        const color = pct > 100 ? 'red' : pct >= 80 ? 'green' : pct >= 60 ? 'gold' : 'default';
        return <Tag color={color}>{loaded} / {cap} ({pct}%)</Tag>;
      },
    },
    { title: 'Стоимость', dataIndex: 'actualCost', key: 'cost', render: money, width: 120 },
    { title: 'Выезд (план)', dataIndex: 'plannedDeparture', key: 'pd', render: dt, responsive: ['lg'] as any },
    {
      title: 'Действия', key: 'actions', width: 150,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} onClick={() => openView(r)} />
          {canWrite && <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />}
          {canStatus && (
            <Dropdown menu={{ items: statusMenu(r), onClick: ({ key }) => { if (key === 'complete') openComplete(r); else onStatus(r.id, key); } }} disabled={!statusMenu(r).length}>
              <Button type="link" icon={<MoreOutlined />} />
            </Dropdown>
          )}
          {canWrite && (
            <Popconfirm title="Удалить рейс?" onConfirm={() => onDelete(r.id)}>
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const cargoColumns = [
    { title: 'Получатель', key: 'cust', render: (_: any, c: any) => c.customer?.name || '—' },
    { title: 'Вертикаль', key: 'vert', render: (_: any, c: any) => c.vertical?.name || c.verticalCode || '—' },
    { title: 'Тип', dataIndex: 'unitType', key: 'ut', render: (t: string) => unitTypeOptions.find((o) => o.value === t)?.label || t },
    { title: 'Паллет', dataIndex: 'pallets', key: 'p', render: (v: any) => v ?? '—' },
    { title: 'Лотков', dataIndex: 'traysCount', key: 'tr', render: (v: any) => v ?? '—' },
    { title: 'Доля', dataIndex: 'costSharePct', key: 'sh', render: (v: any) => v != null ? (Number(v) * 100).toFixed(1) + '%' : '—' },
    { title: 'Аллок. стоимость', dataIndex: 'allocatedCost', key: 'ac', render: money },
    {
      title: '', key: 'x', width: 50,
      render: (_: any, c: any) => canCargo ? (
        <Popconfirm title="Убрать груз?" onConfirm={() => removeCargo(c.id)}>
          <Button type="link" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ) : null,
    },
  ];

  return (
    <>
      <FilterBar onReset={() => { setFStatus(undefined); setFType(undefined); setFRange(null); }}>
        <Select placeholder="Статус" allowClear style={{ width: 160 }} value={fStatus} onChange={setFStatus}
          options={Object.entries(statusCfg).map(([v, c]) => ({ value: v, label: c.label }))} />
        <Select placeholder="Тип рейса" allowClear style={{ width: 180 }} value={fType} onChange={setFType} options={tripTypeOptions} />
        <DatePicker.RangePicker value={fRange} onChange={setFRange} format="DD.MM.YYYY" />
      </FilterBar>

      <DataTable title="Рейсы" data={data} columns={columns} loading={loading} scrollX={1150}
        searchableKeys={['tripNumber']}
        toolbar={canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Создать рейс</Button> : undefined} />

      {/* ===== Create / Edit ===== */}
      <EntityForm open={open} title={editing ? `Рейс ${editing.tripNumber}` : 'Новый рейс'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} width={760} isEditing={!!editing}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 8, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 12 }}>
          <Text type="secondary">Шаблон:</Text>
          <Select placeholder="Заполнить из шаблона" style={{ minWidth: 240 }} allowClear
            value={selTemplate} onChange={(v) => applyTemplate(v)}
            options={templates.map((t) => ({ value: t.id, label: t.name }))} />
          <Button onClick={openSaveTemplate}>Сохранить как шаблон</Button>
          {selTemplate && (
            <Popconfirm title="Удалить шаблон?" onConfirm={deleteSelectedTemplate}>
              <Button danger>Удалить шаблон</Button>
            </Popconfirm>
          )}
        </div>
        <Divider titlePlacement="left">Основное</Divider>
        <Space wrap size="large">
          <Form.Item name="tripType" label="Тип рейса" rules={[{ required: true }]}><Select style={{ width: 220 }} options={tripTypeOptions} disabled={!!forcedTripType} /></Form.Item>
          <Form.Item name="verticalCode" label="Вертикаль"><VerticalSelect style={{ width: 220 }} /></Form.Item>
        </Space>
        <Divider titlePlacement="left">Маршрут</Divider>
        <Form.Item name="routeId" label="Маршрут (опц. — подставит точки)"><RouteSelect style={{ width: '100%' }} /></Form.Item>
        <Space wrap size="large">
          <Form.Item name="originId" label="Откуда" rules={[{ required: true }]}><LocationSelect style={{ width: 340 }} /></Form.Item>
          <Form.Item name="destinationId" label="Куда" rules={[{ required: true }]}><LocationSelect style={{ width: 340 }} /></Form.Item>
        </Space>
        <Divider titlePlacement="left">Транспорт</Divider>
        <Space wrap size="large">
          <Form.Item name="carrierId" label="Перевозчик"><CarrierSelect style={{ width: 220 }} /></Form.Item>
          <Form.Item name="vehicleId" label="ТС"><VehicleSelectCreatable style={{ width: 220 }} /></Form.Item>
          <Form.Item name="driverId" label="Водитель"><DriverSelectCreatable style={{ width: 220 }} /></Form.Item>
        </Space>
        <Divider titlePlacement="left">Стороны</Divider>
        <Space wrap size="large">
          <Form.Item name="shipperId" label="Грузоотправитель"><CustomerSelect partyRole="SHIPPER" style={{ width: 220 }} /></Form.Item>
          <Form.Item name="consigneeId" label="Грузополучатель"><CustomerSelect partyRole="CONSIGNEE" style={{ width: 220 }} /></Form.Item>
          <Form.Item name="payerId" label="Плательщик" tooltip="Авто: LAAS → отправитель, OWN → получатель. Можно изменить вручную."><CustomerSelect style={{ width: 220 }} /></Form.Item>
        </Space>
        <Divider titlePlacement="left">Время (план)</Divider>
        <Space wrap size="large">
          <Form.Item name="plannedDeparture" label="Плановый выезд"><DatePicker showTime format="DD.MM.YYYY HH:mm" /></Form.Item>
          <Form.Item name="plannedArrival" label="Плановое прибытие"
            dependencies={['plannedDeparture']}
            rules={[({ getFieldValue }) => ({ validator(_, value) {
              const dep = getFieldValue('plannedDeparture');
              if (value && dep && value.isBefore(dep)) return Promise.reject(new Error('Прибытие раньше выезда'));
              return Promise.resolve();
            } })]}
          ><DatePicker showTime format="DD.MM.YYYY HH:mm" /></Form.Item>
        </Space>
        <Divider titlePlacement="left">Экономика рейса</Divider>
        <Space align="center" wrap>
          <Button icon={<DollarOutlined />} loading={calcBusy} onClick={onPreviewEconomics}>Рассчитать</Button>
          <Text>Себестоимость по тарифу: <b>{computedCost != null ? money(computedCost) : '—'}</b>{economicsBasis ? ` (${economicsBasis})` : ''}</Text>
        </Space>
        <Form.Item name="actualCost" hidden><InputNumber /></Form.Item>
        <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>Расчёт по тарифам перевозчика на тип ТС и дату планового выезда.</Text>
        <Form.Item name="notes" label="Примечания" style={{ marginTop: 12 }}><Input.TextArea rows={2} /></Form.Item>
        <Divider titlePlacement="left">Грузы (для аллокации по лоткам)</Divider>
        {editing && existingCargo.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Text strong>Текущие грузы рейса</Text>
            {existingCargo.map((c: any) => {
              const removed = removeIds.includes(c.id);
              return (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ textDecoration: removed ? 'line-through' : 'none', opacity: removed ? 0.5 : 1 }}>
                    {(c.customer?.name || '—')} · {c.unitType} · {c.pallets ?? '—'}пал/{c.traysCount ?? '—'}лот
                  </span>
                  {c.requestId && c.request ? <Tag color="purple">из заявки {c.request.requestNumber}</Tag> : null}
                  <Button size="small" type="link" danger={!removed} onClick={() => toggleRemove(c.id)}>{removed ? 'Отменить' : 'Убрать'}</Button>
                </div>
              );
            })}
          </div>
        )}
        <Form.Item name="attachCargoIds" label="Привязать грузы без рейса (из заявок/списка грузов)">
          <AsyncSelect mode="multiple" fetchOptions={() => getUnassignedCargoLegOptions()} placeholder="Выберите грузы из списка" style={{ width: '100%' }} />
        </Form.Item>
        <Text type="secondary">Новые ручные грузы:</Text>
        <Form.List name="cargoUnits">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Card key={key} size="small" style={{ marginBottom: 8 }} title={`Груз №${name + 1}`}
                  extra={<Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />}>
                  <Space wrap size="middle">
                    <Form.Item {...rest} name={[name, 'customerId']} label="Получатель части" rules={[{ required: true }]}><CustomerSelect style={{ width: 200 }} /></Form.Item>
                    <Form.Item {...rest} name={[name, 'verticalCode']} label="Вертикаль"><VerticalSelect style={{ width: 160 }} /></Form.Item>
                    <Form.Item {...rest} name={[name, 'unitType']} label="Тип ед." rules={[{ required: true }]} initialValue="PALLET"><Select style={{ width: 130 }} options={unitTypeOptions} /></Form.Item>
                    <Form.Item {...rest} name={[name, 'pallets']} label="Паллет"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
                    <Form.Item {...rest} name={[name, 'traysCount']} label="Лотков" tooltip="Используется для аллокации стоимости"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
                    <Form.Item {...rest} name={[name, 'weightKg']} label="Вес (кг)"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>
                    <Form.Item {...rest} name={[name, 'productCategory']} label="Категория"><Select style={{ width: 150 }} options={productCatOptions} allowClear /></Form.Item>
                    <Form.Item {...rest} name={[name, 'tempRegime']} label="Темп. режим"><Select style={{ width: 140 }} options={tempRegimeOptions} allowClear /></Form.Item>
                  </Space>
                </Card>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ unitType: 'PALLET' })}>Добавить груз</Button>
            </>
          )}
        </Form.List>
      </EntityForm>

      {/* ===== Детальная карточка ===== */}
      <Modal open={viewOpen} onCancel={() => setViewOpen(false)} footer={null} width={900}
        title={viewTrip ? `Рейс ${viewTrip.tripNumber}` : 'Рейс'}>
        {viewTrip && (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Tag color={statusCfg[viewTrip.status]?.color}>{statusCfg[viewTrip.status]?.label}</Tag>
              {canStatus && viewTrip.status === 'DRAFT' && <Button size="small" onClick={() => onStatus(viewTrip.id, 'PLANNED')}>В «Запланирован»</Button>}
              {canStatus && viewTrip.status === 'PLANNED' && <Button size="small" type="primary" icon={<LoginOutlined />} onClick={openDeparture}>Зафиксировать отправление</Button>}
              {canStatus && viewTrip.status === 'IN_TRANSIT' && <Button size="small" type="primary" icon={<LogoutOutlined />} onClick={openArrival}>Зафиксировать приёмку</Button>}
              {canStatus && viewTrip.status !== 'COMPLETED' && viewTrip.status !== 'CANCELLED' && (
                <Popconfirm title="Отменить рейс?" onConfirm={() => onStatus(viewTrip.id, 'CANCELLED')}>
                  <Button size="small" danger>Отменить</Button>
                </Popconfirm>
              )}
              {canQuality && <Button size="small" icon={<WarningOutlined />} onClick={openQuality}>Зарегистрировать инцидент</Button>}
              {canWrite && <Button size="small" icon={<DollarOutlined />} onClick={onCalcEconomics}>Рассчитать экономику</Button>}
            </Space>

            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Тип">{tripTypeOptions.find((o) => o.value === viewTrip.tripType)?.label}</Descriptions.Item>
              <Descriptions.Item label="Вертикаль">{viewTrip.vertical?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Откуда">{viewTrip.origin?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Куда">{viewTrip.destination?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Перевозчик">{viewTrip.carrier?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="ТС / Водитель">{(viewTrip.vehicle?.plateNumber || '—') + ' / ' + (viewTrip.driver?.fullName || '—')}</Descriptions.Item>
              <Descriptions.Item label="Отправитель">{viewTrip.shipper?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Получатель">{viewTrip.consignee?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Плательщик">{viewTrip.payer?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Факт. стоимость">{money(viewTrip.actualCost)}</Descriptions.Item>
              <Descriptions.Item label="Выезд план / факт">{dt(viewTrip.plannedDeparture)} / {dt(viewTrip.actualDeparture)}</Descriptions.Item>
              <Descriptions.Item label="Прибытие план / факт">{dt(viewTrip.plannedArrival)} / {dt(viewTrip.actualArrival)}</Descriptions.Item>
              <Descriptions.Item label="Паллет план / факт">{(viewTrip.plannedPallets ?? '—') + ' / ' + (viewTrip.actualPallets ?? '—')}</Descriptions.Item>
              <Descriptions.Item label="Примечания">{viewTrip.notes || '—'}</Descriptions.Item>
            </Descriptions>

            <Divider titlePlacement="left">Грузы</Divider>
            {canCargo && (
              <Space style={{ marginBottom: 8 }} wrap>
                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={openCargo}>Добавить груз</Button>
                <Button size="small" onClick={openAttach}>Привязать из заявки</Button>
              </Space>
            )}
            <Table size="small" rowKey="id" pagination={false}
              dataSource={viewTrip.cargoUnits || []} columns={cargoColumns}
              locale={{ emptyText: <Empty description="Нет грузов" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />

            <Divider titlePlacement="left">События качества</Divider>
            {viewTrip.qualityEvents?.length ? (
              <Table size="small" rowKey="id" pagination={false}
                dataSource={viewTrip.qualityEvents}
                columns={[
                  { title: 'Тип', dataIndex: 'eventType', render: (t: string) => eventTypeOptions.find((o) => o.value === t)?.label || t },
                  { title: 'Тяжесть', dataIndex: 'severity', render: (s: string) => <Tag color={s === 'CRITICAL' ? 'red' : s === 'MAJOR' ? 'orange' : 'default'}>{severityOptions.find((o) => o.value === s)?.label}</Tag> },
                  { title: 'Время', dataIndex: 'eventTime', render: dt },
                  { title: 'Задержка, мин', dataIndex: 'delayMinutes', render: (v: any) => v ?? '—' },
                  { title: 'Описание', dataIndex: 'description', render: (v: string) => v || '—' },
                ]} />
            ) : <Text type="secondary">Инцидентов нет</Text>}
          </>
        )}
      </Modal>

      {/* ===== Фиксация отправления ===== */}
      <Modal open={depOpen} title="Фиксация отправления" onOk={submitDeparture} onCancel={() => setDepOpen(false)} okText="Зафиксировать" cancelText="Отмена">
        <Form form={depForm} layout="vertical">
          <Form.Item name="actualDeparture" label="Фактический выезд" rules={[{ required: true }]}><DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
          <Text type="secondary">Рейс перейдёт в статус «В пути».</Text>
        </Form>
      </Modal>

      {/* ===== Фиксация приёмки ===== */}
      <Modal open={arrOpen} title="Фиксация приёмки" onOk={submitArrival} onCancel={() => setArrOpen(false)} okText="Зафиксировать" cancelText="Отмена">
        <Form form={arrForm} layout="vertical">
          <Form.Item name="actualArrival" label="Фактическое прибытие" rules={[{ required: true }]}><DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="actualPallets" label="Факт. паллет" rules={[{ required: true, message: 'Укажите кол-во' }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="actualWeightKg" label="Факт. вес (кг)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="discrepancyNote" label="Причина расхождения (если есть)"><Input.TextArea rows={2} /></Form.Item>
          <Text type="secondary">Рейс перейдёт в статус «Завершён», стоимость распределится по лоткам.</Text>
        </Form>
      </Modal>

      {/* ===== Событие качества ===== */}
      <Modal open={qOpen} title="Регистрация инцидента" onOk={submitQuality} onCancel={() => setQOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={qForm} layout="vertical">
          <Form.Item name="eventType" label="Тип события" rules={[{ required: true }]}><Select options={eventTypeOptions} /></Form.Item>
          <Form.Item name="severity" label="Тяжесть" rules={[{ required: true }]}><Select options={severityOptions} /></Form.Item>
          <Form.Item name="eventTime" label="Время события"><DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
          <Space wrap>
            <Form.Item name="tempRecorded" label="Темп. факт"><InputNumber style={{ width: 120 }} /></Form.Item>
            <Form.Item name="delayMinutes" label="Задержка (мин)"><InputNumber min={0} style={{ width: 140 }} /></Form.Item>
          </Space>
          <Form.Item name="description" label="Описание"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* ===== Добавить груз в карточке ===== */}
      <Modal open={cargoOpen} title="Добавить груз" onOk={submitCargo} onCancel={() => setCargoOpen(false)} okText="Добавить" cancelText="Отмена" width={520}>
        <Form form={cargoForm} layout="vertical">
          <Form.Item name="customerId" label="Получатель части" rules={[{ required: true }]}><CustomerSelect style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="verticalCode" label="Вертикаль"><VerticalSelect style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="unitType" label="Тип единицы" rules={[{ required: true }]}><Select options={unitTypeOptions} /></Form.Item>
          <Space wrap>
            <Form.Item name="pallets" label="Паллет"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="traysCount" label="Лотков" tooltip="Для аллокации стоимости"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="weightKg" label="Вес (кг)"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
          </Space>
          <Form.Item name="productCategory" label="Категория"><Select options={productCatOptions} allowClear /></Form.Item>
          <Form.Item name="tempRegime" label="Темп. режим"><Select options={tempRegimeOptions} allowClear /></Form.Item>
        </Form>
      </Modal>

      {/* ===== Привязать груз из заявки (в карточке) ===== */}
      <Modal open={attachOpen} title="Привязать груз из заявки" onOk={submitAttach} onCancel={() => setAttachOpen(false)} okText="Привязать" cancelText="Отмена">
        <Form form={attachForm} layout="vertical">
          <Form.Item name="cargoId" label="Груз без рейса" rules={[{ required: true, message: 'Выберите груз' }]}>
            <AsyncSelect fetchOptions={() => getUnassignedCargoLegOptions()} placeholder="Выберите груз из заявки" style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary">Груз станет грузовой единицей этого рейса.</Text>
        </Form>
      </Modal>

      {/* ===== Сохранение шаблона ===== */}
      <Modal open={tplSaveOpen} title="Сохранить шаблон рейса" onOk={submitSaveTemplate} onCancel={() => setTplSaveOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={tplForm} layout="vertical">
          <Form.Item name="name" label="Название шаблона" rules={[{ required: true, message: 'Введите название' }]}>
            <Input placeholder="Напр. Колпино → Москва, реф" />
          </Form.Item>
          <Text type="secondary">Если название совпадает с существующим шаблоном — он будет обновлён. Текущие значения формы (включая грузы) сохранятся в шаблон.</Text>
        </Form>
      </Modal>

      {/* ===== Быстрое завершение из списка ===== */}
      <Modal open={completeOpen} title={completingTrip ? `Завершение рейса ${completingTrip.tripNumber}` : 'Завершение рейса'}
        onOk={submitComplete} onCancel={() => setCompleteOpen(false)} okText="Завершить" cancelText="Отмена">
        <Form form={completeForm} layout="vertical">
          {completingTrip?.status === 'PLANNED' && (
            <Form.Item name="actualDeparture" label="Факт. отправление" rules={[{ required: true, message: 'Укажите время' }]}>
              <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="actualArrival" label="Факт. прибытие" rules={[{ required: true, message: 'Укажите время' }]}>
            <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualPallets" label="Факт. паллет" rules={[{ required: true, message: 'Укажите кол-во' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualWeightKg" label="Факт. вес (кг)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Text type="secondary">
            {completingTrip?.status === 'PLANNED'
              ? 'Будут зафиксированы отправление и приёмка, рейс перейдёт в «Завершён».'
              : 'Будет зафиксирована приёмка, рейс перейдёт в «Завершён».'}
            {' '}Стоимость распределится по лоткам.
          </Text>
        </Form>
      </Modal>
    </>
  );
}
