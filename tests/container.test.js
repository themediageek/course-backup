import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKeyFile, PIECE_SIZE } from '../app/lib/crypto.js';
import { BundleWriter, piecePlan, readRange, parseRange } from '../app/lib/container.js';

function randomBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}
function streamOf(data, chunk = 300000) {
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= data.length) return controller.close();
      controller.enqueue(data.slice(pos, pos + chunk));
      pos += chunk;
    },
  });
}
function memoryOut() {
  const files = new Map();
  return {
    files,
    async write(name, data) {
      files.set(name, data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data);
    },
    async close() {},
  };
}

const SIZE = Math.floor(3.5 * PIECE_SIZE);
const ENC = PIECE_SIZE + 28;

async function packOne(maxBytes) {
  const { key } = await makeKeyFile({ title: 'T', packId: 'cafe0123', password: null });
  const out = memoryOut();
  const writer = new BundleWriter({ key, packId: 'cafe0123', out, maxBytes });
  const data = randomBytes(SIZE);
  const pieces = await writer.addFile('f1', streamOf(data), SIZE);
  const bundles = await writer.finish();
  const entry = { size: SIZE, pieces };
  const fetchBytes = async (name, offset, length) => out.files.get(name).slice(offset, offset + length);
  return { key, out, data, pieces, bundles, entry, fetchBytes };
}

test('a 3.5 MiB file becomes 4 pieces', async () => {
  const { pieces, bundles } = await packOne(undefined);
  assert.deepEqual(pieces, [[0, 0, 4]]);
  assert.deepEqual(bundles, ['data-cafe0123-000.bin']);
});

test('pieces span bundles but are never split', async () => {
  const max = Math.floor(2.5 * ENC);
  const { pieces, bundles, out } = await packOne(max);
  assert.deepEqual(pieces, [[0, 0, 2], [1, 0, 2]]);
  assert.deepEqual(bundles, ['data-cafe0123-000.bin', 'data-cafe0123-001.bin']);
  assert.equal(out.files.get(bundles[0]).length, 2 * ENC);
  assert.equal(out.files.get(bundles[1]).length, ENC + (SIZE - 3 * PIECE_SIZE) + 28);
  for (const b of out.files.values()) assert.ok(b.length <= max);
});

test('a second file continues the current bundle', async () => {
  const { key } = await makeKeyFile({ title: 'T', packId: 'cafe0123', password: null });
  const out = memoryOut();
  const writer = new BundleWriter({ key, packId: 'cafe0123', out });
  const a = await writer.addFile('a', streamOf(randomBytes(1000)), 1000);
  const b = await writer.addFile('b', streamOf(randomBytes(2000)), 2000);
  assert.deepEqual(a, [[0, 0, 1]]);
  assert.deepEqual(b, [[0, 1028, 1]]);
  assert.deepEqual(await writer.finish(), ['data-cafe0123-000.bin']);
});

test('a stream shorter than the stated size is an error', async () => {
  const { key } = await makeKeyFile({ title: 'T', packId: 'cafe0123', password: null });
  const writer = new BundleWriter({ key, packId: 'cafe0123', out: memoryOut() });
  await assert.rejects(writer.addFile('a', streamOf(randomBytes(10)), 20));
});

test('readRange returns the right bytes inside, across pieces, and across bundles', async () => {
  const { key, data, entry, bundles, fetchBytes } = await packOne(Math.floor(2.5 * ENC));
  const read = (start, end) => readRange({ key, fileId: 'f1', entry, bundles, fetchBytes }, start, end);
  const cases = [[100, 200], [PIECE_SIZE - 10, PIECE_SIZE + 10], [2 * PIECE_SIZE - 5, 2 * PIECE_SIZE + 5], [0, SIZE - 1], [SIZE - 1, SIZE - 1]];
  for (const [start, end] of cases) {
    assert.deepEqual(await read(start, end), data.slice(start, end + 1), `${start}-${end}`);
  }
});

test('piecePlan lists only the pieces a range needs', async () => {
  const { entry } = await packOne(Math.floor(2.5 * ENC));
  assert.deepEqual(piecePlan(entry, 0, 10), [{ bundle: 0, offset: 0, length: ENC, index: 0 }]);
  assert.deepEqual(piecePlan(entry, 2 * PIECE_SIZE, 3 * PIECE_SIZE + 1).map((p) => [p.bundle, p.offset, p.index]),
    [[1, 0, 2], [1, ENC, 3]]);
  assert.equal(piecePlan(entry, 3 * PIECE_SIZE, SIZE - 1)[0].length, SIZE - 3 * PIECE_SIZE + 28);
});

test('parseRange', () => {
  assert.equal(parseRange(null, 1000), null);
  assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=-500', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=10-20', 1000), { start: 10, end: 20 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'invalid');
  assert.equal(parseRange('bytes=20-10', 1000), 'invalid');
  assert.equal(parseRange('items=0-1', 1000), null);
});
