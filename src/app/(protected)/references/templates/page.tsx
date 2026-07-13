'use client';

import React, { useEffect, useState } from 'react';
import {
  Tabs, Table, Button, Popconfirm, Modal, Form, Input, Space, Tag, message,
  Typography, Descriptions, Divider, Card, Empty,
} from 'antd';
import { EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import {
  getRequestTemplatesFull, getRequestTemplateFull,
  updateRequestTemplate, deleteRequestTemplate,
  getTripTemplatesFull, getTripTemplateFull,
  updateTripTemplate, deleteTripTemplate,
} from '@/lib/actions/templates';

const { Title, Text } = Typography;

const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—');
const fmtDate = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
const fmtDT = (d: any) => (d ? dayjs(d).format('DD.MM HH:mm') : '—');

// ---- Карточка шаблона заявки ----
function RequestTemplateView({ item }: { item: any }) {
  const r = item.resolved;
  if (!r) return <Text type="secondary">Нет данных</Text>;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Заявитель">{r.customer || '—'}</Descriptions.Item>
        <Descriptions.Item label="Плательщик">{r.payer || '—'}</Descriptions.Item>
        <Descriptions.Item label="Отправитель">{r.shipper || '—'}</Descriptions.Item>
        <Descriptions.Item label="Обновлено">{fmt(item.updatedAt)}</Descriptions.Item>
      </Descriptions>

      {(r.cargoes || []).length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет грузов" />}
      {(r.cargoes || []).map((c: any, ci: number) => (
        <Card key={ci} size="small" style={{ marginBottom: 8 }}
          title={`Груз ${ci + 1}: ${c.consigneeName || '—'} · ${c.pallets ?? '—'} пал`}>
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary">Ед. изм.: </Text><Text>{c.unitType === 'PALLET' ? 'Паллета' : c.unitType}</Text>
            {c.weightKg != null && <><Text type="secondary"> · Вес: </Text><Text>{c.weightKg} кг</Text></>}
          </div>
          {(c.legs || []).length > 0 && (
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={c.legs}
              columns={[
                { title: 'Откуда', key: 'p', render: (_: any, l: any) => l.pickupName || '—' },
                { title: 'Куда', key: 'd', render: (_: any, l: any) => l.dropoffName || '—' },
                {
                  title: 'Забор', key: 'pickup', render: (_: any, l: any) =>
                    l.plannedPickup ? `${fmtDT(l.plannedPickup)}${l.plannedPickupTo ? `–${l.plannedPickupTo}` : ''}` : '—'
                },
                {
                  title: 'Выгрузка', key: 'dropoff', render: (_: any, l: any) =>
                    l.plannedDropoff ? `${fmtDT(l.plannedDropoff)}${l.plannedDropoffTo ? `–${l.plannedDropoffTo}` : ''}` : '—'
                },
              ]}
            />
          )}
        </Card>
      ))}
    </>
  );
}

// ---- Карточка шаблона рейса ----
function TripTemplateView({ item }: { item: any }) {
  const d = item.data as any;
  if (!d) return <Text type="secondary">Нет данных</Text>;
  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="Тип рейса">{d.tripType || '—'}</Descriptions.Item>
      <Descriptions.Item label="Тип ТС">{d.vehicleTypeCode || '—'}</Descriptions.Item>
      <Descriptions.Item label="Перевозчик">{item.carrierName || '—'}</Descriptions.Item>
      <Descriptions.Item label="Обновлено">{fmt(item.updatedAt)}</Descriptions.Item>
      {(d.routeStops || []).length > 0 && (
        <Descriptions.Item label="Остановки" span={2}>
          {d.routeStops.map((s: any, i: number) => s.locationName || s.locationId || `Остановка ${i + 1}`).join(' → ')}
        </Descriptions.Item>
      )}
    </Descriptions>
  );
}

