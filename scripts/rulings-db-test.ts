// Every ruling the code cites must exist in the rulings database (edisonrul.ing): each https://edisonrul.ing/cards/...
// link in src/ must be a page of scripts/data/edisonrul.ing-pages.json, and the judge's card -> page index
// (src/cards/rulings-db.generated.ts) must name only cards of the pool. Refresh both with scripts/import-rulings-db.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allCards } from '../src/cards';
import { RULINGS_DB, rulingsPage } from '../src/cards/rulings-db.generated';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { pages } = JSON.parse(readFileSync(join(ROOT, 'scripts/data/edisonrul.ing-pages.json'), 'utf8')) as { pages: Record<string, 0 | 1> };

const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|css|html)$/.test(f)) files.push(p);
  }
};
walk(join(ROOT, 'src'));

const errors: string[] = [];
let links = 0;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/https:\/\/edisonrul\.ing\/cards\/([a-z0-9-]+\/[^\s)"'`,;#]+?)\.html/g)) {
      links++;
      if (!(m[1] in pages)) errors.push(`${relative(ROOT, f)}:${i + 1}: no such page in the rulings database: ${m[0]}`);
    }
  });
}

const pool = new Set(allCards().map((c) => c.name));
for (const [name, path] of Object.entries(RULINGS_DB)) {
  if (!pool.has(name)) errors.push(`rulings-db.generated.ts: "${name}" is not a card of the pool (re-run scripts/import-rulings-db.ts)`);
  if (!(path in pages)) errors.push(`rulings-db.generated.ts: "${name}" -> ${path} is not a page`);
}
if (rulingsPage('Sangan') !== 'https://edisonrul.ing/cards/s/sangan.html') errors.push('rulingsPage("Sangan") is wrong');
const indexed = [...pool].filter((n) => RULINGS_DB[n]).length;

if (errors.length) {
  console.log(errors.join('\n'));
  console.log(`\nrulings-db-test: ${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`rulings-db-test: ${links} edisonrul.ing links in src/ all exist; ${indexed}/${pool.size} pool cards have a database page`);
