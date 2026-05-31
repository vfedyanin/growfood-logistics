import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const users = await p.user.findMany({ select: { id: true, email: true, fullName: true, isActive: true } });
  console.log('Users in DB:', JSON.stringify(users, null, 2));
}
main().catch(console.error).finally(() => p.$disconnect());
