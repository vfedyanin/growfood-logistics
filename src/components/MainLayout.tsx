'use client';

import React, { useState } from 'react';
import { Layout, Menu, Button, Dropdown, Avatar, Grid } from 'antd';
import {
  DashboardOutlined,
  CarOutlined,
  BookOutlined,
  DollarOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  EnvironmentOutlined,
  TeamOutlined,
  AppstoreOutlined,
  ShopOutlined,
  FileTextOutlined,
  CreditCardOutlined,
  IdcardOutlined,
  NodeIndexOutlined,
  ContainerOutlined,
  SettingOutlined,
  SnippetsOutlined,
  PlusSquareOutlined,
} from '@ant-design/icons';
import { useRouter, usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import type { MenuProps } from 'antd';

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

type MenuItem = Required<MenuProps>['items'][number];

function getItem(
  label: React.ReactNode,
  key: string,
  icon?: React.ReactNode,
  children?: MenuItem[],
): MenuItem {
  return { key, icon, children, label } as MenuItem;
}

const menuItems: MenuItem[] = [
  getItem('Дашборд', '/dashboard', <DashboardOutlined />),
  getItem('Операции', '/operations', <CarOutlined />, [
    getItem('Заявки', '/requests'),
    getItem('Рейсы', '/operations/trips'),
    getItem('Груз', '/operations/cargo'),
  ]),
  getItem('Справочники', '/references', <BookOutlined />, [
    getItem('Шаблоны', '/references/templates', <SnippetsOutlined />),
    getItem('Вертикали', '/references/verticals', <AppstoreOutlined />),
    getItem('Локации', '/references/locations', <EnvironmentOutlined />),
    getItem('Контрагенты', '/references/customers', <ShopOutlined />),
    getItem('Перевозчики', '/references/carriers', <TeamOutlined />),
    getItem('Типы ТС', '/references/vehicle-types', <CarOutlined />),
    getItem('Доп. услуги', '/references/additional-services', <PlusSquareOutlined />),
    getItem('Транспорт', '/references/vehicles', <ContainerOutlined />),
    getItem('Водители', '/references/drivers', <IdcardOutlined />),
    getItem('Маршруты', '/references/routes', <NodeIndexOutlined />),
    getItem('Договоры (клиенты)', '/references/customer-contracts', <FileTextOutlined />),
    getItem('Договоры (перевозчики)', '/references/carrier-contracts', <FileTextOutlined />),
    getItem('Тарифы', '/references/tariffs', <CreditCardOutlined />),
    getItem('Рыночные цены', '/references/market-prices', <DollarOutlined />),
  ]),
  getItem('Финансы', '/finance', <DollarOutlined />, [
    getItem('Экономика рейсов', '/finance/trip-economics', <DollarOutlined />),
    getItem('Акты перевозчиков', '/finance/carrier-acts', <FileTextOutlined />),
    getItem('Счета за перевозки', '/finance/carrier-invoices', <CreditCardOutlined />),
    getItem('Счета клиентам', '/finance/customer-invoices', <CreditCardOutlined />),
  ]),
];

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const screens = useBreakpoint();
  // На первом рендере useBreakpoint возвращает {} (всё undefined) — считаем это десктопом,
  // чтобы сайдбар не «прятался» на десктопе до резолва брейкпоинта.
  const isMobile = screens.md === false;

  const handleMenuClick = (e: { key: string }) => {
    router.push(e.key);
    if (isMobile) setMobileOpen(false);
  };

  const perms: string[] = (session?.user as any)?.permissions ?? [];
  const roles: string[] = (session?.user as any)?.roles ?? [];
  const showAdmin = roles.includes('ADMIN') || perms.includes('users.manage');
  const menuItemsView: MenuItem[] = showAdmin
    ? [...menuItems, getItem('Администрирование', '/admin', <SettingOutlined />, [
        getItem('Пользователи', '/admin/users', <TeamOutlined />),
      ])]
    : menuItems;

  const selectedKeys = [pathname];
  const openKeys = menuItemsView
    .filter((item: any) => item?.children && pathname.startsWith(item.key as string))
    .map((item: any) => item.key as string);

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: session?.user?.name || 'Пользователь',
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Выйти',
      onClick: () => signOut({ callbackUrl: '/login' }),
    },
  ];

  const siderWidth = 256;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {isMobile && mobileOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <Sider
        trigger={null}
        collapsible
        collapsed={isMobile ? !mobileOpen : collapsed}
        collapsedWidth={isMobile ? 0 : 80}
        width={siderWidth}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 200,
        }}
      >
        <div className={`logo ${collapsed ? 'logo-collapsed' : ''}`}>
          {collapsed && !isMobile ? 'GF' : 'GrowFood Logistics'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKeys}
          defaultOpenKeys={openKeys}
          items={menuItemsView}
          onClick={handleMenuClick}
        />
      </Sider>
      <Layout
        className="site-layout"
        style={{
          marginLeft: isMobile ? 0 : collapsed ? 80 : siderWidth,
          transition: 'margin-left 0.2s',
        }}
      >
        <Header
          style={{
            padding: '0 16px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 99,
          }}
        >
          <Button
            type="text"
            icon={
              isMobile
                ? mobileOpen
                  ? <MenuFoldOutlined />
                  : <MenuUnfoldOutlined />
                : collapsed
                  ? <MenuUnfoldOutlined />
                  : <MenuFoldOutlined />
            }
            onClick={() => {
              if (isMobile) {
                setMobileOpen(!mobileOpen);
              } else {
                setCollapsed(!collapsed);
              }
            }}
            style={{ fontSize: '16px', width: 48, height: 48 }}
          />
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              {!isMobile && (session?.user?.name || 'Пользователь')}
            </Button>
          </Dropdown>
        </Header>
        <Content
          style={{
            margin: 16,
            padding: 24,
            background: '#fff',
            borderRadius: 8,
            minHeight: 280,
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
