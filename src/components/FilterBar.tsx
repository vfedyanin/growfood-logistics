'use client';

import React from 'react';
import { Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

export interface FilterBarProps {
  children: React.ReactNode;
  onReset?: () => void;
  resetLabel?: string;
  extra?: React.ReactNode;
}

/** Горизонтальная панель фильтров (даты, селекты, мульти-селекты). */
export default function FilterBar({ children, onReset, resetLabel = 'Сбросить', extra }: FilterBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        padding: 12,
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <Space wrap size={8} style={{ flex: 1 }}>
        {children}
      </Space>
      {extra}
      {onReset && (
        <Button icon={<ReloadOutlined />} onClick={onReset}>
          {resetLabel}
        </Button>
      )}
    </div>
  );
}
