'use client';

import React, { useEffect, useRef } from 'react';
import { Form, Input } from 'antd';
import type { FormInstance } from 'antd';
import { codeFromName } from '@/lib/translit';

interface CodeInputProps {
  form: FormInstance;
  /** Поле, из которого предлагается код. */
  source?: string;
  /** Разделитель между словами. */
  separator?: string;
  /** Постоянный префикс кода, например «LOC-». */
  prefix?: string;
  /** Подставлять автоматически. Выключать при редактировании существующей записи. */
  autoFill?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Поле «Код» с автоподстановкой из названия (чип task_f5ab7091).
 *
 * Пока пользователь не правил код руками, он следует за названием. После первой
 * ручной правки автоподстановка отключается, чтобы не перетирать ввод.
 *
 * ВАЖНО: монтировать с `key`, зависящим от редактируемой записи — форма в модалке
 * не размонтируется между открытиями, и без key признак «правил руками»
 * протёк бы в следующую запись.
 */
export default function CodeInput({
  form,
  source = 'name',
  separator = '-',
  prefix = '',
  autoFill = true,
  value,
  onChange,
  ...rest
}: CodeInputProps) {
  const sourceValue = Form.useWatch(source, form);
  const editedByUser = useRef(false);
  const lastSuggested = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!autoFill || editedByUser.current) return;
    // если в поле уже есть значение, которое мы не предлагали сами — это ручной ввод
    if (value && value !== lastSuggested.current) return;
    const next = codeFromName(sourceValue ?? '', separator, prefix);
    if (next === value) return;
    lastSuggested.current = next;
    onChange?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceValue, autoFill]);

  return (
    <Input
      {...rest}
      value={value}
      onChange={(e) => {
        editedByUser.current = true;
        onChange?.(e.target.value);
      }}
    />
  );
}
