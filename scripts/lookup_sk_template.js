const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Шаблоны заявок
  const templates = await prisma.requestTemplate.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log('\n=== Шаблоны заявок ===');
  templates.forEach(t => console.log(`  ${t.id}  |  ${t.name}`));

  // Поиск шаблона СК - Пятёрочка НН
  const tpl = templates.find(t => t.name.toLowerCase().includes('ск') && t.name.toLowerCase().includes('пятёрочка'));
  if (tpl) {
    const full = await prisma.requestTemplate.findUnique({ where: { id: tpl.id } });
    console.log('\n=== Данные шаблона «' + tpl.name + '» ===');
    console.log(JSON.stringify(full.data, null, 2));
  }

  // Клиенты АО СК
  const customers = await prisma.customer.findMany({
    where: { name: { contains: 'СК', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  console.log('\n=== Клиенты «*СК*» ===');
  customers.forEach(c => console.log(`  ${c.id}  |  ${c.name}`));

  // Локации Пятёрочка НН
  const locs = await prisma.location.findMany({
    where: { name: { contains: 'Пятёрочка', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  console.log('\n=== Локации «*Пятёрочка*» ===');
  locs.forEach(l => console.log(`  ${l.id}  |  ${l.name}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
