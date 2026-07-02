'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Select, DatePicker, Space, Popconfirm, Tag, message, Modal } from 'antd';
import { CarOutlined, DisconnectOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DataTable from '@/components/DataTable';
import FilterBar from '@/components/FilterBar';
import AsyncSelect from '@/components/selects/AsyncSelect';
import { CustomerSelect } from '@/components/selects/EntitySelects';
import { usePermissions } from '@/hooks/usePermissions';
import {
  getAllCargoLegs, getAllTripOptions, getAssignableTripOptions,
  addCargoLegToTrip, unassignCargoLeg,
} from '@/lib/actions/requests';

const tripStatusCfg: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: 'Черновик' }, PLANNED: { color: 'blue', label: 'Запланирован' },
  IN_TRANSIT: { color: 'orange', label: 'В пути' }, COMPLETED: { color: 'green', label: 'Завершён' }, CANCELLED: { color: 'red', label: 'Отменён' },
};
const rub = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');
const fmtPickup = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—');

export default function CargoPage() {
  const { can } = usePermissions();
  const canWrite = can('trips.write');

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tripOptions, setTripOptions] = useState<any[]>([]);
  const [filterTrip, setFilterTrip] = useState<string | undefined>(); // 'NONE' | tripId | undefined
  const [fCustomer, setFCustomer] = useState<string | undefined>();
  const [fPickup, setFPickup] = useState<any>(null);

  const [assignForm] = Form.useForm();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigningLeg, setAssigningLeg] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (filterTrip === 'NONE') filters.unassigned = true;
      else if (filterTrip) filters.tripId = filterTrip;
      if (fCustomer) filters.customerId = fCustomer;
      if (fPickup?.[0]) filters.pickupFrom = fPickup[0].startOf('day').toISOString();
      if (fPickup?.[1]) filters.pickupTo = fPickup[1].endOf('day').toISOString();
      setData(await getAllCargoLegs(filters));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterTrip, fCustomer, fPickup]);
  useEffect(() => { getAllTripOptions().then(setTripOptions); }, []);

  const openAssign = (l: any) => { setAssigningLeg(l); assignForm.resetFields(); setAssignOpen(true); };
  const submitAssign = async () => {
    const v = await assignForm.validateFields();
    try { await addCargoLegToTrip(assigningLeg.id, v.tripId); message.success('Плечо привязано к рейсу'); setAssignOpen(false); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onUnassign = async (id: string) => {
    try { await unassignCargoLeg(id); message.success('Плечо отвязано от рейса'); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const columns = [
    { title: 'Заявка', key: 'req', render: (_: any, l: any) => l.cargo?.request?.requestNumber || '—', width: 150 },
    { title: 'Заявитель', key: 'cust', render: (_: any, l: any) => l.cargo?.request?.customer?.name || '—' },
    {
      title: 'Плечо', key: 'route',
      render: (_: any, l: any) => `${l.legOrder ? `#${l.legOrder} ` : ''}${l.pickupLocation?.name || '—'} → ${l.dropoffLocation?.name || '—'}`,
    },
    { title: 'Дата забора', dataIndex: 'plannedPickup', key: 'plannedPickup', render: fmtPickup, width: 150 },
    { title: 'Паллет/лотков', key: 'qty', render: (_: any, l: any) => `${l.cargo?.pallets ?? '—'} / ${l.cargo?.traysCount ?? '—'}`, width: 120, responsive: ['lg'] as any },
    { title: 'Стоимость', dataIndex: 'finalCost', key: 'finalCost', render: rub, responsive: ['lg'] as any },
    {
      title: 'Статус', key: 'status',
      render: (_: any, l: any) => l.tripCargoUnit?.trip
        ? <Tag color="green">{l.tripCargoUnit.trip.tripNumber} · {tripStatusCfg[l.tripCargoUnit.trip.status]?.label || l.tripCargoUnit.trip.status}</Tag>
        : <Tag>Без рейса</Tag>,
    },
    {
      title: 'Действия', key: 'actions', width: 120,
      render: (_: any, l: any) => canWrite ? (
        <Space>
          {!l.tripCargoUnitId
            ? <Button type="link" size="small" icon={<CarOutlined />} title="В рейс" onClick={() => openAssign(l)} />
            : <Popconfirm title="Отвязать плечо от рейса?" onConfirm={() => onUnassign(l.id)}><Button type="link" size="small" icon={<DisconnectOutlined />} title="Отвязать" /></Popconfirm>}
        </Space>
      ) : null,
    },
  ];

  return (
    <>
      <FilterBar onReset={() => { setFilterTrip(undefined); setFCustomer(undefined); setFPickup(null); }}>
        <Select
          placeholder="Фильтр по рейсу"
          allowClear
          style={{ width: 240 }}
          value={filterTrip}
          onChange={setFilterTrip}
          showSearch
          optionFilterProp="label"
          options={[{ value: 'NONE', label: '— Без рейса —' }, ...tripOptions]}
        />
        <CustomerSelect placeholder="Заявитель" style={{ width: 200 }} value={fCustomer} onChange={setFCustomer} />
        <DatePicker.RangePicker value={fPickup} onChange={setFPickup} format="DD.MM.YYYY" placeholder={['Забор с', 'Забор по']} />
      </FilterBar>

      <DataTable title="Груз (плечи маршрута)" data={data} columns={columns} loading={loading} scrollX={1000} rowKey="id"
        searchableKeys={['cargo.request.requestNumber', 'cargo.request.customer.name', 'pickupLocation.name', 'dropoffLocation.name']} />

      {/* Привязка плеча к рейсу */}
      <Modal open={assignOpen} title="Привязать плечо к рейсу" onOk={submitAssign} onCancel={() => setAssignOpen(false)} okText="Привязать" cancelText="Отмена">
        <Form form={assignForm} layout="vertical">
          <Form.Item name="tripId" label="Рейс" rules={[{ required: true, message: 'Выберите рейс' }]}>
            <AsyncSelect fetchOptions={() => getAssignableTripOptions()} placeholder="Рейс (черновик/план/в пути)" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
