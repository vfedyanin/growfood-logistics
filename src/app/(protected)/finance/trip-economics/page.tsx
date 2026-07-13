'use client';

import React, { useEffect, useState } from 'react';
import { Button, Tag, Space, message, Typography } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import { usePermissions } from '@/hooks/usePermissions';
import { getTrips, calculateTripEconomics } from '@/lib/actions/trips';

const { Title, Text } = Typography;

const statusCfg: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: 'Черновик' }, PLANNED: { color: 'blue', label: 'Запланирован' },
  IN_TRANSIT: { color: 'orange', label: 'В пути' }, COMPLETED: { color: 'green', label: 'Завершён' }, CANCELLED: { color: 'red', label: 'Отменён' },
};
const rub = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');
const palletsOf = (r: any) => r.actualPallets ?? r.plannedPallets ?? (r.cargoUnits || []).reduce((s: number, c: any) => s + (c.pallets || 0), 0);

export default function TripEconomicsPage() {
  const { can } = usePermissions();
  const canWrite = can('trips.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => { setLoading(true); try { setData(await getTrips()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const calc = async (id: string) => {
    setBusy(id);
    try { const r = await calculateTripEconomics(id); message.success(`Себестоимость (${r.basis}): ${rub(r.cost)}`); await load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка расчёта'); }
    finally { setBusy(null); }
  };

  const totalCost = data.reduce((s, t) => s + (t.actualCost != null ? Number(t.actualCost) : 0), 0);

  const columns = [
    { title: '№ рейса', dataIndex: 'tripNumber', key: 'tripNumber', width: 160 },
    { title: 'Маршрут', key: 'route', render: (_: any, r: any) => `${r.origin?.name || '—'} → ${r.destination?.name || '—'}` },
    { title: 'Перевозчик', key: 'carrier', render: (_: any, r: any) => r.carrier?.name || '—', responsive: ['lg'] as any },
    { title: 'Тип ТС', key: 'vt', render: (_: any, r: any) => r.vehicle?.vehicleType?.name || '—', responsive: ['lg'] as any },
    { title: 'Паллет', key: 'pallets', render: (_: any, r: any) => palletsOf(r) || '—', width: 90 },
    { title: 'Расстояние, км', key: 'km', render: (_: any, r: any) => (r.direction?.distanceKm != null ? Number(r.direction.distanceKm) : '—'), responsive: ['lg'] as any, width: 130 },
    { title: 'Статус', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusCfg[s]?.color}>{statusCfg[s]?.label || s}</Tag>, responsive: ['lg'] as any },
    { title: 'Себестоимость (тариф)', dataIndex: 'actualCost', key: 'cost', render: (v: any) => <b>{rub(v)}</b>, width: 180 },
    {
      title: 'Действия', key: 'actions', width: 170,
      render: (_: any, r: any) => canWrite ? (
        <Button size="small" icon={<DollarOutlined />} loading={busy === r.id} onClick={() => calc(r.id)}>Рассчитать</Button>
      ) : null,
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>Экономика рейсов</Title>
        <Text strong>Итого себестоимость: {rub(totalCost)}</Text>
      </div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        «Рассчитать» подбирает тариф перевозчика (договор + тип ТС + маршрут, действующий на дату выезда) и записывает себестоимость рейса.
      </Text>
      <DataTable data={data} columns={columns} loading={loading} scrollX={1100} searchableKeys={['tripNumber']} />
    </>
  );
}
