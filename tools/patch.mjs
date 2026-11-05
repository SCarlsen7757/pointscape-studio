// Usage: node tools/patch.mjs file "old" "new" [...pairs]  (exact string replacement; fails if not found)
import fs from 'node:fs';
const [file, ...pairs] = process.argv.slice(2);
let s = fs.readFileSync(file, 'utf8');
for (let i = 0; i < pairs.length; i += 2) {
  if (!s.includes(pairs[i])) { console.error('NOT FOUND in', file, ':', pairs[i]); process.exit(1); }
  s = s.replace(pairs[i], pairs[i + 1]);
}
fs.writeFileSync(file, s);
console.log('patched', file);
