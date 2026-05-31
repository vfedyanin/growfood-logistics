import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const p = new PrismaClient();
async function main() {
  const user = await p.user.findUnique({
    where: { email: 'admin@growfood.ru' },
    select: { id: true, email: true, passwordHash: true, isActive: true },
  });
  if (!user) { console.log('USER NOT FOUND'); return; }
  console.log('User found:', user.email, '| isActive:', user.isActive);
  console.log('Hash:', user.passwordHash?.substring(0, 20) + '...');
  const ok = await bcrypt.compare('admin123', user.passwordHash ?? '');
  console.log('Password admin123 matches:', ok);

  // Показать DATABASE_URL (без пароля)
  const url = process.env.DATABASE_URL ?? '';
  const sanitized = url.replace(/:([^:@]+)@/, ':***@');
  console.log('DATABASE_URL:', sanitized);
}
main().catch(console.error).finally(() => p.$disconnect());