// ---- Универсальная вкладка ----
function TemplatesTab({
  loadList,
  loadOne,
  onUpdate,
  onDelete,
  ViewComponent,
  extraColumns,
  editUrl,
}: {
  loadList: () => Promise<any[]>;
  loadOne: (id: string) => Promise<any>;
  onUpdate: (id: string, payload: { name: string }) => Promise<any>;
  onDelete: (id: string) => Promise<void>;
  ViewComponent: React.ComponentType<{ item: any }>;
  extraColumns?: any[];
  editUrl?: (id: string) => string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(50);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState<any>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewItem, setViewItem] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setItems(await loadList()); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openRename = (item: any) => {
    setRenaming(item);
    form.setFieldsValue({ name: item.name });
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const { name } = await form.validateFields();
    try {
      await onUpdate(renaming.id, { name });
      message.success('Переименовано');
      setRenameOpen(false);
      load();
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const handleDelete = async (id: string) => {
    try { await onDelete(id); message.success('Удалено'); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const openView = async (item: any) => {
    setViewOpen(true);
    setViewItem(null);
    setViewLoading(true);
    try {
      const full = await loadOne(item.id);
      setViewItem(full);
    } finally { setViewLoading(false); }
  };

  const columns = [
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row: any) => (
        <Button type="link" style={{ padding: 0, textAlign: 'left', height: 'auto', whiteSpace: 'normal' }} onClick={() => openView(row)}>
          {name}
        </Button>
      ),
    },
    ...(extraColumns || []),
    {
      title: 'Обновлено',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 140,
      render: (d: any) => dayjs(d).format('DD.MM.YYYY'),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: any, row: any) => (
        <Space size={0}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openView(row)} title="Просмотр" />
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openRename(row)} title="Переименовать" />
          <Popconfirm title="Удалить шаблон?" onConfirm={() => handleDelete(row.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} title="Удалить" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ pageSize, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], showTotal: (t) => `Всего: ${t}`, onShowSizeChange: (_cur: number, size: number) => setPageSize(size) }}
        locale={{ emptyText: 'Шаблонов нет' }}
      />

      {/* Просмотр */}
      <Modal
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={null}
        width={720}
        title={viewItem?.name || '…'}
      >
        {viewLoading && <Text type="secondary">Загрузка…</Text>}
        {!viewLoading && viewItem && <ViewComponent item={viewItem} />}
      </Modal>

      {/* Редактирование */}
      <Modal
        open={renameOpen}
        onOk={submitRename}
        onCancel={() => setRenameOpen(false)}
        title="Редактировать шаблон"
        okText="Сохранить название"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
        {editUrl && renaming && (
          <>
            <Divider style={{ margin: '12px 0 8px' }} />
            <Typography.Text type="secondary">
              Изменить содержимое шаблона (грузы, маршруты, ценообразование):{' '}
              <Typography.Link
                onClick={() => { setRenameOpen(false); router.push(editUrl(renaming.id)); }}
              >
                открыть в форме →
              </Typography.Link>
            </Typography.Text>
          </>
        )}
      </Modal>
    </>
  );
}

export default function TemplatesPage() {
  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>Шаблоны</Title>
      <Tabs
        defaultActiveKey="requests"
        items={[
          {
            key: 'requests',
            label: 'Шаблоны заявок',
            children: (
              <TemplatesTab
                loadList={getRequestTemplatesFull}
                loadOne={getRequestTemplateFull}
                onUpdate={(id, p) => updateRequestTemplate(id, p)}
                onDelete={deleteRequestTemplate}
                ViewComponent={RequestTemplateView}
                editUrl={(id) => `/requests?editTemplate=${id}`}
                extraColumns={[
                  {
                    title: 'Заявитель',
                    key: 'customer',
                    render: (_: any, row: any) => <Text type="secondary">{row.customerName || '—'}</Text>,
                  },
                ]}
              />
            ),
          },
          {
            key: 'trips',
            label: 'Шаблоны рейсов',
            children: (
              <TemplatesTab
                loadList={getTripTemplatesFull}
                loadOne={getTripTemplateFull}
                onUpdate={(id, p) => updateTripTemplate(id, p)}
                onDelete={deleteTripTemplate}
                ViewComponent={TripTemplateView}
                editUrl={(id) => `/operations/trips?editTemplate=${id}`}
                extraColumns={[
                  {
                    title: 'Перевозчик',
                    key: 'carrier',
                    render: (_: any, row: any) => <Text type="secondary">{row.carrierName || '—'}</Text>,
                  },
                  {
                    title: 'Тип ТС',
                    key: 'vt',
                    width: 90,
                    render: (_: any, row: any) => {
                      const vt = (row.data as any)?.vehicleTypeCode;
                      return vt ? <Tag>{vt}</Tag> : '—';
                    },
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </>
  );
}
