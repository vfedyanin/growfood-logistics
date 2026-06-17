'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import { usePermissions } from '@/hooks/usePermissions';
import EntityForm from '@/components/EntityForm';
import {
  getAdditionalServices, createAdditionalService, updateAdditionalService, deleteAdditionalService,
} from '@/lib/actions/references';

export default function AdditionalServicesPage() {
  const { can } = usePermissions();
  const w = can('references.write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => { setLoading(true); try { setData(await getAdditionalServices()); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const onEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const onDelete = async (code: string) => {
    try { await deleteAdditionalService(code); message.success('Удалено'); load(); }
    catch { message.error('Не удалось удалить (услуга используется)'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateAdditionalService(editing.code, v);
      else await createAdditionalService(v);
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const columns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 200 },
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: 'Действия', key: 'actions', width: 110,
      render: (_: any, r: any) => w ? (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          <Popconfirm title="Удалить?" onConfirm={() => onDelete(r.code)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <>
      <DataTable title="Дополнительные услуги" data={data} columns={columns} loading={loading} rowKey="code"
        searchableKeys={['code', 'name']}
        toolbar={w ? <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button> : undefined} />
      <EntityForm open={open} title={editing ? 'Редактировать услугу' : 'Новая услуга'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing} draftKey="draft:additionalService">
        <Form.Item name="code" label="Код" rules={[{ required: true }]}>
          <Input disabled={!!editing} placeholder="WAIT" style={{ textTransform: 'uppercase' }} />
        </Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true }]}>
          <Input placeholder="Ожидание (час)" />
        </Form.Item>
      </EntityForm>
    </>
  );
}
