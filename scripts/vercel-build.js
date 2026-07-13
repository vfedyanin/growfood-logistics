// Сборка на Vercel: применяем миграции, на preview — дополнительно сидим
// демо-данными, затем собираем Next.
// Прод (VERCEL_ENV=production) НЕ сидируется.
const { execSync } = require('child_process');
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('prisma generate');
run('prisma migrate deploy');

if (process.env.VERCEL_ENV === 'preview') {
  console.log('[vercel-build] preview-окружение → засеваем демо-данные (prisma db seed)');
  run('prisma db seed');
}

run('next build');
