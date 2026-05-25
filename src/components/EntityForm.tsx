'use client';

import React, { useEffect } from 'react';
import { Modal, Form } from 'antd';
import type { FormInstance } from 'antd';

export interface EntityFormProps {
  open: boolean;
  title: React.ReactNode;
  form: FormInstance;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  children: React.ReactNode;
  width?: number;
  okText?: string;
  cancelText?: string;
  confirmLoading?: boolean;
  /**
   * Если задан — черновик формы автосохраняется в localStorage по этому ключу
   * (только для режима создания, когда нет редактируемой записи).
   */
  draftKey?: string;
  /** true, если форма редактирует существующую запись (тогда черновик не пишем). */
  isEditing?: boolean;
}

/**
 * Каркас модальной формы: AntD Modal + Form, с опциональным
 * автосохранением черновика в localStorage.
 */
export default function EntityForm({
  open,
  title,
  form,
  onSubmit,
  onCancel,
  children,
  width = 600,
  okText = 'Сохранить',
  cancelText = 'Отмена',
  confirmLoading,
  draftKey,
  isEditing,
}: EntityFormProps) {
  const enableDraft = !!draftKey && !isEditing;

  // Восстановление черновика при открытии (только создание)
  useEffect(() => {
    if (open && enableDraft) {
      try {
        const raw = localStorage.getItem(draftKey!);
        if (raw) form.setFieldsValue(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
  }, [open, enableDraft, draftKey, form]);

  const handleValuesChange = () => {
    if (!enableDraft) return;
    try {
      localStorage.setItem(draftKey!, JSON.stringify(form.getFieldsValue()));
    } catch {
      /* ignore */
    }
  };

  const clearDraft = () => {
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    }
  };

  const handleOk = async () => {
    await onSubmit();
    clearDraft();
  };

  return (
    <Modal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={okText}
      cancelText={cancelText}
      width={width}
      confirmLoading={confirmLoading}
    >
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
        {children}
      </Form>
    </Modal>
  );
}
