'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, Form, InputNumber, Select, DatePicker, Space, Popconfirm, Tag, message,
  Divider, Card, Dropdown, Modal, Typography, Descriptions, Table, Empty, Input,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, MoreOutlined, MinusCircleOutlined,
  EyeOutlined, LoginOutlined, LogoutOutlined, WarningOutlined, DollarOutlined, HolderOutlined,
} from '@ant-design/icons';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import EntityForm from '@/components/EntityForm';
import FilterBar from '@/components/FilterBar';
import {
  CarrierSelect, CustomerSelect, VehicleTypeSelect,
} from '@/components/selects/EntitySelects';
import { VehicleSelectCreatable, DriverSelectCreatable } from '@/components/selects/CreatableSelects';
import {
  getTrips, getTrip, createTrip, updateTrip, deleteTrip, changeTripStatus,
  recordDeparture, recordArrival, completeTripQuick,
  addTripCargoUnit, removeTripCargoUnit, addQualityEvent, calculateTripEconomics,
} from '@/lib/actions/trips';
import { usePermissions } from '@/hooks/usePermissions';
import AsyncSelect from '@/components/selects/AsyncSelect';
import { addCargoLegToTrip, getUnassignedCargoLegOptions, getCargoLegDates } from '@/lib/actions/requests';
import { getTripTemplates, getTripTemplate, createTripTemplate, updateTripTemplate, deleteTripTemplate } from '@/lib/actions/templates';

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
const opTypeOptions = [{ value: 'LOADING', label: 'Загрузка' }, { value: 'UNLOADING', label: 'Выгрузка' }];

const dt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—');
const money = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');
// Авторитетный тип ТС: по назначенному ТС (факт), иначе плановый vehicleTypeCode (черновик).
const effectiveVehicleType = (t: any) => t?.vehicle?.vehicleType?.name || t?.vehicleType?.name || '—';

// Drag-and-drop сортируемая строка маршрута
function SortableRouteRow({ id, children }: { id: string; children: (listeners: any) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
    >
      {children(listeners)}
    </div>
  );
}

