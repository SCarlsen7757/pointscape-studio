// Usage: node tools/patch.mjs file "old" "new" [...pairs]  (exact string replacement; fails if not found)
// Line endings in "old"/"new" are matched to the file's own (LF or CRLF).
import fs from 'node:fs';
const [file, ...pairs] = process.argv.slice(2);
let s = fs.readFileSync(file, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
const norm = (t) => t.replace(/\r\n/g, '\n').replace(/\n/g, eol);
for (let i = 0; i < pairs.length; i += 2) {
  const from = norm(pairs[i]);
  if (!s.includes(from)) { console.error('NOT FOUND in', file, ':', pairs[i]); process.exit(1); }
  s = s.replace(from, norm(pairs[i + 1]));
}
fs.writeFileSync(file, s);
console.log('patched', file);
