'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, Spin, Divider } from 'antd';
import type { SelectProps } from 'antd';

export interface AsyncOption {
  value: string;
  label: string;
}

export interface AsyncSelectProps extends Omit<SelectProps, 'options' | 'onSearch' | 'filterOption'> {
  /** Загрузчик опций. Вызывается при поиске и при необходимости показать подписи. */
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
  /**
   * Ключ общего кеша списка. Все селекты с одним ключом делят один запрос и
   * результат: до этого каждое открытие дропдауна и каждый экземпляр
   * (в форме их бывает по 6 штук) грузили список заново.
   * Для селектов с динамическими параметрами ключ должен их включать.
   */
  cacheKey?: string;
}

// Кеш на время жизни страницы. Храним промис, а не готовый массив, чтобы
// одновременно смонтированные селекты не создавали параллельных запросов.
type CacheEntry = { promise: Promise<AsyncOption[]>; options?: AsyncOption[] };
const listCache = new Map<string, CacheEntry>();

/** Сбросить кеш списка — после создания или изменения справочной записи. */
export function invalidateAsyncSelectCache(key?: string) {
  if (key) listCache.delete(key);
  else listCache.clear();
}

/**
 * Универсальный async-комбобокс. Конкретные селекты (CustomerSelect,
 * LocationSelect и т.д.) оборачивают его и передают свой fetchOptions.
 *
 * Опции грузятся лениво — при открытии списка. Но если значение уже задано
 * (форма заполнена из шаблона или открыта на редактирование), список
 * подгружается сразу: иначе antd не найдёт подпись и покажет сырой id
 * вместо названия локации или направления.
 */
export default function AsyncSelect({
  fetchOptions,
  serverSearch = false,
  debounceMs = 300,
  reloadSignal,
  popupExtra,
  initialOptions,
  cacheKey,
  ...rest
}: AsyncSelectProps) {
  const [options, setOptions] = useState<AsyncOption[]>(initialOptions ?? []);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);
  const alive = useRef(true);

  // Флаг обязательно поднимать на монтировании, а не только гасить на размонтировании:
  // в dev React Strict Mode прогоняет цикл mount → unmount → mount, и без этого
  // после второго монтирования флаг остался бы false, а результат запроса —
  // отброшенным (селект навсегда в состоянии загрузки).
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // когда initialOptions приходят позже (асинхронно) — подставляем их, если ещё не загружали
  useEffect(() => {
    if (initialOptions?.length && !loaded.current) {
      setOptions(initialOptions);
    }
  }, [initialOptions]);

  const load = async (search: string) => {
    setLoading(true);
    try {
      const res = await fetchOptions(search);
      if (alive.current) setOptions(res);
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  // Загрузка полного списка через общий кеш
  const loadAll = async () => {
    if (!cacheKey) return load('');
    let entry = listCache.get(cacheKey);
    if (!entry) {
      const promise = fetchOptions('');
      entry = { promise };
      listCache.set(cacheKey, entry);
      promise.then((o) => { entry!.options = o; }).catch(() => listCache.delete(cacheKey));
    }
    if (entry.options) { setOptions(entry.options); return; }
    setLoading(true);
    try {
      const res = await entry.promise;
      if (alive.current) setOptions(res);
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  // Есть ли выбранное значение (учитываем multiple)
  const value = (rest as any).value;
  const hasValue = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';

  // Значение задано, а подписи для него нет — грузим список, иначе на экране будет id
  const missingLabel = useMemo(() => {
    if (!hasValue) return false;
    const vals: any[] = Array.isArray(value) ? value : [value];
    return vals.some((v) => !options.some((o) => o.value === v));
  }, [hasValue, value, options]);

  useEffect(() => {
    if (!missingLabel || loaded.current || serverSearch) return;
    loaded.current = true;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingLabel]);

  // перезагрузка по сигналу (инлайн-создание и т.п.) — сбрасываем кеш и грузим
  useEffect(() => {
    if (reloadSignal === undefined) return;
    if (cacheKey) listCache.delete(cacheKey);
    loaded.current = true;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // ленивая загрузка — при первом открытии дропдауна
  const handleDropdownVisibleChange = (open: boolean) => {
    if (open && !loaded.current) {
      loaded.current = true;
      loadAll();
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
