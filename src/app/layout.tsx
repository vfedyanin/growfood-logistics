import type { Metadata } from 'next';
import { ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import StyledComponentsRegistry from '@/lib/AntdRegistry';
import { theme } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'GrowFood Logistics',
  description: 'Система учёта магистральной логистики',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <StyledComponentsRegistry>
          <ConfigProvider locale={ruRU} theme={theme}>
            {children}
          </ConfigProvider>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
