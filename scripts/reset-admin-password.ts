import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const p = new PrismaClient();
async function main() {
  const hash = bcrypt.hashSync('admin123', 10);
  const r = await p.user.update({
    where: { email: 'admin@growfood.ru' },
    data: { passwordHash: hash },
    select: { id: true, email: true },
  });
  console.log('Password reset for:', r.email);
}
main().catch(console.error).finally(() => p.$disconnect());
