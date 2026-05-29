import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.customerRequest.count()
  .then(n => { console.log('DB OK, count:', n); })
  .catch(e => { console.error('DB ERROR:', e.message); })
  .finally(() => p.$disconnect());
