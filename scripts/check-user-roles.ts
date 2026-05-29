import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
async function main() {
  const user = await p.user.findUnique({
    where: { email: 'admin@growfood.ru' },
    include: {
      roles: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      },
    },
  });
  if (!user) { console.log('USER NOT FOUND'); return; }
  console.log('Email:', user.email);
  console.log('isActive:', user.isActive);
  console.log('passwordHash set:', !!user.passwordHash);
  console.log('Roles:', JSON.stringify(user.roles.map(ur => ur.role.name)));
  console.log('Permissions count:', user.roles.flatMap(ur => ur.role.permissions).length);
}
main().catch(e => console.error('ERROR:', e.message)).finally(() => p.$disconnect());
