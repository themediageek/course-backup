// Packs a Canvas export into a course folder from the command line, using the
// same library code as the packing page. For local checks and tests.
//
//   node tools/pack-local.mjs <export.imscc> <out-folder> [--password "four words here"]
//                             [--name "Instructor name"] [--email someone@example.edu]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from 'linkedom';
import * as zipLib from '@zip.js/zip.js';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { selectContent } from '../app/lib/select.js';
import { buildCourse } from '../app/lib/build-course.js';
import { packCourse } from '../app/lib/pack-course.js';
import { newPackId } from '../app/lib/crypto.js';

globalThis.DOMParser ||= DOMParser;
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args.splice(i, 2)[1];
};
const password = flag('password');
const name = flag('name') || '';
const email = flag('email') || '';
const [input, outDir] = args;
if (!input || !outDir) {
  console.error('Usage: node tools/pack-local.mjs <export.imscc> <out-folder> [--password "..."]');
  process.exit(2);
}

const started = Date.now();
const zip = await openZip(zipLib, new Blob([readFileSync(input)]));
const raw = await readExport(zip);
const now = new Date();
const selection = selectContent(raw, { now, exclude: new Set() });
const built = buildCourse(raw, selection, { packId: newPackId(), instructor: { name, email }, now });
mkdirSync(outDir, { recursive: true });
const out = {
  async write(file, data) {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    writeFileSync(join(outDir, file), bytes);
  },
  async close() {},
};
const result = await packCourse({ zip, built, password, out });
console.log(JSON.stringify({
  course: raw.title,
  folder: outDir,
  files: result.files.length,
  megabytes: Number((result.bytes / 1e6).toFixed(1)),
  seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  counts: built.report.counts,
  warnings: built.report.warnings,
}, null, 2));
