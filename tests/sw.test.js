// sw.js is a classic script (service workers cannot always load modules), so it
// carries its own copies of a few library functions. These tests check that
// the copies give the same answers as the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseRange, piecePlan } from '../app/lib/container.js';
import { inlineType } from '../app/lib/mime.js';
import { PIECE_SIZE } from '../app/lib/crypto.js';

function loadWorker() {
  const listeners = {};
  const self = {
    location: { origin: 'https://example.github.io' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    clients: {},
  };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, console, URL, Headers: class {}, Response: class {} });
  return { internals: self.cbsInternals, listeners };
}

test('the service worker listens for install, activate, message, and fetch', () => {
  const { listeners } = loadWorker();
  for (const type of ['install', 'activate', 'message', 'fetch']) assert.equal(typeof listeners[type], 'function', type);
});

test('parseRange matches the library', () => {
  const { internals } = loadWorker();
  const cases = [[null, 1000], ['bytes=0-', 1000], ['bytes=-500', 1000], ['bytes=-5000', 1000], ['bytes=10-20', 1000],
    ['bytes=990-5000', 1000], ['bytes=1000-', 1000], ['bytes=20-10', 1000], ['items=0-1', 1000]];
  for (const [header, size] of cases) {
    assert.deepEqual(JSON.parse(JSON.stringify(internals.parseRange(header, size))), parseRange(header, size), String(header));
  }
});

test('piecePlan matches the library', () => {
  const { internals } = loadWorker();
  const enc = PIECE_SIZE + 28;
  const entry = { size: Math.floor(3.5 * PIECE_SIZE), pieces: [[0, 0, 2], [1, 0, 2]] };
  const ranges = [[0, 10], [PIECE_SIZE - 10, PIECE_SIZE + 10], [2 * PIECE_SIZE, entry.size - 1], [0, entry.size - 1]];
  for (const [s, e] of ranges) {
    assert.deepEqual(JSON.parse(JSON.stringify(internals.piecePlan(entry, s, e))), piecePlan(entry, s, e), `${s}-${e}`);
  }
  assert.equal(enc, 1048604);
});

test('inlineType matches the library', () => {
  const { internals } = loadWorker();
  for (const mime of ['application/pdf', 'image/png', 'image/svg+xml', 'text/html', 'text/plain', 'video/mp4', 'audio/mpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']) {
    assert.equal(internals.inlineType(mime), inlineType(mime), mime);
  }
});

test('the file address pattern finds the course folder and file id', () => {
  const { internals } = loadWorker();
  assert.deepEqual(JSON.parse(JSON.stringify(internals.matchFileUrl('/site/ocean-101/f/f1/Reading%20One.pdf'))),
    { folder: '/site/ocean-101/', fileId: 'f1' });
  assert.equal(internals.matchFileUrl('/site/ocean-101/data-0a1b2c3d-000.bin'), null);
  assert.equal(internals.matchFileUrl('/site/app/viewer/main.js'), null);
});
