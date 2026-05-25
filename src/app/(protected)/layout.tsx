import { SessionProvider } from 'next-auth/react';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import MainLayout from '@/components/MainLayout';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect('/login');
  }

  return (
    <SessionProvider session={session}>
      <MainLayout>{children}</MainLayout>
    </SessionProvider>
  );
}
