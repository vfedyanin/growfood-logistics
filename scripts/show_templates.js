const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const req = await prisma.requestTemplate.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const trip = await prisma.tripTemplate.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  console.log('\n=== Шаблоны ЗАЯВОК ===');
  req.forEach(t => console.log(`  ${t.name}`));
  console.log('\n=== Шаблоны РЕЙСОВ ===');
  trip.forEach(t => console.log(`  ${t.name}`));
}
main().catch(e => console.error(e.message)).finally(() => prisma.$disconnect());
