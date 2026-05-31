// Устанавливает DATABASE_URL (pooled) и DATABASE_URL_UNPOOLED (без -pooler) в .env.
// Использование: node scripts/set-both-urls.js "<pooled_url>"
const fs = require('fs');
const pooled = process.argv[2];
if (!pooled) { console.error('нет URL'); process.exit(1); }
const unpooled = pooled.replace('-pooler', '');
let txt = fs.readFileSync('.env', 'utf8');
const setLine = (key, val) => {
  const line = `${key}="${val}"`;
  if (new RegExp(`^${key}=.*$`, 'm').test(txt)) txt = txt.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  else txt = txt.trimEnd() + '\n' + line + '\n';
};
setLine('DATABASE_URL', pooled);
setLine('DATABASE_URL_UNPOOLED', unpooled);
fs.writeFileSync('.env', txt);
const host = (pooled.match(/@([^/?:]+)/) || [])[1];
console.log('OK. host:', host);
console.log('keys:', txt.split('\n').filter(Boolean).map((l) => l.split('=')[0]).join(','));
