import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packCourse } from '../app/lib/pack-course.js';
import { memoryWriter, collectWriter, directoryWriter, zipWriter } from '../app/lib/writers.js';
import { buildCourse } from '../app/lib/build-course.js';
import { selectContent } from '../app/lib/select.js';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { unlock, openJson, newPackId } from '../app/lib/crypto.js';
import { readRange } from '../app/lib/container.js';
import { makeExport, zipLib, fixture, fixtureBlob } from './helpers/make-export.js';
import { sampleFiles, SAME_PDF } from './helpers/sample-course.js';

const NOW = new Date('2026-11-17T12:00:00Z');
const NAME_RULE = /^(index\.html|key\.json|course-[0-9a-f]{8}\.bin|data-[0-9a-f]{8}-\d{3}\.bin)$/;

async function prepare(blob) {
  const zip = await openZip(zipLib, blob);
  const raw = await readExport(zip);
  const sel = selectContent(raw, { now: NOW, exclude: new Set() });
  const built = buildCourse(raw, sel, { packId: newPackId(), instructor: { name: 'Dr. Rivera', email: 'r@example.edu' }, now: NOW });
  return { zip, raw, built };
}
const sampleBlob = async () => new Blob([await makeExport(sampleFiles())]);

async function reopen(out, password) {
  const keyJson = JSON.parse(new TextDecoder().decode(out.files.get('key.json')));
  const key = await unlock(keyJson, password);
  const course = await openJson(key, out.files.get(keyJson.course));
  const fetchBytes = async (name, offset, length) => out.files.get(name).slice(offset, offset + length);
  const readFile = (fileId) => {
    const entry = course.files[fileId];
    return readRange({ key, fileId: entry.same || fileId, entry, bundles: course.bundles, fetchBytes }, 0, entry.size - 1);
  };
  return { keyJson, course, readFile };
}

test('packs the made-up course into memory and reads it back', async () => {
  const { zip, built } = await prepare(await sampleBlob());
  const out = memoryWriter();
  const progress = [];
  const result = await packCourse({ zip, built, password: 'maple river', out, onProgress: (d, t) => progress.push([d, t]) });
  assert.ok(result.files.includes('key.json'));
  for (const name of out.files.keys()) assert.match(name, NAME_RULE);
  const { keyJson, course, readFile } = await reopen(out, 'maple river');
  assert.equal(keyJson.title, 'Ocean Studies 101');
  assert.equal(course.title, 'Ocean Studies 101');
  assert.deepEqual(await readFile('f1'), SAME_PDF);
  assert.deepEqual(await readFile('f7'), SAME_PDF, 'the duplicate reads through its original');
  assert.deepEqual(await readFile('f2'), await zip.bytes('web_resources/Uploaded Media/photo (1).jpg'));
  assert.ok(progress.length > 0);
  assert.equal(progress[progress.length - 1][0], progress[progress.length - 1][1]);
  assert.match(new TextDecoder().decode(out.files.get('index.html')), /<!doctype html>/i);
});

test('two packs use different data file names, and each key file names its own course file', async () => {
  const a = memoryWriter();
  const b = memoryWriter();
  const first = await prepare(await sampleBlob());
  await packCourse({ ...first, password: null, out: a });
  const second = await prepare(await sampleBlob());
  await packCourse({ ...second, password: null, out: b });
  const dataA = [...a.files.keys()].filter((n) => n.endsWith('.bin'));
  const dataB = [...b.files.keys()].filter((n) => n.endsWith('.bin'));
  assert.equal(dataA.filter((n) => dataB.includes(n)).length, 0);
  for (const out of [a, b]) {
    const keyJson = JSON.parse(new TextDecoder().decode(out.files.get('key.json')));
    assert.ok(out.files.has(keyJson.course));
  }
});

test('only course files reach the writer, never a tracker', async () => {
  const { zip, built } = await prepare(await sampleBlob());
  const out = memoryWriter();
  await packCourse({ zip, built, password: null, out });
  for (const name of out.files.keys()) assert.match(name, NAME_RULE);
});

