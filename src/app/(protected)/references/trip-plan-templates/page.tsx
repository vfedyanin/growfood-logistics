'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Switch, Space, Tag, Popconfirm, message, Typography, Empty } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import EntityForm from '@/components/EntityForm';
import { CarrierSelect, VehicleTypeSelect, LocationSelect, DirectionSelect } from '@/components/selects/EntitySelects';
import { usePermissions } from '@/hooks/usePermissions';
import {
  getTripPlanTemplates, getTripPlanTemplate,
  createTripPlanTemplate, updateTripPlanTemplate, deleteTripPlanTemplate,
} from '@/lib/actions/tripPlanTemplates';

const { Text } = Typography;

export default function TripPlanTemplatesPage() {
  const { can } = usePermissions();
  const canWrite = can('references.write');

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setData(await getTripPlanTemplates()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, legs: [{}] });
    setOpen(true);
  };

  const onEdit = async (row: any) => {
    const tpl = await getTripPlanTemplate(row.id);
    if (!tpl) return;
    setEditing(tpl);
    form.setFieldsValue({
      name: tpl.name,
      carrierId: tpl.carrierId,
      vehicleTypeCode: tpl.vehicleTypeCode,
      isActive: tpl.isActive,
      notes: tpl.notes,
      legs: (tpl.legs || []).map((l: any) => ({
        pickupLocationId: l.pickupLocationId,
        dropoffLocationId: l.dropoffLocationId,
        finalLocationId: l.finalLocationId ?? undefined,
        directionId: l.directionId ?? undefined,
      })),
    });
    setOpen(true);
  };

  const onSubmit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const payload = { ...v, legs: (v.legs || []).filter((l: any) => l?.pickupLocationId && l?.dropoffLocationId) };
      if (!payload.legs.length) { message.error('Добавьте хотя бы одно плечо'); setSubmitting(false); return; }
      if (editing) { await updateTripPlanTemplate(editing.id, payload); message.success('Шаблон обновлён'); }
      else { await createTripPlanTemplate(payload); message.success('Шаблон создан'); }
      setOpen(false);
      await load();
    } catch (e: any) {
      if (e?.errorFields) return; // ошибки валидации формы уже подсвечены
      message.error('Не удалось сохранить: ' + (e?.message ?? ''));
    } finally { setSubmitting(false); }
  };

  const onDelete = async (id: string) => {
    try { await deleteTripPlanTemplate(id); message.success('Шаблон удалён'); await load(); }
    catch (e: any) { message.error('Не удалось удалить: ' + (e?.message ?? '')); }
  };

  const columns = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    { title: 'Перевозчик', key: 'carrier', render: (_: any, r: any) => r.carrier?.name ?? '—' },
    {
      title: 'Машина', key: 'vt',
      render: (_: any, r: any) => r.vehicleType
        ? `${r.vehicleType.name}${r.vehicleType.capacityPallets ? ` · до ${r.vehicleType.capacityPallets} палл.` : ''}`
        : '—',
    },
    { title: 'Плеч', key: 'legs', width: 70, render: (_: any, r: any) => (r.legs || []).length },
    {
      title: 'Статус', key: 'active', width: 110,
      render: (_: any, r: any) => r.isActive ? <Tag color="green">активен</Tag> : <Tag>выключен</Tag>,
    },
    ...(canWrite ? [{
      title: '', key: 'act', width: 90,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          <Popconfirm title="Удалить шаблон?" onConfirm={() => onDelete(r.id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <>
      <DataTable
        title="Шаблоны автоплана"
        data={data}
        columns={columns}
        loading={loading}
        searchableKeys={['name', 'carrier.name']}
        toolbar={canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Создать шаблон</Button> : undefined}
      />

      <EntityForm
        open={open}
        title={editing ? `Шаблон «${editing.name}»` : 'Новый шаблон рейса'}
        form={form}
        onSubmit={onSubmit}
        onCancel={() => setOpen(false)}
        width={980}
        isEditing={!!editing}
        confirmLoading={submitting}
      >
        <Space wrap size="large" align="start" style={{ marginBottom: 8 }}>
          <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
            <Input placeholder="Трансхолод — машина Пятёрочки НН" style={{ width: 300 }} />
          </Form.Item>
          <Form.Item name="carrierId" label="Перевозчик" rules={[{ required: true, message: 'Укажите перевозчика' }]}>
            <CarrierSelect style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="vehicleTypeCode" label="Тип ТС" rules={[{ required: true, message: 'Укажите тип ТС' }]}>
            <VehicleTypeSelect style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="isActive" label="Активен" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>

        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
          Плечи маршрута. Плечо садится в слот, если у заявочного плеча совпали обе точки, а
          «конечная» — если она задана (пусто = любой груз этой пары точек). Конечной точкой
          делится общий забор: Пятёрочка/Казань — на эту машину, Нижний — на другую.
        </Text>

        <Form.List name="legs">
          {(fields, { add, remove, move }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 1fr 1fr 1fr 60px', gap: 8, fontSize: 12, color: '#888', padding: '0 4px' }}>
                <div>#</div><div>Откуда (забор)</div><div>Куда (выгрузка)</div><div>Конечная точка груза</div><div>Направление (опц.)</div><div />
              </div>
              {fields.map((field, idx) => (
                <div key={field.key} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 1fr 1fr 1fr 60px', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#aaa', fontSize: 12 }}>{idx + 1}</span>
                  <Form.Item {...field} name={[field.name, 'pickupLocationId']} noStyle rules={[{ required: true, message: '' }]}>
                    <LocationSelect style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'dropoffLocationId']} noStyle rules={[{ required: true, message: '' }]}>
                    <LocationSelect style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'finalLocationId']} noStyle>
                    <LocationSelect style={{ width: '100%' }} placeholder="любой" allowClear />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'directionId']} noStyle>
                    <DirectionSelect style={{ width: '100%' }} allowClear />
                  </Form.Item>
                  <Space size={0}>
                    <Button type="text" size="small" icon={<UpOutlined />} disabled={idx === 0} onClick={() => move(idx, idx - 1)} />
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                  </Space>
                </div>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} style={{ marginTop: 4 }}>
                Добавить плечо
              </Button>
              {!fields.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Плеч пока нет" />}
            </div>
          )}
        </Form.List>

        <Form.Item name="notes" label="Заметка" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} placeholder="Необязательно" />
        </Form.Item>
      </EntityForm>
    </>
  );
}
