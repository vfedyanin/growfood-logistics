'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, Form, Input, InputNumber, Select, DatePicker, Space, Popconfirm, Tag, message,
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
const pricingModeOptions = [{ value: 'CARGO', label: 'Цена на груз' }, { value: 'LEG', label: 'Цена по плечам' }];
const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
const fmtt = (d: any) => (d ? dayjs(d).format('DD.MM HH:mm') : '—');
const rub = (v: any) => (v != null ? Number(v).toLocaleString('ru') + ' ₽' : '—');

// Поля одного плеча (используются в Form.List создания и в модалке груза)
function LegFields({ name, restField, showPrice }: { name: number; restField: any; showPrice: boolean }) {
  return (
    <Space wrap size="small">
      <Form.Item {...restField} name={[name, 'pickupLocationId']} label="Забор"><LocationSelect style={{ width: 180 }} /></Form.Item>
      <Form.Item {...restField} name={[name, 'dropoffLocationId']} label="Выгрузка"><LocationSelect style={{ width: 180 }} /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedPickup']} label="Забор (план)"><DatePicker showTime format="DD.MM.YYYY HH:mm" /></Form.Item>
      <Form.Item {...restField} name={[name, 'plannedDropoff']} label="Выгрузка (план)"><DatePicker showTime format="DD.MM.YYYY HH:mm" /></Form.Item>
      {showPrice && <Form.Item {...restField} name={[name, 'cost']} label="Стоимость, ₽"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>}
      {showPrice && <Form.Item {...restField} name={[name, 'discount']} label="Скидка, ₽"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>}
    </Space>
  );
}

