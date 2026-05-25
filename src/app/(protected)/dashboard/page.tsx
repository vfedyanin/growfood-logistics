'use client';

import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Typography, Select, DatePicker, Divider, Spin, Empty } from 'antd';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import FilterBar from '@/components/FilterBar';
import KpiCard from '@/components/KpiCard';
import { VerticalSelect, CustomerSelect, CarrierSelect } from '@/components/selects/EntitySelects';
import { getDashboardMetrics, DashboardFilters } from '@/lib/actions/analytics';

const { Title, Text } = Typography;

const tripTypeOptions = [
  { value: 'OWN', label: 'OWN' }, { value: 'LAAS', label: 'LAAS' }, { value: 'CONSOLIDATED', label: 'Консолидированный' },
];
const PIE_COLORS = ['#1677ff', '#52c41a', '#faad14', '#eb2f96', '#13c2c2', '#722ed1', '#fa541c'];
const rub = (v: number) => v.toLocaleString('ru') + ' ₽';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [m, setM] = useState<any>(null);

  const [range, setRange] = useState<any>(null);
  const [tripType, setTripType] = useState<string>();
  const [verticalCode, setVerticalCode] = useState<string>();
  const [shipperId, setShipperId] = useState<string>();
  const [consigneeId, setConsigneeId] = useState<string>();
  const [payerId, setPayerId] = useState<string>();
  const [carrierId, setCarrierId] = useState<string>();

  const load = async () => {
    setLoading(true);
    try {
      const f: DashboardFilters = { tripType: tripType as any, verticalCode, shipperId, consigneeId, payerId, carrierId };
      if (range?.[0]) f.dateFrom = range[0].startOf('day').toISOString();
      if (range?.[1]) f.dateTo = range[1].endOf('day').toISOString();
      setM(await getDashboardMetrics(f));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range, tripType, verticalCode, shipperId, consigneeId, payerId, carrierId]);

  const reset = () => { setRange(null); setTripType(undefined); setVerticalCode(undefined); setShipperId(undefined); setConsigneeId(undefined); setPayerId(undefined); setCarrierId(undefined); };

  const section = (title: string) => <Divider titlePlacement="left" style={{ marginTop: 24 }}><b>{title}</b></Divider>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>Дашборд{m ? ` · рейсов: ${m.tripsCount}` : ''}</Title>
      </div>

      <FilterBar onReset={reset}>
        <DatePicker.RangePicker value={range} onChange={setRange} format="DD.MM.YYYY" />
        <Select placeholder="Тип рейса" allowClear style={{ width: 160 }} value={tripType} onChange={setTripType} options={tripTypeOptions} />
        <VerticalSelect placeholder="Вертикаль" style={{ width: 170 }} value={verticalCode} onChange={setVerticalCode} />
        <CustomerSelect placeholder="Отправитель" style={{ width: 170 }} value={shipperId} onChange={setShipperId} />
        <CustomerSelect placeholder="Получатель" style={{ width: 170 }} value={consigneeId} onChange={setConsigneeId} />
        <CustomerSelect placeholder="Плательщик" style={{ width: 170 }} value={payerId} onChange={setPayerId} />
        <CarrierSelect placeholder="Перевозчик" style={{ width: 170 }} value={carrierId} onChange={setCarrierId} />
      </FilterBar>

      {loading || !m ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : (
        <>
          {/* 1. Стоимость */}
          {section('1. Стоимость перевозки')}
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}><KpiCard label="Общая стоимость" value={m.cost.total} suffix="₽" /></Col>
            <Col xs={12} sm={6}><KpiCard label="Средняя за рейс" value={m.cost.avgPerTrip} suffix="₽" /></Col>
            <Col xs={12} sm={6}><KpiCard label="Всего паллет" value={m.cost.totalPallets} /></Col>
            <Col xs={12} sm={6}><KpiCard label="vs рынок" value={m.cost.marketComparisonPct != null ? m.cost.marketComparisonPct.toFixed(0) : '—'} suffix={m.cost.marketComparisonPct != null ? '%' : ''} hint="Наша стоимость относительно рыночных цен (100% = на уровне рынка)" /></Col>
          </Row>
          <Card size="small" style={{ marginTop: 16 }} title="Динамика стоимости по месяцам">
            {m.cost.byMonth.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={m.cost.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => rub(Number(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="cost" name="Стоимость, ₽" stroke="#1677ff" strokeWidth={2} />
                  <Line type="monotone" dataKey="costPerPallet" name="₽/паллета" stroke="#52c41a" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" />}
          </Card>

          {/* 2. Загрузка */}
          {section('2. Загрузка ТС')}
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}><KpiCard label="Средняя загрузка" value={m.load.avgPct} suffix="%" hint="Факт. паллеты / вместимость типа ТС" /></Col>
            <Col xs={12} sm={6}><KpiCard label="≥ 80%" value={m.load.high} hint="Рейсов с хорошей загрузкой" /></Col>
            <Col xs={12} sm={6}><KpiCard label="60–79%" value={m.load.mid} /></Col>
            <Col xs={12} sm={6}><KpiCard label="< 60%" value={m.load.low} hint="Недозагруженные рейсы" /></Col>
          </Row>
          <Card size="small" style={{ marginTop: 16 }} title="Средняя загрузка по типам ТС, %">
            {m.load.byType.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={m.load.byType}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="avgLoad" name="Загрузка, %" fill="#1677ff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" />}
          </Card>

          {/* 3. Маршруты */}
          {section('3. Эффективность маршрутов')}
          <Table size="small" rowKey="route" pagination={false} dataSource={m.routes}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" /> }}
            columns={[
              { title: 'Маршрут', dataIndex: 'route', key: 'route' },
              { title: 'Рейсов', dataIndex: 'trips', key: 'trips', width: 90 },
              { title: 'Стоимость', dataIndex: 'cost', key: 'cost', render: rub },
              { title: 'Паллет', dataIndex: 'pallets', key: 'pallets', width: 90 },
              { title: '₽/паллета', dataIndex: 'costPerPallet', key: 'cpp', render: rub },
              { title: '₽/паллето-км', dataIndex: 'costPerPalletKm', key: 'cppk', render: (v: number) => v ? v.toFixed(2) : '—' },
            ]} />

          {/* 4. Качество */}
          {section('4. Качество (OTD)')}
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}><KpiCard label="OTD (вовремя)" value={m.quality.otdPct != null ? m.quality.otdPct : '—'} suffix={m.quality.otdPct != null ? '%' : ''} hint="Прибытие ≤ план + 30 мин" /></Col>
            <Col xs={12} sm={6}><KpiCard label="Опозданий" value={m.quality.lateCount} trend={null} /></Col>
            <Col xs={12} sm={6}><KpiCard label="Ср. опоздание" value={m.quality.avgDelayMin} suffix="мин" /></Col>
            <Col xs={12} sm={6}><KpiCard label="Наруш. температуры" value={m.quality.tempViolations} hint="Событий TEMP_VIOLATION" /></Col>
          </Row>

          {/* 5. Вертикали + 6. Заказчики */}
          {section('5. Стоимость по вертикалям')}
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card size="small" title="Распределение по вертикалям">
                {m.byVertical.length ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={m.byVertical} dataKey="cost" nameKey="vertical" cx="50%" cy="50%" outerRadius={90} label={(e: any) => e.vertical}>
                        {m.byVertical.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => rub(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" />}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title="Сумма по вертикалям">
                <Table size="small" rowKey="vertical" pagination={false} dataSource={m.byVertical}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" /> }}
                  columns={[
                    { title: 'Вертикаль', dataIndex: 'vertical', key: 'v' },
                    { title: 'Аллок. стоимость', dataIndex: 'cost', key: 'c', render: rub },
                  ]} />
              </Card>
            </Col>
          </Row>

          {section('6. Стоимость по заказчикам (₽/лоток)')}
          <Table size="small" rowKey="customer" pagination={false} dataSource={m.byCustomer}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" /> }}
            columns={[
              { title: 'Заказчик', dataIndex: 'customer', key: 'c' },
              { title: 'Аллок. стоимость', dataIndex: 'cost', key: 'cost', render: rub },
              { title: 'Лотков', dataIndex: 'trays', key: 'trays', width: 100 },
              { title: '₽/лоток', dataIndex: 'costPerTray', key: 'cpt', render: rub },
            ]} />

          {/* 7. Лотки */}
          {section('7. Статистика по лоткам')}
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}><KpiCard label="Всего лотков" value={m.trays.total} /></Col>
            <Col xs={12} sm={6}><KpiCard label="Лотков / рейс" value={m.trays.perTrip} /></Col>
            <Col xs={12} sm={6}><KpiCard label="₽ / лоток" value={m.trays.costPerTray} suffix="₽" /></Col>
            <Col xs={12} sm={6}><KpiCard label="Лотков / паллета" value={m.trays.perPallet} /></Col>
          </Row>

          {/* 8. Рентабельность клиентов LaaS */}
          {section('8. Рентабельность клиентов LaaS (по плательщикам)')}
          {(() => {
            const lp = m.laasProfitability || [];
            const tRev = lp.reduce((s: number, x: any) => s + x.revenue, 0);
            const tCost = lp.reduce((s: number, x: any) => s + x.cost, 0);
            const tProfit = tRev - tCost;
            return (
              <>
                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                  <Col xs={12} sm={6}><KpiCard label="Стоимость услуг" value={tRev} suffix="₽" /></Col>
                  <Col xs={12} sm={6}><KpiCard label="Расходы" value={tCost} suffix="₽" /></Col>
                  <Col xs={12} sm={6}><KpiCard label="Рентабельность" value={tProfit} suffix="₽" trendPositiveIsGood /></Col>
                  <Col xs={12} sm={6}><KpiCard label="Рентабельность, %" value={tRev > 0 ? Math.round((tProfit / tRev) * 100) : '—'} suffix={tRev > 0 ? '%' : ''} /></Col>
                </Row>
                <Table size="small" rowKey="payer" pagination={false} dataSource={lp}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных по LaaS" /> }}
                  columns={[
                    { title: 'Плательщик', dataIndex: 'payer', key: 'payer' },
                    { title: 'Стоимость услуг', dataIndex: 'revenue', key: 'revenue', render: rub },
                    { title: 'Расходы', dataIndex: 'cost', key: 'cost', render: rub },
                    { title: 'Рентабельность, ₽', dataIndex: 'profit', key: 'profit', render: (v: number) => <b style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>{rub(v)}</b> },
                    { title: 'Рентабельность, %', dataIndex: 'marginPct', key: 'marginPct', render: (v: any) => v == null ? '—' : <span style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>{v}%</span> },
                  ]} />
              </>
            );
          })()}
          <div style={{ height: 24 }} />
        </>
      )}
    </>
  );
}
