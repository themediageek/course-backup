// Copies the pinned browser builds of outside libraries into vendor/,
// so the published site loads nothing from other servers.
// Run with: npm run vendor
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');

const copies = [
  ['@zip.js/zip.js/dist/zip-native.min.js', 'zip.min.js'],
  ['dompurify/dist/purify.es.mjs', 'purify.es.mjs'],
  ['exceljs/dist/exceljs.min.js', 'exceljs.min.js'],
];
for (const weight of ['400', '700']) {
  for (const style of ['normal', 'italic']) {
    const name = `atkinson-hyperlegible-latin-${weight}-${style}.woff2`;
    copies.push([`@fontsource/atkinson-hyperlegible/files/${name}`, `fonts/${name}`]);
  }
}

// License texts travel with the copied files.
copies.push(
  ['@zip.js/zip.js/LICENSE', 'licenses/zip.js.txt'],
  ['dompurify/LICENSE', 'licenses/dompurify.txt'],
  ['exceljs/LICENSE', 'licenses/exceljs.txt'],
  ['@fontsource/atkinson-hyperlegible/LICENSE', 'licenses/atkinson-hyperlegible.txt'],
);

for (const [from, to] of copies) {
  const dest = join(root, 'vendor', to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(nm, from), dest);
  console.log(`vendor/${to}`);
}