// Карточка одного груза в форме создания (вложенный список плеч)
function CargoCard({ name, restField, onRemove, form }: { name: number; restField: any; onRemove: () => void; form: any }) {
  const mode = Form.useWatch(['cargoes', name, 'pricingMode'], form) || 'CARGO';
  return (
    <Card size="small" style={{ marginBottom: 8 }} title={`Груз №${name + 1}`}
      extra={<Button type="text" danger icon={<MinusCircleOutlined />} onClick={onRemove} />}>
      <Space wrap size="middle">
        <Form.Item {...restField} name={[name, 'consigneeId']} label="Получатель"><CustomerSelect style={{ width: 180 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'unitType']} label="Тип ед." initialValue="PALLET"><Select style={{ width: 120 }} options={unitTypeOptions} /></Form.Item>
        <Form.Item {...restField} name={[name, 'pallets']} label="Паллет"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'traysCount']} label="Лотков"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'weightKg']} label="Вес, кг"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
        <Form.Item {...restField} name={[name, 'productCategory']} label="Категория"><Select style={{ width: 140 }} options={productCatOptions} allowClear /></Form.Item>
        <Form.Item {...restField} name={[name, 'tempRegime']} label="Режим"><Select style={{ width: 130 }} options={tempRegimeOptions} allowClear /></Form.Item>
      </Space>
      <Form.Item {...restField} name={[name, 'pricingMode']} label="Ценообразование" initialValue="CARGO"><Segmented options={pricingModeOptions} /></Form.Item>
      {mode === 'CARGO' && (
        <Space>
          <Form.Item {...restField} name={[name, 'cost']} label="Стоимость, ₽"><InputNumber min={0} style={{ width: 130 }} /></Form.Item>
          <Form.Item {...restField} name={[name, 'discount']} label="Скидка, ₽"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
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
  const [fRange, setFRange] = useState<any>(null);

  // шаблоны
  const [templates, setTemplates] = useState<any[]>([]);
  const [selTemplate, setSelTemplate] = useState<string | undefined>();
  const [tplForm] = Form.useForm();
  const [tplSaveOpen, setTplSaveOpen] = useState(false);

  // детальная карточка
  const [viewOpen, setViewOpen] = useState(false);
  const [viewReq, setViewReq] = useState<any>(null);

  // груз (add/edit) в карточке
  const [cargoForm] = Form.useForm();
  const [cargoOpen, setCargoOpen] = useState(false);
  const [editingCargo, setEditingCargo] = useState<any>(null);
  const cargoMode = Form.useWatch('pricingMode', cargoForm) || 'CARGO';

  // плечо в рейс
  const [assignForm] = Form.useForm();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigningLeg, setAssigningLeg] = useState<any>(null);

  // автоподстановка вертикали из заявителя (в форме создания/редактирования)
  const customerId = Form.useWatch('customerId', form);
  useEffect(() => {
    if (!open || !customerId) return;
    getCustomerVerticalCode(customerId).then((vc) => { if (vc) form.setFieldsValue({ verticalCode: vc }); });
    // eslint-disable-next-line
  }, [customerId, open]);

  const load = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (fStatus) filters.status = fStatus;
      if (fCustomer) filters.customerId = fCustomer;
      if (fRange?.[0]) filters.dateFrom = fRange[0].startOf('day').toISOString();
      if (fRange?.[1]) filters.dateTo = fRange[1].endOf('day').toISOString();
      setData(await getRequests(filters));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fStatus, fCustomer, fRange]);
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
      requestedDate: r.requestedDate ? dayjs(r.requestedDate) : null,
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
  const serializeLegs = (legs: any[]) => (legs || []).map((l: any) => ({
    ...l,
    plannedPickup: l.plannedPickup ? l.plannedPickup.toISOString() : null,
    plannedDropoff: l.plannedDropoff ? l.plannedDropoff.toISOString() : null,
  }));
  const serializeCargoes = (arr: any[]) => (arr || []).map((c: any) => ({ ...c, legs: serializeLegs(c.legs) }));
  // Груз из БД (на существующей заявке) → формат данных шаблона
  const dbCargoToTpl = (c: any) => ({
    consigneeId: c.consigneeId ?? undefined,
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
      plannedPickup: l.plannedPickup ? new Date(l.plannedPickup).toISOString() : null,
      plannedDropoff: l.plannedDropoff ? new Date(l.plannedDropoff).toISOString() : null,
      cost: l.cost != null ? Number(l.cost) : undefined,
      discount: l.discount != null ? Number(l.discount) : undefined,
    })),
  });
  const onSubmit = async () => {
    const v = await form.validateFields();
    const payload = {
      ...v,
      requestDate: v.requestDate ? v.requestDate.toISOString() : null,
      requestedDate: v.requestedDate ? v.requestedDate.toISOString() : null,
    };
    try {
      if (editing) await updateRequest(editing.id, payload);
      else await createRequest({ ...payload, cargoes: serializeCargoes(v.cargoes) });
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const openView = async (r: any) => { setViewReq(await getRequest(r.id)); setViewOpen(true); };

  // ---- груз в карточке (с плечами) ----
  const openAddCargo = () => { setEditingCargo(null); cargoForm.resetFields(); cargoForm.setFieldsValue({ unitType: 'PALLET', pricingMode: 'CARGO', legs: [{}] }); setCargoOpen(true); };
  const openEditCargo = (c: any) => {
    setEditingCargo(c);
    cargoForm.resetFields();
    cargoForm.setFieldsValue({
      consigneeId: c.consigneeId, unitType: c.unitType, pallets: c.pallets, traysCount: c.traysCount,
      weightKg: c.weightKg != null ? Number(c.weightKg) : null, productCategory: c.productCategory, tempRegime: c.tempRegime,
      pricingMode: c.pricingMode, cost: c.cost != null ? Number(c.cost) : null, discount: c.discount != null ? Number(c.discount) : null,
      // редактируем только непривязанные плечи
      legs: (c.legs || []).filter((l: any) => !l.tripCargoUnitId).map((l: any) => ({
        pickupLocationId: l.pickupLocationId, dropoffLocationId: l.dropoffLocationId,
        plannedPickup: l.plannedPickup ? dayjs(l.plannedPickup) : null, plannedDropoff: l.plannedDropoff ? dayjs(l.plannedDropoff) : null,
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
      requestDate: d.requestDate ? dayjs(d.requestDate) : dayjs(),
      requestedDate: d.requestedDate ? dayjs(d.requestedDate) : null,
      cargoes: (d.cargoes || []).map((c: any) => ({
        ...c,
        legs: (c.legs || []).map((l: any) => ({ ...l, plannedPickup: l.plannedPickup ? dayjs(l.plannedPickup) : null, plannedDropoff: l.plannedDropoff ? dayjs(l.plannedDropoff) : null })),
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
    const data = { ...v, requestDate: v.requestDate ? v.requestDate.toISOString() : null, requestedDate: v.requestedDate ? v.requestedDate.toISOString() : null, cargoes };
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
    { title: 'Вертикаль', key: 'vert', render: (_: any, r: any) => r.vertical?.name || '—', responsive: ['lg'] as any },
    { title: 'Дата', dataIndex: 'requestDate', key: 'date', render: fmt, responsive: ['lg'] as any },
    { title: 'Грузов', key: 'cargoes', render: (_: any, r: any) => r.cargoes?.length || 0, width: 80 },
    { title: 'Сумма', key: 'sum', render: (_: any, r: any) => rub(reqSum(r)) },
    { title: 'Статус', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusCfg[s]?.color}>{statusCfg[s]?.label || s}</Tag> },
    {
      title: 'Действия', key: 'actions', width: 160,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} onClick={() => openView(r)} />
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
    { title: 'Забор/выгрузка', key: 'dates', render: (_: any, l: any) => `${fmtt(l.plannedPickup)} / ${fmtt(l.plannedDropoff)}`, responsive: ['lg'] as any },
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
          title={`${c.consignee?.name || 'Груз'} · ${c.pallets ?? '—'}пал/${c.traysCount ?? '—'}лот · итого ${rub(c.finalCost)} · ${c.pricingMode === 'LEG' ? 'цена по плечам' : 'цена на груз'}`}
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
      <FilterBar onReset={() => { setFStatus(undefined); setFCustomer(undefined); setFRange(null); }}>
        <Select placeholder="Статус" allowClear style={{ width: 170 }} value={fStatus} onChange={setFStatus} options={Object.entries(statusCfg).map(([v, c]) => ({ value: v, label: c.label }))} />
        <CustomerSelect placeholder="Заявитель" style={{ width: 200 }} value={fCustomer} onChange={setFCustomer} />
        <DatePicker.RangePicker value={fRange} onChange={setFRange} format="DD.MM.YYYY" />
      </FilterBar>

      <DataTable title="Заявки на перевозку" data={data} columns={columns} loading={loading} scrollX={1100}
        searchableKeys={['requestNumber']}
        toolbar={canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Создать заявку</Button> : undefined} />

      {/* ===== Создание / редактирование ===== */}
      <EntityForm open={open} title={editing ? `Заявка ${editing.requestNumber}` : 'Новая заявка'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} width={860} isEditing={!!editing}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 8, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 12 }}>
          <Text type="secondary">Шаблон:</Text>
          <Select placeholder="Заполнить из шаблона" style={{ minWidth: 240 }} allowClear value={selTemplate} onChange={(v) => applyTemplate(v)} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
          <Button onClick={openSaveTemplate}>Сохранить как шаблон</Button>
          {selTemplate && <Popconfirm title="Удалить шаблон?" onConfirm={deleteSelectedTemplate}><Button danger>Удалить шаблон</Button></Popconfirm>}
        </div>

        <Divider titlePlacement="left">Шапка</Divider>
        <Space wrap size="large">
          <Form.Item name="customerId" label="Заявитель" rules={[{ required: true }]}><CustomerSelect style={{ width: 240 }} /></Form.Item>
          <Form.Item name="payerId" label="Плательщик"><CustomerSelect style={{ width: 240 }} /></Form.Item>
          <Form.Item name="verticalCode" label="Вертикаль (из заявителя)" tooltip="Подтягивается автоматически по заявителю"><VerticalSelect style={{ width: 200 }} disabled /></Form.Item>
        </Space>
        <Space wrap size="large">
          <Form.Item name="shipperId" label="Грузоотправитель"><CustomerSelect partyRole="SHIPPER" style={{ width: 240 }} /></Form.Item>
          <Form.Item name="consigneeId" label="Грузополучатель"><CustomerSelect partyRole="CONSIGNEE" style={{ width: 240 }} /></Form.Item>
        </Space>
        <Space wrap size="large">
          <Form.Item name="pickupLocationId" label="Откуда (общее)"><LocationSelect style={{ width: 240 }} /></Form.Item>
          <Form.Item name="deliveryLocationId" label="Куда (общее)"><LocationSelect style={{ width: 240 }} /></Form.Item>
        </Space>
        <Space wrap size="large">
          <Form.Item name="requestDate" label="Дата заявки"><DatePicker format="DD.MM.YYYY" /></Form.Item>
          <Form.Item name="requestedDate" label="Желаемая дата"><DatePicker format="DD.MM.YYYY" /></Form.Item>
          <Form.Item name="traysCount" label="Лотков (опц.)"><InputNumber min={0} style={{ width: 130 }} /></Form.Item>
        </Space>
        <Form.Item name="notes" label="Примечания"><Input.TextArea rows={2} /></Form.Item>

        {!editing && (
          <>
            <Divider titlePlacement="left">Грузы</Divider>
            <Form.List name="cargoes">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <CargoCard key={key} name={name} restField={rest} onRemove={() => remove(name)} form={form} />
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ unitType: 'PALLET', pricingMode: 'CARGO', legs: [{}] })}>Добавить груз</Button>
                </>
              )}
            </Form.List>
          </>
        )}
        {editing && viewReq && viewReq.id === editing.id && renderCargoes(viewReq)}
      </EntityForm>

      {/* ===== Детальная карточка ===== */}
      <Modal open={viewOpen} onCancel={() => setViewOpen(false)} footer={null} width={1000}
        title={viewReq ? `Заявка ${viewReq.requestNumber}` : 'Заявка'}>
        {viewReq && (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Tag color={statusCfg[viewReq.status]?.color}>{statusCfg[viewReq.status]?.label}</Tag>
              {canWrite && <Button size="small" icon={<CarOutlined />} onClick={onCreateTrip}>Создать рейс из заявки</Button>}
              {canWrite && (
                <Popconfirm title={`Создать счёт на ${rub(reqSum(viewReq))}?`} onConfirm={onCreateInvoice}>
                  <Button size="small" icon={<FileTextOutlined />}>Создать счёт</Button>
                </Popconfirm>
              )}
            </Space>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Заявитель">{viewReq.customer?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Плательщик">{viewReq.payer?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Вертикаль">{viewReq.vertical?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Дата заявки">{fmt(viewReq.requestDate)}</Descriptions.Item>
              <Descriptions.Item label="Отправитель">{viewReq.shipper?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Получатель">{viewReq.consignee?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Сумма (итого по грузам)">{rub(reqSum(viewReq))}</Descriptions.Item>
              <Descriptions.Item label="Счета">{viewReq.invoices?.length ? viewReq.invoices.map((i: any) => `${i.invoiceNumber} (${rub(i.amount)})`).join(', ') : '—'}</Descriptions.Item>
            </Descriptions>

            {renderCargoes(viewReq)}
          </>
        )}
      </Modal>

      {/* ===== Груз (add/edit) с плечами ===== */}
      <Modal open={cargoOpen} title={editingCargo ? 'Редактировать груз' : 'Добавить груз'} onOk={submitCargo} onCancel={() => setCargoOpen(false)} okText="Сохранить" cancelText="Отмена" width={720}>
        <Form form={cargoForm} layout="vertical">
          <Space wrap size="middle">
            <Form.Item name="consigneeId" label="Получатель"><CustomerSelect style={{ width: 180 }} /></Form.Item>
            <Form.Item name="unitType" label="Тип ед." initialValue="PALLET"><Select style={{ width: 120 }} options={unitTypeOptions} /></Form.Item>
            <Form.Item name="pallets" label="Паллет"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
            <Form.Item name="traysCount" label="Лотков"><InputNumber min={0} style={{ width: 90 }} /></Form.Item>
            <Form.Item name="weightKg" label="Вес, кг"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
            <Form.Item name="productCategory" label="Категория"><Select style={{ width: 140 }} options={productCatOptions} allowClear /></Form.Item>
            <Form.Item name="tempRegime" label="Режим"><Select style={{ width: 130 }} options={tempRegimeOptions} allowClear /></Form.Item>
          </Space>
          <Form.Item name="pricingMode" label="Ценообразование" initialValue="CARGO"><Segmented options={pricingModeOptions} /></Form.Item>
          {cargoMode === 'CARGO' && (
            <Space>
              <Form.Item name="cost" label="Стоимость, ₽"><InputNumber min={0} style={{ width: 130 }} /></Form.Item>
              <Form.Item name="discount" label="Скидка, ₽"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
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
