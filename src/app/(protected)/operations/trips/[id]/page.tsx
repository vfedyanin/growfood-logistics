'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Button, Form, InputNumber, Select, Space, Popconfirm, Tag, message,
  Divider, Modal, Typography, Descriptions, Table, Empty, Input, DatePicker, Spin, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, LoginOutlined, LogoutOutlined, WarningOutlined,
  DollarOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  DownOutlined, RightOutlined, ArrowDownOutlined, ArrowUpOutlined, SwapRightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useParams, useRouter } from 'next/navigation';
import {
  getTrip, changeTripStatus, recordDeparture, recordArrival,
  addTripCargoUnit, removeTripCargoUnit, addQualityEvent, calculateTripEconomics, completeTripQuick,
} from '@/lib/actions/trips';
import { addCargoLegToTrip, getUnassignedCargoLegOptions } from '@/lib/actions/requests';
import { usePermissions } from '@/hooks/usePermissions';
import AsyncSelect from '@/components/selects/AsyncSelect';
import { CustomerSelect } from '@/components/selects/EntitySelects';

const { Text, Title } = Typography;

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
const unitTypeOptions = [
  { value: 'PALLET', label: 'Паллета' },
  { value: 'BOX', label: 'Короб' },
  { value: 'CARTON', label: 'Коробка' },
];
const productCatOptions = [
  { value: 'READY_FOOD', label: 'Готовая еда' }, { value: 'RAW', label: 'Сырьё' },
  { value: 'EQUIPMENT', label: 'Оборудование' }, { value: 'CONFECTIONERY', label: 'Кондитерка' },
  { value: 'OTHER', label: 'Прочее' },
];
const tempRegimeOptions = [
  { value: 'FROZEN', label: 'Заморозка' },
  { value: 'COOLED', label: 'Охлаждение' },
  { value: 'AMBIENT', label: 'Без режима' },
];
const eventTypeOptions = [
  { value: 'LATE_DEPARTURE', label: 'Поздний выезд' }, { value: 'LATE_ARRIVAL', label: 'Опоздание' },
  { value: 'TEMP_VIOLATION', label: 'Нарушение температуры' }, { value: 'CARGO_DAMAGE', label: 'Повреждение груза' },
  { value: 'ROUTE_DEVIATION', label: 'Отклонение от маршрута' }, { value: 'VEHICLE_BREAKDOWN', label: 'Поломка ТС' },
  { value: 'DOCUMENTATION_ISSUE', label: 'Проблема с документами' },
];
const severityOptions = [
  { value: 'MINOR', label: 'Незначительная' },
  { value: 'MAJOR', label: 'Серьёзная' },
  { value: 'CRITICAL', label: 'Критическая' },
];

const dt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—');
const dtShort = (d: any) => (d ? dayjs(d).format('DD.MM HH:mm') : null);
const money = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');
const effectiveVehicleType = (t: any) => t?.vehicle?.vehicleType?.name || t?.vehicleType?.name || '—';

// ─────────── helpers для stops-view ───────────

interface Stop {
  id: string;
  loc: any;
  sortKey: number;
  load: any[];   // cargoUnits, у которых pickupLocation = эта точка
  unload: any[]; // cargoUnits, у которых dropoffLocation = эта точка
}

