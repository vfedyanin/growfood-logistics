const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const r = await prisma.customerRequest.delete({ where: { requestNumber: 'REQ-20260403-001' } });
  console.log('Удалена заявка:', r.requestNumber);
}
main().catch(e => console.error(e.message)).finally(() => prisma.$disconnect());