export default function TripsPage() {
  const { can, roles, isAdmin } = usePermissions();
  const canWrite = can('trips.write');
  const canStatus = canWrite || can('trips.status');
  const canCargo = canWrite || can('cargo.write');
  const canQuality = canWrite || can('quality.write');
  const forcedTripType: 'OWN' | 'LAAS' | null = (() => {
    if (isAdmin || roles.includes('LOGISTICS_MANAGER')) return null;
    const laas = roles.includes('LAAS_MANAGER');
    const own = roles.includes('OWN_DISPATCHER');
    if (laas && !own) return 'LAAS';
    if (own && !laas) return 'OWN';
    return null;
  })();

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [existingCargo, setExistingCargo] = useState<any[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const toggleRemove = (id: string) => setRemoveIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

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
  const [attachForm] = Form.useForm();
  const [attachOpen, setAttachOpen] = useState(false);
  const [completeForm] = Form.useForm();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completingTrip, setCompletingTrip] = useState<any>(null);

  // шаблоны
  const [templates, setTemplates] = useState<any[]>([]);
  const [selTemplate, setSelTemplate] = useState<string | undefined>();
  const [tplForm] = Form.useForm();
  const [tplSaveOpen, setTplSaveOpen] = useState(false);

  const loadTemplates = async () => { setTemplates(await getTripTemplates()); };
  useEffect(() => { loadTemplates(); }, []); // eslint-disable-line

  const applyTemplate = async (id?: string) => {
    setSelTemplate(id);
    if (!id) return;
    const tpl = await getTripTemplate(id);
    const d: any = tpl?.data || {};
    form.setFieldsValue({ ...d, routeStops: [] });
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
    const data = { ...v, routeStops: [] };
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

  // dnd sensors
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleRouteDragEnd = (event: DragEndEvent, fields: any[], move: (from: number, to: number) => void) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = fields.findIndex(f => String(f.key) === String(active.id));
      const newIdx = fields.findIndex(f => String(f.key) === String(over.id));
      if (oldIdx !== -1 && newIdx !== -1) move(oldIdx, newIdx);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (fStatus) filters.status = fStatus;
      if (fType) filters.tripType = fType;
      if (fRange?.[0]) filters.dateFrom = fRange[0].startOf('day').toISOString();
      if (fRange?.[1]) filters.dateTo = fRange[1].endOf('day').toISOString();
      setData(await getTrips(filters));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fStatus, fType, fRange]);

  const refreshView = async (id: string) => { setViewTrip(await getTrip(id)); };

  const onAdd = () => {
    setEditing(null);
    setExistingCargo([]); setRemoveIds([]);
    setSelTemplate(undefined);
    form.resetFields();
    form.setFieldsValue({ tripType: forcedTripType || 'OWN', routeStops: [] });
    setOpen(true);
  };

  const onEdit = async (r: any) => {
    const full = await getTrip(r.id);
    setEditing(full ?? r);
    setExistingCargo(full?.cargoUnits ?? []); setRemoveIds([]);
    setSelTemplate(undefined);
    form.setFieldsValue({ ...(full ?? r), routeStops: [] });
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
    const { routeStops = [], ...header } = v;
    const attachCargoIds = (routeStops as any[]).map((s: any) => s.cargoId).filter(Boolean);
    try {
      let tripId = editing?.id;
      if (editing) {
        await updateTrip(editing.id, header);
        for (const rid of removeIds) await removeTripCargoUnit(rid, editing.id);
      } else {
        const trip = await createTrip(header);
        tripId = (trip as any)?.id;
      }
      for (const aid of attachCargoIds) if (tripId) await addCargoLegToTrip(aid, tripId);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const openView = async (r: any) => { setViewTrip(await getTrip(r.id)); setViewOpen(true); };

  const openDeparture = () => { depForm.resetFields(); depForm.setFieldsValue({ actualDeparture: dayjs() }); setDepOpen(true); };
  const submitDeparture = async () => {
    const v = await depForm.validateFields();
    try {
      await recordDeparture(viewTrip.id, { actualDeparture: v.actualDeparture.toISOString() });
      message.success('Отправление зафиксировано'); setDepOpen(false); load(); refreshView(viewTrip.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

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

  const openQuality = () => { qForm.resetFields(); qForm.setFieldsValue({ severity: 'MINOR', eventTime: dayjs() }); setQOpen(true); };
  const submitQuality = async () => {
    const v = await qForm.validateFields();
    try {
      await addQualityEvent(viewTrip.id, { ...v, eventTime: v.eventTime ? v.eventTime.toISOString() : null });
      message.success('Инцидент зарегистрирован'); setQOpen(false); refreshView(viewTrip.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

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

  const sortedByPickup = (units: any[]) =>
    [...units].filter(c => c.requestCargoLeg?.plannedPickup)
      .sort((a, b) => new Date(a.requestCargoLeg.plannedPickup).getTime() - new Date(b.requestCargoLeg.plannedPickup).getTime());
  const sortedByDropoff = (units: any[]) =>
    [...units].filter(c => c.requestCargoLeg?.plannedDropoff)
      .sort((a, b) => new Date(b.requestCargoLeg.plannedDropoff).getTime() - new Date(a.requestCargoLeg.plannedDropoff).getTime());

  const columns = [
    { title: '№ рейса', dataIndex: 'tripNumber', key: 'tripNumber', width: 160 },
    { title: 'Тип', dataIndex: 'tripType', key: 'tripType', width: 80, render: (t: string) => <Tag>{tripTypeOptions.find((o) => o.value === t)?.label?.split(' ')[0]}</Tag> },
    {
      title: 'Маршрут', key: 'route',
      render: (_: any, r: any) => {
        const first = sortedByPickup(r.cargoUnits || [])[0];
        const last  = sortedByDropoff(r.cargoUnits || [])[0];
        const from = first?.requestCargoLeg?.pickupLocation?.name || '—';
        const to   = last?.requestCargoLeg?.dropoffLocation?.name || '—';
        return `${from} → ${to}`;
      },
    },
    {
      title: 'Дата начала', key: 'dateStart', width: 120,
      render: (_: any, r: any) => {
        const first = sortedByPickup(r.cargoUnits || [])[0];
        return first?.requestCargoLeg?.plannedPickup ? dayjs(first.requestCargoLeg.plannedPickup).format('DD.MM HH:mm') : '—';
      },
    },
    {
      title: 'Дата конца', key: 'dateEnd', width: 120,
      render: (_: any, r: any) => {
        const last = sortedByDropoff(r.cargoUnits || [])[0];
        return last?.requestCargoLeg?.plannedDropoff ? dayjs(last.requestCargoLeg.plannedDropoff).format('DD.MM HH:mm') : '—';
      },
    },
    { title: 'Статус', dataIndex: 'status', key: 'status', width: 120, render: (s: string) => <Tag color={statusCfg[s]?.color}>{statusCfg[s]?.label || s}</Tag> },
    { title: 'Перевозчик', key: 'carrier', render: (_: any, r: any) => r.carrier?.name || '—', responsive: ['lg'] as any },
    { title: 'ТС', key: 'vehicle', render: (_: any, r: any) => r.vehicle?.plateNumber || '—', responsive: ['lg'] as any },
    { title: 'Водитель', key: 'driver', render: (_: any, r: any) => r.driver?.fullName || '—', responsive: ['lg'] as any },
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
    { title: '#', key: 'idx', width: 40, render: (_: any, __: any, i: number) => i + 1 },
    { title: 'Заказчик', key: 'cust', render: (_: any, c: any) => c.customer?.name || '—' },
    { title: 'Откуда (загрузка)', key: 'from', render: (_: any, c: any) => c.requestCargoLeg?.pickupLocation?.name || '—' },
    { title: 'Куда (выгрузка)', key: 'to', render: (_: any, c: any) => c.requestCargoLeg?.dropoffLocation?.name || '—' },
    { title: 'Пал.', dataIndex: 'pallets', key: 'p', width: 55, render: (v: any) => v ?? '—' },
    { title: 'Дата загрузки', key: 'pd', render: (_: any, c: any) => dt(c.requestCargoLeg?.plannedPickup) },
    { title: 'Дата выгрузки', key: 'dd', render: (_: any, c: any) => dt(c.requestCargoLeg?.plannedDropoff) },
    { title: 'Аллок.', dataIndex: 'allocatedCost', key: 'ac', render: money },
    {
      title: '', key: 'x', width: 40,
      render: (_: any, c: any) => canCargo ? (
        <Popconfirm title="Убрать груз?" onConfirm={() => removeCargo(c.id)}>
          <Button type="link" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ) : null,
    },
  ];

  const onCargoSelect = async (legId: any, rowName: number) => {
    if (!legId) return;
    const dates = await getCargoLegDates(legId);
    if (dates) {
      form.setFieldValue(['routeStops', rowName, 'loadDate'], dates.plannedPickup ? dayjs(dates.plannedPickup) : null);
      form.setFieldValue(['routeStops', rowName, 'unloadDate'], dates.plannedDropoff ? dayjs(dates.plannedDropoff) : null);
    }
  };

  // Заголовок таблицы маршрута
  const routeTableHeader = (
    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 150px 150px 32px', gap: 8, padding: '0 0 6px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 6, fontWeight: 600, fontSize: 12, color: '#666' }}>
      <div />
      <div>Груз</div>
      <div>Тип</div>
      <div>Дата загрузки</div>
      <div>Дата выгрузки</div>
      <div />
    </div>
  );

  return (
    <>
      <FilterBar onReset={() => { setFStatus(undefined); setFType(undefined); setFRange(null); }}>
        <Select placeholder="Статус" allowClear style={{ width: 160 }} value={fStatus} onChange={setFStatus}
          options={Object.entries(statusCfg).map(([v, c]) => ({ value: v, label: c.label }))} />
        <Select placeholder="Тип рейса" allowClear style={{ width: 180 }} value={fType} onChange={setFType} options={tripTypeOptions} />
        <DatePicker.RangePicker value={fRange} onChange={setFRange} format="DD.MM.YYYY" />
      </FilterBar>

      <DataTable title="Рейсы" data={data} columns={columns} loading={loading} scrollX={1100}
        searchableKeys={['tripNumber']}
        toolbar={canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Создать рейс</Button> : undefined} />

      {/* ===== Создание / редактирование ===== */}
      <EntityForm open={open} title={editing ? `Рейс ${editing.tripNumber}` : 'Новый рейс'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} width={1100} isEditing={!!editing}>

        {!editing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 16 }}>
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
        )}
        <Divider titlePlacement="left">Шапка</Divider>
        <Space wrap size="large">
          <Form.Item name="tripType" label="Тип рейса" rules={[{ required: true, message: 'Укажите тип' }]}>
            <Select options={tripTypeOptions} style={{ width: 200 }} disabled={!!forcedTripType} />
          </Form.Item>
          <Form.Item name="carrierId" label="Перевозчик"><CarrierSelect style={{ width: 220 }} /></Form.Item>
          <Form.Item name="vehicleId" label="ТС"><VehicleSelectCreatable style={{ width: 220 }} /></Form.Item>
          <Form.Item name="driverId" label="Водитель"><DriverSelectCreatable style={{ width: 220 }} /></Form.Item>
          <Form.Item name="vehicleTypeCode" label="Тип ТС"><VehicleTypeSelect style={{ width: 180 }} /></Form.Item>
        </Space>

        <Divider titlePlacement="left">Маршрут</Divider>
        {routeTableHeader}

        {/* Существующие грузы (режим редактирования) */}
        {editing && existingCargo.map((c: any) => {
          const removed = removeIds.includes(c.id);
          return (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 150px 150px 32px', gap: 8, alignItems: 'center', marginBottom: 4, opacity: removed ? 0.4 : 1, background: '#fafafa', padding: '4px 0', borderRadius: 4 }}>
              <HolderOutlined style={{ color: '#ccc', justifySelf: 'center' }} />
              <span style={{ textDecoration: removed ? 'line-through' : 'none', fontSize: 13 }}>
                {c.customer?.name || '—'} · {c.pallets ?? '—'} пал
                {c.requestId && <Tag color="purple" style={{ marginLeft: 6, fontSize: 11 }}>из заявки</Tag>}
              </span>
              <span style={{ color: '#999', fontSize: 12 }}>—</span>
              <span style={{ color: '#999', fontSize: 12 }}>—</span>
              <span style={{ color: '#999', fontSize: 12 }}>—</span>
              <Button size="small" type="link" danger={!removed} onClick={() => toggleRemove(c.id)} style={{ padding: 0 }}>
                {removed ? '↩' : <DeleteOutlined />}
              </Button>
            </div>
          );
        })}

        {/* Новые строки маршрута с drag-and-drop */}
        <Form.List name="routeStops">
          {(fields, { add, remove, move }) => (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleRouteDragEnd(e, fields, move)}
              >
                <SortableContext items={fields.map(f => f.key.toString())} strategy={verticalListSortingStrategy}>
                  {fields.map(({ key, name, ...rest }) => (
                    <SortableRouteRow key={key} id={key.toString()}>
                      {(listeners) => (
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 150px 150px 32px', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <Button icon={<HolderOutlined />} type="text" size="small" {...listeners} style={{ cursor: 'grab', padding: 0, width: 28 }} />
                          <Form.Item {...rest} name={[name, 'cargoId']} style={{ marginBottom: 0 }}>
                            <AsyncSelect
                              fetchOptions={getUnassignedCargoLegOptions}
                              placeholder="Груз из заявки"
                              style={{ width: '100%' }}
                              onChange={(val: any) => onCargoSelect(val, name)}
                            />
                          </Form.Item>
                          <Form.Item {...rest} name={[name, 'opType']} initialValue="LOADING" style={{ marginBottom: 0 }}>
                            <Select options={opTypeOptions} style={{ width: '100%' }} />
                          </Form.Item>
                          <Form.Item {...rest} name={[name, 'loadDate']} style={{ marginBottom: 0 }}>
                            <DatePicker format="DD.MM.YYYY HH:mm" showTime={{ format: 'HH:mm' }} style={{ width: '100%' }} />
                          </Form.Item>
                          <Form.Item {...rest} name={[name, 'unloadDate']} style={{ marginBottom: 0 }}>
                            <DatePicker format="DD.MM.YYYY HH:mm" showTime={{ format: 'HH:mm' }} style={{ width: '100%' }} />
                          </Form.Item>
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(name)} style={{ padding: 0, width: 32 }} />
                        </div>
                      )}
                    </SortableRouteRow>
                  ))}
                </SortableContext>
              </DndContext>
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ opType: 'LOADING' })} style={{ marginTop: 4 }}>
                Добавить груз
              </Button>
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
              <Descriptions.Item label="Перевозчик">{viewTrip.carrier?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="ТС">{viewTrip.vehicle?.plateNumber || '—'}</Descriptions.Item>
              <Descriptions.Item label="Водитель">{viewTrip.driver?.fullName || '—'}</Descriptions.Item>
              <Descriptions.Item label="Тип ТС">{effectiveVehicleType(viewTrip)}</Descriptions.Item>
              <Descriptions.Item label="Факт. стоимость">{money(viewTrip.actualCost)}</Descriptions.Item>
              <Descriptions.Item label="Откуда → Куда" span={2}>{(viewTrip.origin?.name || '—') + ' → ' + (viewTrip.destination?.name || '—')}</Descriptions.Item>
              <Descriptions.Item label="Выезд план / факт">{dt(viewTrip.plannedDeparture)} / {dt(viewTrip.actualDeparture)}</Descriptions.Item>
              <Descriptions.Item label="Прибытие план / факт">{dt(viewTrip.plannedArrival)} / {dt(viewTrip.actualArrival)}</Descriptions.Item>
              {viewTrip.notes && <Descriptions.Item label="Примечания" span={2}>{viewTrip.notes}</Descriptions.Item>}
            </Descriptions>

            <Divider titlePlacement="left">Грузы</Divider>
            {canCargo && (
              <Space style={{ marginBottom: 8 }} wrap>
                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={openCargo}>Добавить груз</Button>
                <Button size="small" onClick={openAttach}>Привязать из заявки</Button>
              </Space>
            )}
            <Table size="small" rowKey="id" pagination={false}
              dataSource={[...(viewTrip.cargoUnits || [])].sort((a: any, b: any) =>
                (a.requestCargoLeg?.legOrder ?? 99) - (b.requestCargoLeg?.legOrder ?? 99)
              )}
              columns={cargoColumns}
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
          <Form.Item name="unitType" label="Тип единицы" rules={[{ required: true }]}><Select options={unitTypeOptions} /></Form.Item>
          <Space wrap>
            <Form.Item name="pallets" label="Паллет"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="traysCount" label="Лотков"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
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
        </Form>
      </Modal>

      {/* ===== Сохранение шаблона ===== */}
      <Modal open={tplSaveOpen} title="Сохранить шаблон рейса" onOk={submitSaveTemplate} onCancel={() => setTplSaveOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={tplForm} layout="vertical">
          <Form.Item name="name" label="Название шаблона" rules={[{ required: true, message: 'Введите название' }]}>
            <Input placeholder="Напр. Колпино → Москва, реф" />
          </Form.Item>
          <Text type="secondary">Если название совпадает с существующим — он будет обновлён. Грузы (строки маршрута) в шаблон не сохраняются.</Text>
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
        </Form>
      </Modal>
    </>
  );
}
