'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, Form, InputNumber, Select, DatePicker, Space, Popconfirm, Tag, message,
  Divider, Dropdown, Modal, Typography, Input,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, MoreOutlined,
  EyeOutlined, HolderOutlined,
} from '@ant-design/icons';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import dayjs from 'dayjs';
import { useRouter, useSearchParams } from 'next/navigation';
import DataTable from '@/components/DataTable';
import EntityForm from '@/components/EntityForm';
import FilterBar from '@/components/FilterBar';
import {
  CarrierSelect, VehicleTypeSelect,
} from '@/components/selects/EntitySelects';
import { VehicleSelectCreatable, DriverSelectCreatable } from '@/components/selects/CreatableSelects';
import {
  getTrips, getTrip, createTrip, updateTrip, deleteTrip, changeTripStatus,
  completeTripQuick, removeTripCargoUnit,
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
const opTypeOptions = [{ value: 'LOADING', label: 'Загрузка' }, { value: 'UNLOADING', label: 'Выгрузка' }];

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can, roles, isAdmin } = usePermissions();
  const canWrite = can('trips.write');
  const canStatus = canWrite || can('trips.status');
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

  // Автооткрытие редактирования из ?edit=id (переход с карточки рейса)
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || loading) return;
    const trip = data.find((t) => t.id === editId);
    if (trip) onEdit(trip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams]);

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
    try { await changeTripStatus(id, to as any); message.success('Статус изменён'); load(); }
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
      message.success('Сохранено'); setOpen(false);
      const returnId = searchParams.get('edit');
      if (returnId && editing) { router.push(`/operations/trips/${returnId}`); } else { load(); }
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
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
          <a href={`/operations/trips/${r.id}`} style={{ color: '#1677ff', padding: '4px', display: 'inline-flex', alignItems: 'center' }}><EyeOutlined /></a>
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
        searchableKeys={['tripNumber', 'carrier.name', 'origin.name', 'destination.name']}
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
