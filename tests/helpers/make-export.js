// Test helpers: build small exports in memory and find real exports on the developer's computer.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zipLib from '@zip.js/zip.js';

zipLib.configure({ useWebWorkers: false });
export { zipLib };

export async function makeExport(files) {
  const writer = new zipLib.ZipWriter(new zipLib.Uint8ArrayWriter());
  for (const [name, content] of Object.entries(files)) {
    const reader = typeof content === 'string'
      ? new zipLib.TextReader(content)
      : new zipLib.Uint8ArrayReader(content);
    await writer.add(name, reader);
  }
  return writer.close();
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesFile = join(here, '..', 'fixtures.local.json');

// Path to one of the developer's real exports, or null when this computer lacks it.
export function fixture(name) {
  if (!existsSync(fixturesFile)) return null;
  const paths = JSON.parse(readFileSync(fixturesFile, 'utf8'));
  const path = paths[name];
  return path && existsSync(path) ? path : null;
}

export function fixtureBlob(name) {
  const path = fixture(name);
  return path ? new Blob([readFileSync(path)]) : null;
}
