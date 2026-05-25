'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, Space, Popconfirm, Tag, message, Modal, Result } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined } from '@ant-design/icons';
import DataTable from '@/components/DataTable';
import EntityForm from '@/components/EntityForm';
import { usePermissions } from '@/hooks/usePermissions';
import { getUsers, getRoles, createUser, updateUser, deleteUser, resetUserPassword } from '@/lib/actions/users';

const roleLabels: Record<string, string> = {
  ADMIN: 'Администратор',
  LOGISTICS_MANAGER: 'Логист',
  LAAS_MANAGER: 'LAAS-менеджер',
  OWN_DISPATCHER: 'Диспетчер OWN',
  WAREHOUSE_OPERATOR: 'Оператор склада',
  RECEIVER_OPERATOR: 'Оператор приёмки',
  ACCOUNTANT: 'Бухгалтер',
  VIEWER: 'Наблюдатель',
};

export default function UsersPage() {
  const { can } = usePermissions();
  const [data, setData] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<any>(null);
  const [pwdForm] = Form.useForm();

  const allowed = can('users.manage');

  const load = async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([getUsers(), getRoles()]);
      setData(u); setRoles(r);
    } catch (e: any) { message.error(e?.message || 'Нет доступа'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (allowed) load(); else setLoading(false); }, [allowed]);

  if (!allowed) {
    return <Result status="403" title="Доступ запрещён" subTitle="Управление пользователями доступно только администраторам." />;
  }

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ isActive: true, roleIds: [] }); setOpen(true); };
  const onEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ email: r.email, fullName: r.fullName, phone: r.phone, isActive: r.isActive, roleIds: r.roles.map((ur: any) => ur.roleId) });
    setOpen(true);
  };
  const onDelete = async (id: string) => {
    try { await deleteUser(id); message.success('Удалено'); load(); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await updateUser(editing.id, { fullName: v.fullName, phone: v.phone, isActive: v.isActive, roleIds: v.roleIds });
      else await createUser({ email: v.email, fullName: v.fullName, phone: v.phone, password: v.password, roleIds: v.roleIds, isActive: v.isActive });
      message.success('Сохранено'); setOpen(false); load();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const openPwd = (r: any) => { setPwdUser(r); pwdForm.resetFields(); setPwdOpen(true); };
  const submitPwd = async () => {
    const v = await pwdForm.validateFields();
    try { await resetUserPassword(pwdUser.id, v.password); message.success('Пароль обновлён'); setPwdOpen(false); }
    catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  const roleOptions = roles.map((r) => ({ value: r.id, label: roleLabels[r.name] || r.name }));

  const columns = [
    { title: 'ФИО', dataIndex: 'fullName', key: 'fullName' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Телефон', dataIndex: 'phone', key: 'phone', render: (v: string) => v || '—', responsive: ['lg'] as any },
    {
      title: 'Роли', key: 'roles',
      render: (_: any, r: any) => <Space wrap size={4}>{r.roles.map((ur: any) => <Tag key={ur.id} color="blue">{roleLabels[ur.role.name] || ur.role.name}</Tag>)}</Space>,
    },
    { title: 'Активен', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag> },
    {
      title: 'Действия', key: 'actions', width: 150,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          <Button type="link" icon={<KeyOutlined />} title="Сбросить пароль" onClick={() => openPwd(r)} />
          <Popconfirm title="Удалить пользователя?" onConfirm={() => onDelete(r.id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <DataTable title="Пользователи" data={data} columns={columns} loading={loading}
        searchableKeys={['fullName', 'email']}
        toolbar={<Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>Добавить</Button>} />

      <EntityForm open={open} title={editing ? 'Редактировать пользователя' : 'Новый пользователь'} form={form}
        onSubmit={onSubmit} onCancel={() => setOpen(false)} isEditing={!!editing}>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Введите email' }]}>
          <Input disabled={!!editing} />
        </Form.Item>
        <Form.Item name="fullName" label="ФИО" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="phone" label="Телефон"><Input /></Form.Item>
        {!editing && (
          <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}>
            <Input.Password />
          </Form.Item>
        )}
        <Form.Item name="roleIds" label="Роли" rules={[{ required: true, message: 'Выберите хотя бы одну роль' }]}>
          <Select mode="multiple" options={roleOptions} placeholder="Роли пользователя" />
        </Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
      </EntityForm>

      <Modal open={pwdOpen} title={`Сброс пароля${pwdUser ? ': ' + pwdUser.fullName : ''}`} onOk={submitPwd} onCancel={() => setPwdOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={pwdForm} layout="vertical">
          <Form.Item name="password" label="Новый пароль" rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
