'use client';

import React from 'react';
import { StyleProvider, createCache, extractStyle } from '@ant-design/cssinjs';
import type Entity from '@ant-design/cssinjs/es/Cache';
import { useServerInsertedHTML } from 'next/navigation';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';

// Русская локаль dayjs глобально: antd DatePicker берёт первый день недели
// отсюда, а не из ConfigProvider. Без этого календарь начинался с воскресенья
// на всех страницах, кроме планирования (там локаль ставилась локально).
// В ru-локали weekStart = 1 (понедельник). Провайдер оборачивает всё приложение,
// поэтому вызов на уровне модуля срабатывает один раз до рендера любых пикеров.
dayjs.locale('ru');

const StyledComponentsRegistry = ({ children }: React.PropsWithChildren) => {
  const cache = React.useMemo<Entity>(() => createCache(), []);
  const isServerInserted = React.useRef<boolean>(false);
  useServerInsertedHTML(() => {
    if (isServerInserted.current) {
      return;
    }
    isServerInserted.current = true;
    return <style id="antd" dangerouslySetInnerHTML={{ __html: extractStyle(cache, true) }} />;
  });
  return <StyleProvider cache={cache}>{children}</StyleProvider>;
};

export default StyledComponentsRegistry;
