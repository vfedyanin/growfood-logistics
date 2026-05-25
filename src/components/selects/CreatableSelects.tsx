'use client';

import React, { useState } from 'react';
import { Button, Modal, Form, Input, Switch, Space, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import AsyncSelect, { AsyncSelectProps } from './AsyncSelect';
import { VehicleTypeSelect, CarrierSelect } from './EntitySelects';
import {
  getVehicleOptions, createVehicle,
  getDriverOptions, createDriver,
} from '@/lib/actions/references';

type BaseProps = Omit<AsyncSelectProps, 'fetchOptions' | 'popupExtra' | 'reloadSignal'> & {
  value?: any;
  onChange?: (v: any) => void;
};

// ---------- ТС с инлайн-созданием ----------
export function VehicleSelectCreatable({ value, onChange, ...props }: BaseProps) {
  const [signal, setSignal] = useState(0);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    try {
      const created: any = await createVehicle(v);
      message.success('ТС добавлено');
      setOpen(false);
      setSignal((s) => s + 1);
      onChange?.(created.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  return (
    <>
      <AsyncSelect
        value={value}
        onChange={onChange}
        fetchOptions={() => getVehicleOptions()}
        reloadSignal={signal}
        popupExtra={
          <Button type="link" icon={<PlusOutlined />} block
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true); }}>
            Добавить ТС
          </Button>
        }
        {...props}
      />
      <Modal open={open} title="Новое ТС" onOk={submit} onCancel={() => setOpen(false)} okText="Создать" cancelText="Отмена">
        <Form form={form} layout="vertical">
          <Form.Item name="plateNumber" label="Гос. номер" rules={[{ required: true }]}><Input placeholder="А123БВ77" /></Form.Item>
          <Form.Item name="brandModel" label="Марка/модель"><Input /></Form.Item>
          <Form.Item name="vehicleTypeCode" label="Тип ТС" rules={[{ required: true }]}><VehicleTypeSelect style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="carrierId" label="Перевозчик"><CarrierSelect style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ---------- Водитель с инлайн-созданием ----------
export function DriverSelectCreatable({ value, onChange, ...props }: BaseProps) {
  const [signal, setSignal] = useState(0);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    try {
      const created: any = await createDriver(v);
      message.success('Водитель добавлен');
      setOpen(false);
      setSignal((s) => s + 1);
      onChange?.(created.id);
    } catch (e: any) { message.error(e?.message || 'Ошибка'); }
  };

  return (
    <>
      <AsyncSelect
        value={value}
        onChange={onChange}
        fetchOptions={() => getDriverOptions()}
        reloadSignal={signal}
        popupExtra={
          <Button type="link" icon={<PlusOutlined />} block
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true); }}>
            Добавить водителя
          </Button>
        }
        {...props}
      />
      <Modal open={open} title="Новый водитель" onOk={submit} onCancel={() => setOpen(false)} okText="Создать" cancelText="Отмена">
        <Form form={form} layout="vertical">
          <Form.Item name="fullName" label="ФИО" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phone" label="Телефон"><Input /></Form.Item>
          <Form.Item name="licenseNumber" label="Вод. удостоверение"><Input /></Form.Item>
          <Form.Item name="carrierId" label="Перевозчик"><CarrierSelect style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
