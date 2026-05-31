const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const names = ['Йуми - Пятёрочка НН', 'СК - Пятёрочка НН', 'Ингредика - Пятёрочка НН', 'КВ - Пятёрочка НН'];
  for (const name of names) {
    const t = await prisma.requestTemplate.findFirst({ where: { name } });
    console.log(`\n=== ${name} ===`);
    console.log(JSON.stringify(t?.data, null, 2));
  }
}
main().catch(e => console.error(e.message)).finally(() => prisma.$disconnect());
