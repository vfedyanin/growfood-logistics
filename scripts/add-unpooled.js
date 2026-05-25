// Добавляет/обновляет DATABASE_URL_UNPOOLED в .env, выводя его из DATABASE_URL
// (убирает "-pooler" из хоста). Секреты не печатает.
const fs = require('fs');
const path = process.argv[2] || '.env';
let txt = fs.readFileSync(path, 'utf8');
const m = txt.match(/^DATABASE_URL=(.*)$/m);
if (!m) { console.error('нет DATABASE_URL'); process.exit(1); }
const unpooled = m[1].replace('-pooler', '');
const line = `DATABASE_URL_UNPOOLED=${unpooled}`;
if (/^DATABASE_URL_UNPOOLED=.*$/m.test(txt)) txt = txt.replace(/^DATABASE_URL_UNPOOLED=.*$/m, line);
else txt = txt.replace(/^(DATABASE_URL=.*)$/m, `$1\n${line}`);
fs.writeFileSync(path, txt);
const host = (unpooled.match(/@([^/?]+)/) || [])[1];
console.log(path, '-> DATABASE_URL_UNPOOLED host:', host);
