'use client';

import React, { useMemo, useState } from 'react';
import { Table, Input, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';

const { Title } = Typography;

export interface DataTableProps<T> {
  columns: TableProps<T>['columns'];
  data: T[];
  loading?: boolean;
  rowKey?: string;
  /** Поля для клиентского поиска по строке. */
  searchableKeys?: string[];
  searchPlaceholder?: string;
  /** Заголовок над таблицей. */
  title?: React.ReactNode;
  /** Кнопки действий справа от заголовка (например «Добавить»). */
  toolbar?: React.ReactNode;
  pageSize?: number;
  scrollX?: number;
  size?: TableProps<T>['size'];
  rowSelection?: TableProps<T>['rowSelection'];
}

function getByPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  rowKey = 'id',
  searchableKeys,
  searchPlaceholder = 'Поиск...',
  title,
  toolbar,
  pageSize = 20,
  scrollX = 800,
  size = 'middle',
  rowSelection,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);

  const filtered = useMemo(() => {
    if (!search || !searchableKeys?.length) return data;
    const q = search.toLowerCase();
    return data.filter((row) =>
      searchableKeys.some((k) => {
        const v = getByPath(row, k);
        return v != null && String(v).toLowerCase().includes(q);
      }),
    );
  }, [data, search, searchableKeys]);

  return (
    <>
      {(title || toolbar || searchableKeys?.length) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {title ? <Title level={4} style={{ margin: 0 }}>{title}</Title> : <span />}
          <Space wrap>
            {searchableKeys?.length ? (
              <Input
                placeholder={searchPlaceholder}
                prefix={<SearchOutlined />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 220 }}
                allowClear
              />
            ) : null}
            {toolbar}
          </Space>
        </div>
      )}
      <Table<T>
        columns={columns}
        dataSource={filtered}
        rowKey={rowKey}
        loading={loading}
        size={size}
        rowSelection={rowSelection}
        scroll={{ x: scrollX }}
        pagination={{
          pageSize: currentPageSize,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100', '200'],
          showTotal: (t) => `Всего: ${t}`,
          onShowSizeChange: (_, size) => setCurrentPageSize(size),
        }}
      />
    </>
  );
}
