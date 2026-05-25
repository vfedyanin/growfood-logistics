'use client';

import React from 'react';
import { Result } from 'antd';
import { ToolOutlined } from '@ant-design/icons';

export default function Placeholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Result
      icon={<ToolOutlined />}
      title={title}
      subTitle={subtitle ?? 'Раздел в разработке — будет реализован на следующих шагах.'}
    />
  );
}