function buildStops(units: any[]): Stop[] {
  const map = new Map<string, Stop>();
  units.forEach(u => {
    const leg = u.requestCargoLeg;
    if (!leg) return;
    const pt = leg.plannedPickup ? +new Date(leg.plannedPickup) : (leg.legOrder ?? 0) * 1e9;
    const dt2 = leg.plannedDropoff ? +new Date(leg.plannedDropoff) : pt + 1;
    if (leg.pickupLocationId && leg.pickupLocation) {
      if (!map.has(leg.pickupLocationId)) map.set(leg.pickupLocationId, { id: leg.pickupLocationId, loc: leg.pickupLocation, sortKey: pt, load: [], unload: [] });
      const s = map.get(leg.pickupLocationId)!;
      if (pt < s.sortKey) s.sortKey = pt;
      s.load.push(u);
    }
    if (leg.dropoffLocationId && leg.dropoffLocation) {
      if (!map.has(leg.dropoffLocationId)) map.set(leg.dropoffLocationId, { id: leg.dropoffLocationId, loc: leg.dropoffLocation, sortKey: dt2, load: [], unload: [] });
      const s = map.get(leg.dropoffLocationId)!;
      if (dt2 < s.sortKey) s.sortKey = dt2;
      s.unload.push(u);
    }
  });
  return Array.from(map.values()).sort((a, b) => a.sortKey - b.sortKey);
}

// Груз, который ЕДЕТ В МАШИНЕ после точки с индексом fromIdx (т.е. погружен ≤ fromIdx, выгружается > fromIdx)
function transitAfter(stops: Stop[], fromIdx: number): any[] {
  const stopIds = stops.map(s => s.id);
  const units = new Set<any>();
  stops.forEach(s => { s.load.forEach(u => units.add(u)); s.unload.forEach(u => units.add(u)); });
  return Array.from(units).filter(u => {
    const leg = u.requestCargoLeg;
    if (!leg) return false;
    const pi = stopIds.indexOf(leg.pickupLocationId);
    const di = stopIds.indexOf(leg.dropoffLocationId);
    return pi <= fromIdx && di > fromIdx;
  });
}

function pallets(units: any[]) {
  return units.reduce((s: number, u: any) => s + (Number(u.pallets) || 0), 0);
}

function calcMaxPallets(cargoUnits: any[]): number {
  const withLeg = cargoUnits.filter(u => u.requestCargoLeg);
  if (!withLeg.length) return pallets(cargoUnits); // нет плеч — считаем просто сумму
  const stops = buildStops(withLeg);
  if (stops.length === 0) return 0;
  if (stops.length === 1) return pallets(withLeg); // одна точка — всё грузится/выгружается там
  let max = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const total = pallets(transitAfter(stops, i));
    if (total > max) max = total;
  }
  return max;
}

