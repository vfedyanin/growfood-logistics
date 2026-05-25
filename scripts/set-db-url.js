const fs = require('fs');
const path = '.env';
const url = process.argv[2];
if (!url) { console.error('no url'); process.exit(1); }
let txt = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const line = `DATABASE_URL="${url}"`;
if (/^DATABASE_URL=.*$/m.test(txt)) {
  txt = txt.replace(/^DATABASE_URL=.*$/m, line);
} else {
  txt = (txt.trim() ? txt.trimEnd() + '\n' : '') + line + '\n';
}
fs.writeFileSync(path, txt);
const keys = txt.split('\n').filter(Boolean).map((l) => l.split('=')[0]);
console.log('OK. Keys in .env:', keys.join(', '));
