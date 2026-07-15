'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, Spin, Divider } from 'antd';
import type { SelectProps } from 'antd';

export interface AsyncOption {
  value: string;
  label: string;
}

export interface AsyncSelectProps extends Omit<SelectProps, 'options' | 'onSearch' | 'filterOption'> {
  /** Загрузчик опций. Вызывается при монтировании и при поиске (с дебаунсом). */
  fetchOptions: (search: string) => Promise<AsyncOption[]>;
  /** Перезагружать список при наборе текста (server-side search). По умолчанию клиентский фильтр. */
  serverSearch?: boolean;
  debounceMs?: number;
  /** Изменение значения триггерит повторную загрузку опций (например, после инлайн-создания). */
  reloadSignal?: number;
  /** Доп. контент внизу выпадающего списка (например, кнопка «+ Добавить»). */
  popupExtra?: React.ReactNode;
  /** Начальные опции — показываются сразу без запроса (для предзаполненных значений). */
  initialOptions?: AsyncOption[];
}

/**
 * Универсальный async-комбобокс. Конкретные селекты (CustomerSelect,
 * LocationSelect и т.д.) оборачивают его и передают свой fetchOptions.
 */
export default function AsyncSelect({
  fetchOptions,
  serverSearch = false,
  debounceMs = 300,
  reloadSignal,
  popupExtra,
  initialOptions,
  ...rest
}: AsyncSelectProps) {
  const [options, setOptions] = useState<AsyncOption[]>(initialOptions ?? []);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  // когда initialOptions приходят позже (асинхронно) — подставляем их, если ещё не загружали
  useEffect(() => {
    if (initialOptions?.length && !loaded.current) {
      setOptions(initialOptions);
    }
  }, [initialOptions]);

  const load = async (search: string) => {
    setLoading(true);
    try {
      setOptions(await fetchOptions(search));
    } finally {
      setLoading(false);
    }
  };

  // перезагрузка по сигналу (инлайн-создание и т.п.) — грузим сразу
  useEffect(() => {
    if (reloadSignal !== undefined) {
      loaded.current = true;
      load('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // ленивая загрузка — только когда открыли дропдаун первый раз
  const handleDropdownVisibleChange = (open: boolean) => {
    if (open && !loaded.current) {
      loaded.current = true;
      load('');
    }
    rest.onDropdownVisibleChange?.(open);
  };

  const handleSearch = useMemo(
    () => (value: string) => {
      if (!serverSearch) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => load(value), debounceMs);
    },
    [serverSearch, debounceMs],
  );

  return (
    <Select
      showSearch
      allowClear
      optionFilterProp="label"
      filterOption={serverSearch ? false : undefined}
      onSearch={serverSearch ? handleSearch : undefined}
      notFoundContent={loading ? <Spin size="small" /> : undefined}
      loading={loading}
      options={options}
      onDropdownVisibleChange={handleDropdownVisibleChange}
      popupRender={popupExtra ? (menu) => (
        <>
          {menu}
          <Divider style={{ margin: '4px 0' }} />
          {popupExtra}
        </>
      ) : undefined}
      {...rest}
    />
  );
}
