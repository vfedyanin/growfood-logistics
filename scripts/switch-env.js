// Переключает DATABASE_URL в .env между dev и prod, не печатая секреты.
// Использование: node scripts/switch-env.js prod | dev
const fs = require('fs');
const mode = process.argv[2];
const cur = fs.readFileSync('.env', 'utf8');
if (mode === 'prod') {
  fs.writeFileSync('.env.dev.backup', cur); // сохранить текущий dev
  const src = fs.readFileSync('.env.production.backup', 'utf8');
  const m = src.match(/^DATABASE_URL=.*$/m);
  if (!m) { console.error('нет DATABASE_URL в .env.production.backup'); process.exit(1); }
  fs.writeFileSync('.env', cur.replace(/^DATABASE_URL=.*$/m, m[0]));
} else if (mode === 'dev') {
  const dev = fs.readFileSync('.env.dev.backup', 'utf8');
  fs.writeFileSync('.env', dev);
} else {
  console.error('укажи prod или dev'); process.exit(1);
}
const host = (fs.readFileSync('.env', 'utf8').match(/@([^/?]+)/) || [])[1];
console.log('.env ->', mode, '| host:', host);