function parseVtCapacity(vtName: string): number | null {
  const m = vtName?.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function CargoList({ units, finalDestMap, canRemove, onRemove }: {
  units: any[];
  finalDestMap: Map<string, string>;
  canRemove: boolean;
  onRemove: (id: string) => void;
}) {
  if (!units.length) return <span style={{ color: '#bbb', fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {units.map(u => {
        // Конечная точка заявки: deliveryLocation если заполнен, иначе — последнее плечо по legOrder
        // Приоритет: deliveryLocation заявки → consigneeLocation груза → последний leg в рейсе
        const dest = u.request?.deliveryLocation?.name
          || u.requestCargoLeg?.cargo?.consigneeLocation?.name
          || (u.requestId ? finalDestMap.get(u.requestId) : null);
        return (
          <div key={u.id} style={{ background: '#fafafa', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}>
            {/* Строка 1: паллеты + ссылка + удаление */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tag style={{ margin: 0, flexShrink: 0 }}>{u.pallets ?? '?'} пал</Tag>
              {u.requestId && (
                <a href={`/requests/${u.requestId}`} style={{ fontSize: 11, fontFamily: 'monospace', flexShrink: 0 }}>
                  {u.request?.requestNumber?.slice(-6) || ''}
                </a>
              )}
              {canRemove && (
                <Popconfirm title="Убрать из рейса?" onConfirm={() => onRemove(u.id)}>
                  <Button type="link" danger size="small" icon={<DeleteOutlined />} style={{ padding: 0, marginLeft: 'auto' }} />
                </Popconfirm>
              )}
            </div>
            {/* Строка 2: клиент (назначение) */}
            <div style={{ fontWeight: 500, color: '#262626', lineHeight: 1.4, marginTop: 2 }}>
              {u.customer?.name || '—'}
              {dest && (
                <span style={{ fontWeight: 400, color: '#8c8c8c', marginLeft: 4 }}>({dest})</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StopCard({ stop, isFirst, isLast, finalDestMap, canRemove, onRemove }: { stop: Stop; isFirst: boolean; isLast: boolean; finalDestMap: Map<string, string>; canRemove: boolean; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const pickupTime = stop.load[0]?.requestCargoLeg?.plannedPickup;
  const dropoffTime = stop.unload[0]?.requestCargoLeg?.plannedDropoff;
  const time = isFirst ? pickupTime : dropoffTime;

  const dotColor = isFirst ? '#52c41a' : isLast ? '#ff4d4f' : '#1677ff';

  return (
    <div style={{ display: 'flex', gap: 0 }}>
      {/* Левая колонка: dot + вертикальная линия */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0 }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: dotColor, border: '2px solid #fff', boxShadow: `0 0 0 2px ${dotColor}`, flexShrink: 0, marginTop: 12 }} />
        {!isLast && <div style={{ width: 2, flex: 1, background: '#e8e8e8', minHeight: 16 }} />}
      </div>

      {/* Карточка точки */}
      <div style={{ flex: 1, marginLeft: 12, marginBottom: isLast ? 0 : 4, paddingBottom: isLast ? 0 : 8 }}>
        <div
          onClick={() => setOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0', userSelect: 'none' }}
        >
          {open ? <DownOutlined style={{ fontSize: 10, color: '#999' }} /> : <RightOutlined style={{ fontSize: 10, color: '#999' }} />}
          <span style={{ fontWeight: 600, fontSize: 14 }}>{stop.loc?.name || stop.id}</span>
          {time && <span style={{ color: '#999', fontSize: 12 }}>{dtShort(time)}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {stop.unload.length > 0 && (
              <Tag color="orange" style={{ margin: 0 }}>
                <ArrowDownOutlined style={{ fontSize: 10 }} /> {pallets(stop.unload)} пал
              </Tag>
            )}
            {stop.load.length > 0 && (
              <Tag color="green" style={{ margin: 0 }}>
                <ArrowUpOutlined style={{ fontSize: 10 }} /> {pallets(stop.load)} пал
              </Tag>
            )}
          </div>
        </div>

        {open && (
          <div style={{ display: 'grid', gridTemplateColumns: stop.load.length && stop.unload.length ? '1fr 1fr' : '1fr', gap: 12, background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6, padding: '10px 12px', marginBottom: 4 }}>
            {stop.unload.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#fa8c16', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <ArrowDownOutlined /> Выгрузка
                </div>
                <CargoList units={stop.unload} finalDestMap={finalDestMap} canRemove={canRemove} onRemove={onRemove} />
              </div>
            )}
            {stop.load.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#52c41a', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <ArrowUpOutlined /> Погрузка
                </div>
                <CargoList units={stop.load} finalDestMap={finalDestMap} canRemove={canRemove} onRemove={onRemove} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TransitRow({ units }: { units: any[] }) {
  if (!units.length) return null;
  const total = pallets(units);
  return (
    <div style={{ display: 'flex', gap: 0 }}>
      <div style={{ width: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 2, flex: 1, background: '#e8e8e8' }} />
      </div>
      <div style={{ marginLeft: 12, padding: '2px 0 4px' }}>
        <Tooltip title={units.map((u: any) => `${u.customer?.name || '?'}: ${u.pallets ?? '?'} пал → ${u.requestCargoLeg?.dropoffLocation?.name || '?'}`).join('\n')}>
          <span style={{ fontSize: 12, color: '#8c8c8c', background: '#f5f5f5', borderRadius: 10, padding: '2px 10px', border: '1px dashed #d9d9d9', cursor: 'default' }}>
            <SwapRightOutlined style={{ marginRight: 4 }} />
            В машине транзитом: {total} пал
            {units.length <= 3 && (
              <span style={{ marginLeft: 4 }}>
                ({units.map((u: any) => `${u.customer?.name || '?'}`).join(', ')})
              </span>
            )}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

function TripStopsView({ cargoUnits, canRemove, onRemove }: { cargoUnits: any[]; canRemove: boolean; onRemove: (id: string) => void }) {
  const withLeg = cargoUnits.filter(u => u.requestCargoLeg);
  const noLeg = cargoUnits.filter(u => !u.requestCargoLeg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stops = useMemo(() => buildStops(withLeg), [cargoUnits]);

  // Для каждого requestId — конечная точка (последнее плечо по sortKey)
  const finalDestMap = useMemo(() => {
    const map = new Map<string, string>();
    const keyMap = new Map<string, number>();
    withLeg.forEach(u => {
      if (!u.requestId || !u.requestCargoLeg?.dropoffLocation) return;
      const k = u.requestCargoLeg.plannedDropoff
        ? +new Date(u.requestCargoLeg.plannedDropoff)
        : (u.requestCargoLeg.legOrder ?? 0) * 1e9;
      if (!keyMap.has(u.requestId) || k > keyMap.get(u.requestId)!) {
        keyMap.set(u.requestId, k);
        map.set(u.requestId, u.requestCargoLeg.dropoffLocation.name);
      }
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargoUnits]);

  if (!withLeg.length && !noLeg.length) {
    return <Empty description="Нет грузов" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div>
      {stops.map((stop, idx) => (
        <React.Fragment key={stop.id}>
          <StopCard
            stop={stop}
            isFirst={idx === 0}
            isLast={idx === stops.length - 1}
            finalDestMap={finalDestMap}
            canRemove={canRemove}
            onRemove={onRemove}
          />
          {idx < stops.length - 1 && (
            <TransitRow units={transitAfter(stops, idx)} />
          )}
        </React.Fragment>
      ))}

      {noLeg.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Divider orientation={"left" as any} plain style={{ fontSize: 12, color: '#999' }}>Груз без плеча</Divider>
          <CargoList units={noLeg} finalDestMap={finalDestMap} canRemove={canRemove} onRemove={onRemove} />
        </div>
      )}
    </div>
  );
}

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const canWrite = can('trips.write');
  const canStatus = canWrite || can('trips.status');
  const canCargo = canWrite || can('cargo.write');
  const canQuality = canWrite || can('quality.write');

  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  const maxPallets = useMemo(() => calcMaxPallets(trip?.cargoUnits || []), [trip]);
  const vtCapacity = parseVtCapacity(effectiveVehicleType(trip));
  const overCapacity = vtCapacity !== null && maxPallets > vtCapacity;

  const refresh = async () => {
    try {
      const t = await getTrip(id);
      setTrip(t);
    } catch (e: any) {
      message.error(`Ошибка загрузки рейса: ${e?.message || e}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [id]); // eslint-disable-line

  const onStatus = async (to: string) => {
    try { await changeTripStatus(id, to as any); message.success('Статус изменён'); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // Отправление
  const openDeparture = () => { depForm.resetFields(); depForm.setFieldsValue({ actualDeparture: dayjs() }); setDepOpen(true); };
  const submitDeparture = async () => {
    const v = await depForm.validateFields();
    try {
      await recordDeparture(id, { actualDeparture: v.actualDeparture.toISOString() });
      message.success('Отправление зафиксировано'); setDepOpen(false); refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // Приёмка
  const openArrival = () => { arrForm.resetFields(); arrForm.setFieldsValue({ actualArrival: dayjs() }); setArrOpen(true); };
  const submitArrival = async () => {
    const v = await arrForm.validateFields();
    try {
      await recordArrival(id, {
        actualArrival: v.actualArrival.toISOString(),
        actualPallets: v.actualPallets,
        actualWeightKg: v.actualWeightKg ?? undefined,
        discrepancyNote: v.discrepancyNote || undefined,
      });
      message.success('Приёмка зафиксирована'); setArrOpen(false); refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // Завершение
  const openComplete = () => {
    completeForm.resetFields();
    completeForm.setFieldsValue({
      actualDeparture: trip.actualDeparture ? dayjs(trip.actualDeparture) : dayjs(),
      actualArrival: dayjs(),
      actualPallets: trip.actualPallets ?? trip.plannedPallets ?? undefined,
    });
    setCompleteOpen(true);
  };
  const submitComplete = async () => {
    const v = await completeForm.validateFields();
    try {
      await completeTripQuick(id, {
        actualDeparture: v.actualDeparture ? v.actualDeparture.toISOString() : undefined,
        actualArrival: v.actualArrival.toISOString(),
        actualPallets: v.actualPallets,
        actualWeightKg: v.actualWeightKg ?? undefined,
      });
      message.success('Рейс завершён'); setCompleteOpen(false); refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // Инцидент
  const openQuality = () => { qForm.resetFields(); qForm.setFieldsValue({ severity: 'MINOR', eventTime: dayjs() }); setQOpen(true); };
  const submitQuality = async () => {
    const v = await qForm.validateFields();
    try {
      await addQualityEvent(id, { ...v, eventTime: v.eventTime ? v.eventTime.toISOString() : null });
      message.success('Инцидент зарегистрирован'); setQOpen(false); refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // Груз
  const openCargo = () => { cargoForm.resetFields(); cargoForm.setFieldsValue({ unitType: 'PALLET' }); setCargoOpen(true); };
  const submitCargo = async () => {
    const v = await cargoForm.validateFields();
    try {
      await addTripCargoUnit(id, v);
      message.success('Груз добавлен'); setCargoOpen(false); refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const removeCargo = async (unitId: string) => {
    try { await removeTripCargoUnit(unitId, id); message.success('Удалено'); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // Привязка из заявки
  const openAttach = () => { attachForm.resetFields(); setAttachOpen(true); };
  const submitAttach = async () => {
    const v = await attachForm.validateFields();
    try { await addCargoLegToTrip(v.cargoId, id); message.success('Груз привязан'); setAttachOpen(false); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  // Экономика
  const onCalcEconomics = async () => {
    try { const r = await calculateTripEconomics(id); message.success(`Себестоимость (${r.basis}): ${money(r.cost)}`); refresh(); }
    catch (e: any) { message.error(e?.message || 'Ошибка расчёта'); }
  };

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!trip) return <div style={{ padding: 24 }}><Text type="danger">Рейс не найден</Text></div>;

  return (
    <>
      {/* Шапка страницы */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/operations/trips')}>
          Рейсы
        </Button>
        <Title level={4} style={{ margin: 0 }}>Рейс {trip.tripNumber}</Title>
        <Tag color={statusCfg[trip.status]?.color}>{statusCfg[trip.status]?.label}</Tag>
      </div>

      {/* Кнопки действий */}
      <Space wrap style={{ marginBottom: 16 }}>
        {canStatus && trip.status === 'DRAFT' && (
          <Button onClick={() => onStatus('PLANNED')}>В «Запланирован»</Button>
        )}
        {canStatus && trip.status === 'PLANNED' && (
          <Button type="primary" icon={<LoginOutlined />} onClick={openDeparture}>
            Зафиксировать отправление
          </Button>
        )}
        {canStatus && trip.status === 'IN_TRANSIT' && (
          <Button type="primary" icon={<LogoutOutlined />} onClick={openArrival}>
            Зафиксировать приёмку
          </Button>
        )}
        {canStatus && (trip.status === 'PLANNED' || trip.status === 'IN_TRANSIT') && (
          <Button onClick={openComplete}>Завершить…</Button>
        )}
        {canStatus && trip.status !== 'COMPLETED' && trip.status !== 'CANCELLED' && (
          <Popconfirm title="Отменить рейс?" onConfirm={() => onStatus('CANCELLED')}>
            <Button danger>Отменить</Button>
          </Popconfirm>
        )}
        {canQuality && (
          <Button icon={<WarningOutlined />} onClick={openQuality}>
            Зарегистрировать инцидент
          </Button>
        )}
        {canWrite && (
          <Button icon={<DollarOutlined />} onClick={onCalcEconomics}>
            Рассчитать экономику
          </Button>
        )}
        {canWrite && (
          <Button icon={<EditOutlined />} onClick={() => router.push(`/operations/trips?edit=${id}`)}>
            Редактировать
          </Button>
        )}
      </Space>

      {/* Основные данные */}
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 24 }}>
        <Descriptions.Item label="Тип">
          {tripTypeOptions.find((o) => o.value === trip.tripType)?.label}
        </Descriptions.Item>
        <Descriptions.Item label="Перевозчик">{trip.carrier?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="ТС">{trip.vehicle?.plateNumber || '—'}</Descriptions.Item>
        <Descriptions.Item label="Водитель">{trip.driver?.fullName || '—'}</Descriptions.Item>
        <Descriptions.Item label="Тип ТС">{effectiveVehicleType(trip)}</Descriptions.Item>
        <Descriptions.Item label="Макс. в машине">
          {maxPallets > 0 ? (
            <span style={{ color: overCapacity ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>
              {maxPallets} пал
              {overCapacity && (
                <span style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                  <WarningOutlined style={{ marginRight: 3 }} />
                  превышает {vtCapacity} пал
                </span>
              )}
            </span>
          ) : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Факт. стоимость">{money(trip.actualCost)}</Descriptions.Item>
        <Descriptions.Item label="Откуда → Куда" span={2}>
          {(trip.origin?.name || '—') + ' → ' + (trip.destination?.name || '—')}
        </Descriptions.Item>
        <Descriptions.Item label="Выезд план / факт">
          {dt(trip.plannedDeparture)} / {dt(trip.actualDeparture)}
        </Descriptions.Item>
        <Descriptions.Item label="Прибытие план / факт">
          {dt(trip.plannedArrival)} / {dt(trip.actualArrival)}
        </Descriptions.Item>
        {trip.notes && (
          <Descriptions.Item label="Примечания" span={2}>{trip.notes}</Descriptions.Item>
        )}
      </Descriptions>

      {/* Маршрут и грузы */}
      <Divider orientation={"left" as any}>Маршрут</Divider>
      {canCargo && (
        <Space style={{ marginBottom: 12 }} wrap>
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={openCargo}>
            Добавить груз
          </Button>
          <Button size="small" onClick={openAttach}>Привязать из заявки</Button>
        </Space>
      )}
      <TripStopsView
        cargoUnits={trip.cargoUnits || []}
        canRemove={canCargo}
        onRemove={removeCargo}
      />

      {/* События качества */}
      <Divider orientation={"left" as any}>События качества</Divider>
      {trip.qualityEvents?.length ? (
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={trip.qualityEvents}
          columns={[
            { title: 'Тип', dataIndex: 'eventType', render: (t: string) => eventTypeOptions.find((o) => o.value === t)?.label || t },
            {
              title: 'Тяжесть', dataIndex: 'severity',
              render: (s: string) => (
                <Tag color={s === 'CRITICAL' ? 'red' : s === 'MAJOR' ? 'orange' : 'default'}>
                  {severityOptions.find((o) => o.value === s)?.label}
                </Tag>
              ),
            },
            { title: 'Время', dataIndex: 'eventTime', render: dt },
            { title: 'Задержка, мин', dataIndex: 'delayMinutes', render: (v: any) => v ?? '—' },
            { title: 'Описание', dataIndex: 'description', render: (v: string) => v || '—' },
          ]}
        />
      ) : (
        <Text type="secondary">Инцидентов нет</Text>
      )}

      {/* ===== Модалки действий ===== */}
      <Modal open={depOpen} title="Фиксация отправления" onOk={submitDeparture} onCancel={() => setDepOpen(false)} okText="Зафиксировать" cancelText="Отмена">
        <Form form={depForm} layout="vertical">
          <Form.Item name="actualDeparture" label="Фактический выезд" rules={[{ required: true }]}>
            <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary">Рейс перейдёт в статус «В пути».</Text>
        </Form>
      </Modal>

      <Modal open={arrOpen} title="Фиксация приёмки" onOk={submitArrival} onCancel={() => setArrOpen(false)} okText="Зафиксировать" cancelText="Отмена">
        <Form form={arrForm} layout="vertical">
          <Form.Item name="actualArrival" label="Фактическое прибытие" rules={[{ required: true }]}>
            <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualPallets" label="Факт. паллет" rules={[{ required: true, message: 'Укажите кол-во' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualWeightKg" label="Факт. вес (кг)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="discrepancyNote" label="Причина расхождения (если есть)">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Text type="secondary">Рейс перейдёт в статус «Завершён».</Text>
        </Form>
      </Modal>

      <Modal open={completeOpen} title={`Завершение рейса ${trip.tripNumber}`} onOk={submitComplete} onCancel={() => setCompleteOpen(false)} okText="Завершить" cancelText="Отмена">
        <Form form={completeForm} layout="vertical">
          {trip.status === 'PLANNED' && (
            <Form.Item name="actualDeparture" label="Факт. отправление" rules={[{ required: true }]}>
              <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="actualArrival" label="Факт. прибытие" rules={[{ required: true }]}>
            <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualPallets" label="Факт. паллет" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualWeightKg" label="Факт. вес (кг)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={qOpen} title="Регистрация инцидента" onOk={submitQuality} onCancel={() => setQOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={qForm} layout="vertical">
          <Form.Item name="eventType" label="Тип события" rules={[{ required: true }]}>
            <Select options={eventTypeOptions} />
          </Form.Item>
          <Form.Item name="severity" label="Тяжесть" rules={[{ required: true }]}>
            <Select options={severityOptions} />
          </Form.Item>
          <Form.Item name="eventTime" label="Время события">
            <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Space wrap>
            <Form.Item name="tempRecorded" label="Темп. факт"><InputNumber style={{ width: 120 }} /></Form.Item>
            <Form.Item name="delayMinutes" label="Задержка (мин)"><InputNumber min={0} style={{ width: 140 }} /></Form.Item>
          </Space>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={cargoOpen} title="Добавить груз" onOk={submitCargo} onCancel={() => setCargoOpen(false)} okText="Добавить" cancelText="Отмена" width={520}>
        <Form form={cargoForm} layout="vertical">
          <Form.Item name="customerId" label="Получатель части" rules={[{ required: true }]}>
            <CustomerSelect style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unitType" label="Тип единицы" rules={[{ required: true }]}>
            <Select options={unitTypeOptions} />
          </Form.Item>
          <Space wrap>
            <Form.Item name="pallets" label="Паллет"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="traysCount" label="Лотков"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="weightKg" label="Вес (кг)"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
          </Space>
          <Form.Item name="productCategory" label="Категория">
            <Select options={productCatOptions} allowClear />
          </Form.Item>
          <Form.Item name="tempRegime" label="Темп. режим">
            <Select options={tempRegimeOptions} allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={attachOpen} title="Привязать груз из заявки" onOk={submitAttach} onCancel={() => setAttachOpen(false)} okText="Привязать" cancelText="Отмена">
        <Form form={attachForm} layout="vertical">
          <Form.Item name="cargoId" label="Груз без рейса" rules={[{ required: true }]}>
            <AsyncSelect fetchOptions={() => getUnassignedCargoLegOptions()} placeholder="Выберите груз из заявки" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