test('the collecting writer keeps every file for upload without copying it', async () => {
  const { zip, built } = await prepare(await sampleBlob());
  const out = collectWriter();
  await packCourse({ zip, built, password: null, out });
  for (const name of out.files.keys()) assert.match(name, NAME_RULE);
  const bundle = [...out.files.entries()].find(([name]) => name.startsWith('data-'));
  assert.ok(bundle[1] instanceof Blob, 'bundles stay Blobs, so the browser can keep them on disk');
});

test('the zip writer stores the course files at the top of the zip', async () => {
  const { zip, built } = await prepare(await sampleBlob());
  const out = zipWriter(zipLib);
  await packCourse({ zip, built, password: null, out });
  const blob = await out.close();
  const back = await openZip(zipLib, blob);
  assert.ok(back.names.length > 3);
  for (const name of back.names) assert.match(name, NAME_RULE);
});

// A stand-in for the browser's folder handles, for testing directoryWriter.
function fakeFolder(initial = {}) {
  const children = new Map(Object.entries(initial));
  return {
    kind: 'directory',
    children,
    async getDirectoryHandle(name, { create } = {}) {
      if (!children.has(name)) {
        if (!create) throw new Error('NotFoundError');
        children.set(name, fakeFolder());
      }
      return children.get(name);
    },
    async getFileHandle(name) {
      return {
        createWritable: async () => {
          const parts = [];
          return { write: async (d) => parts.push(d), close: async () => children.set(name, new Blob(parts)) };
        },
      };
    },
    async removeEntry(name) { children.delete(name); },
    async *keys() { yield* children.keys(); },
  };
}

test('the folder writer creates the course folder and replaces an old pack only when asked', async () => {
  const parent = fakeFolder({ 'ocean-101': fakeFolder({ 'data-aaaaaaaa-000.bin': new Blob(['old']), 'notes.txt': new Blob(['mine']) }) });
  await assert.rejects(directoryWriter(parent, 'ocean-101'), (e) => e.code === 'folder-exists');
  const out = await directoryWriter(parent, 'ocean-101', { replace: true });
  await out.write('key.json', new TextEncoder().encode('{}'));
  await out.close();
  const folder = parent.children.get('ocean-101');
  assert.equal(folder.children.has('data-aaaaaaaa-000.bin'), false, 'old pack data removed');
  assert.equal(folder.children.has('notes.txt'), true, 'other files left alone');
  assert.equal(folder.children.has('key.json'), true);
  const fresh = await directoryWriter(parent, 'new-course');
  await fresh.write('key.json', new TextEncoder().encode('{}'));
  assert.ok(parent.children.get('new-course').children.has('key.json'));
});

test('real GC packs under the GitHub limits and leaks no names', { skip: !fixture('gc') }, async () => {
  const { zip, raw, built } = await prepare(fixtureBlob('gc'));
  const out = memoryWriter();
  await packCourse({ zip, built, password: 'maple river canyon sound', out });
  assert.ok(out.files.size <= 100, `${out.files.size} files`);
  for (const [name, bytes] of out.files) assert.ok(bytes.length < 26214400, `${name} is ${bytes.length} bytes`);
  const secrets = ['Corey', 'Liberation'];
  for (const p of Object.values(raw.pages)) if (p.title.length >= 8) secrets.push(p.title);
  for (const f of Object.values(raw.files)) if (f.name.length >= 8) secrets.push(f.name);
  const needles = secrets.flatMap((s) => [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')]);
  for (const [name, bytes] of out.files) {
    const hay = Buffer.from(bytes);
    for (const needle of needles) {
      if (name === 'key.json' && raw.title.includes(needle.toString('utf8'))) continue;
      assert.equal(hay.indexOf(needle), -1, `${name} contains "${needle.toString(needle.length % 2 ? 'utf8' : 'utf8')}"`);
    }
  }
  const { course, readFile } = await reopen(out, 'maple river canyon sound');
  const pdf = Object.entries(course.files).find(([, f]) => f.mime === 'application/pdf');
  const original = raw.files[pdf[0]];
  assert.deepEqual(await readFile(pdf[0]), await zip.bytes(original.path));
});
