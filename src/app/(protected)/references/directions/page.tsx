'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Switch, Space, Popconfirm, Tag, message, Modal, InputNumber, Select, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import { getDirections, createDirection, updateDirection, deleteDirection, getRouteStops, setRouteStops } from '@/lib/actions/references';
import { CarrierSelect, LocationSelect } from '@/components/selects/EntitySelects';

export default function DirectionsPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  // Маршрут направления — упорядоченный список locationId. Крепится к
  // существующему направлению, поэтому редактируется только при editing:
  // у нового направления ещё нет id, к которому привязать остановки.
  const [stops, setStops] = useState<string[]>([]);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getDirections()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); setStops([]); form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true); };
  const onEdit = async (r: any) => {
    setEditing(r); form.setFieldsValue(r); setStops([]); setOpen(true);
    try { const s = await getRouteStops(r.id); setStops(s.map((x: any) => x.locationId)); } catch { /* маршрут — не критично для открытия карточки */ }
  };
  const moveStop = (i: number, dir: -1 | 1) => setStops((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const onDelete = async (id: string) => {
    try { await deleteDirection(id); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (направление используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      // Отказ по правилам (нет действующего тарифа у перевозчика) приходит полем
      // error, а не исключением: сообщение брошенной ошибки production-сборка
      // Next вырезает, и вместо объяснения пользователь видел обезличенное
      // «An error occurred in the Server Components render».
      const res = editing ? await updateDirection(editing.id, v) : await createDirection(v);
      if (res && 'error' in res) {
        // Модальным окном, а не всплывающим message: это не «что-то сломалось», а
        // сознательный стоп с инструкцией на две фразы — тост погас бы раньше,
        // чем её дочитали. Карточку не закрываем, чтобы введённое не потерялось.
        Modal.warning({
          title: 'Нельзя поставить этого перевозчика',
          content: <div style={{ whiteSpace: 'pre-line' }}>{res.error}</div>,
          okText: 'Понятно',
          width: 520,
        });
        return;
      }
      // Маршрут сохраняем только при редактировании (у нового направления id
      // появляется в res.direction, но остановки для него заведём при следующем
      // открытии — так проще и без гонок). Пустые строки-заглушки отбрасываем.
      if (editing) await setRouteStops(editing.id, stops.filter(Boolean));
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 140 },
    { title: 'Название', dataIndex: 'name', key: 'name', render: (v: string) => v || '—' },
    { title: 'Км', dataIndex: 'distanceKm', key: 'distanceKm', render: (v: any) => v ? Number(v) : '—', responsive: ['lg'] as any },
    {
      // Реквизиты автораспределения. Пусто = направление не настроено, автоматика
      // его не берёт и плечи остаются логисту — это не поломка, а рабочий остаток.
      title: 'Перевозчик', key: 'carrier',
      render: (_: any, r: any) => r.carrier?.name || <span style={{ color: '#bfbfbf' }}>не задан</span>,
    },
    {
      title: 'Режим', dataIndex: 'splitMode', key: 'splitMode', width: 150,
      render: (v: string | null) => v === 'OVERLOAD'
        ? <Tooltip title="Всё в одну машину, даже с перебором"><Tag color="orange">одна машина</Tag></Tooltip>
        : v === 'SPLIT'
          ? <Tooltip title="Дробим по вместимости: сколько машин нужно, столько и заказываем"><Tag color="blue">дробим</Tag></Tooltip>
          : <Tooltip title="Направление не настроено — автораспределение его не берёт"><span style={{ color: '#bfbfbf' }}>—</span></Tooltip>,
    },
    { title: 'Активно', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag> },
    {
      title: 'Действия', key: 'actions', width: 110,
      render: (_: any, r: any) => w ? (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          <Popconfirm title="Удалить?" onConfirm={() => onDelete(r.id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <>
      <DataTable title="Направления" data={data} columns={columns} loading={loading}
        searchableKeys={['code', 'name']}
        toolbar={w ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button> : undefined} />
      <EntityForm open={open} title={editing ? 'Редактировать направление' : 'Новое направление'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:direction">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="MSK-NN" /></Form.Item>
        <Form.Item name="name" label="Название"><Input placeholder="Москва — Нижний Новгород" /></Form.Item>
        <Form.Item name="distanceKm" label="Расстояние (км)"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        {/* Реквизиты автораспределения. Перевозчик проверяется при сохранении:
            без действующего тарифа на это направление сохранить нельзя, иначе
            рейс уедет без стоимости. Ошибка приходит с сервера текстом. */}
        <Form.Item
          name="carrierId"
          label="Перевозчик"
          extra="Одно направление — один перевозчик. Нужен действующий тариф на это направление, иначе сохранить не получится."
        >
          <CarrierSelect style={{ width: '100%' }} allowClear />
        </Form.Item>
        <Form.Item
          name="splitMode"
          label="Режим набивки машин"
          extra="Пусто — направление не настроено, автораспределение его не берёт."
        >
          <Select
            allowClear
            placeholder="не настроено"
            options={[
              { value: 'OVERLOAD', label: 'Одна машина, даже с перебором' },
              { value: 'SPLIT', label: 'Дробить по вместимости' },
            ]}
          />
        </Form.Item>
        <Form.Item name="isActive" label="Активно" valuePropName="checked"><Switch /></Form.Item>

        {/* Маршрут направления — каркас для автораспределения. Точки в порядке
            объезда; автоматика раскладывает плечи дня в этом порядке, а точки без
            груза пропускает. Доступен только у существующего направления. */}
        {editing && (
          <Form.Item
            label="Маршрут (порядок объезда)"
            extra="Максимальный маршрут: все точки, куда машина может заезжать, по порядку. В конкретный день система возьмёт только те, куда есть груз. Пусто — автораспределение работает по паре точек, как раньше."
          >
            {stops.map((locId, i) => (
              <Space key={i} style={{ display: 'flex', marginBottom: 6 }} align="baseline">
                <span style={{ width: 18, color: '#888' }}>{i + 1}.</span>
                <LocationSelect
                  value={locId || undefined}
                  onChange={(v: string) => setStops((s) => s.map((x, j) => (j === i ? v : x)))}
                  style={{ width: 260 }}
                />
                <Button size="small" disabled={i === 0} onClick={() => moveStop(i, -1)}>↑</Button>
                <Button size="small" disabled={i === stops.length - 1} onClick={() => moveStop(i, 1)}>↓</Button>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setStops((s) => s.filter((_, j) => j !== i))} />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => setStops((s) => [...s, ''])}>Добавить точку</Button>
          </Form.Item>
        )}
      </EntityForm>
    </>
  );
}
