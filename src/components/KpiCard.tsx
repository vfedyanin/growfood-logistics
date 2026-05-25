'use client';

import React from 'react';
import { Card, Statistic, Skeleton, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InfoCircleOutlined } from '@ant-design/icons';

export interface KpiCardProps {
  label: React.ReactNode;
  value: number | string;
  /** Поясняющая подсказка (иконка ⓘ). */
  hint?: string;
  /** Тренд в % к прошлому периоду (>0 рост, <0 падение). */
  trend?: number | null;
  /** «Хорошо» ли когда тренд растёт. По умолчанию true. Для расходов можно false. */
  trendPositiveIsGood?: boolean;
  suffix?: string;
  prefix?: string;
  precision?: number;
  loading?: boolean;
}

export default function KpiCard({
  label,
  value,
  hint,
  trend,
  trendPositiveIsGood = true,
  suffix,
  prefix,
  precision,
  loading,
}: KpiCardProps) {
  const showTrend = trend != null && Number.isFinite(trend);
  const up = (trend ?? 0) >= 0;
  const good = up === trendPositiveIsGood;
  const trendColor = good ? '#3f8600' : '#cf1322';

  return (
    <Card size="small" style={{ height: '100%' }}>
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: '60%' }} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>{label}</span>
            {hint && (
              <Tooltip title={hint}>
                <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.3)', fontSize: 12 }} />
              </Tooltip>
            )}
          </div>
          <Statistic value={value} precision={precision} prefix={prefix} suffix={suffix} />
          {showTrend && (
            <div style={{ color: trendColor, fontSize: 12, marginTop: 4 }}>
              {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(trend!).toFixed(1)}%
            </div>
          )}
        </>
      )}
    </Card>
  );
}
