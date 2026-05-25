'use client';

import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, message, Space } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const { Title, Text } = Typography;

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (result?.error) {
        message.error('Неверный email или пароль');
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    } catch {
      message.error('Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 16,
      }}
    >
      <Card
        style={{
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%', textAlign: 'center' }}>
          <div>
            <Title level={3} style={{ marginBottom: 4 }}>GrowFood Logistics</Title>
            <Text type="secondary">Система учёта логистики</Text>
          </div>
          <Form
            name="login"
            onFinish={onFinish}
            layout="vertical"
            size="large"
            initialValues={{ email: 'admin@growfood.pro' }}
          >
            <Form.Item
              name="email"
              rules={[
                { required: true, message: 'Введите email' },
                { type: 'email', message: 'Некорректный email' },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="Email" />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Введите пароль' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Пароль" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Войти
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
