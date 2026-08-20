// Сборка на Vercel: применяем миграции и собираем Next.
//
// Сид на сборке НЕ запускается — ни на проде, ни на preview.
// Preview смотрит в постоянную ветку Neon (не в одноразовую ветку под каждый PR),
// поэтому prisma/seed.ts на каждой сборке делал upsert с `update` по справочникам
// и откатывал правки, внесённые вручную при тестировании, а также заново заводил
// демо-учётку с общеизвестным паролем. Данные в preview-ветку кладём через
// reset ветки от production в Neon, а не сидом.
// Нужно засеять руками — `npx prisma db seed` локально на нужной строке подключения.
const { execSync } = require('child_process');
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('prisma generate');
run('prisma migrate deploy');
run('next build');
