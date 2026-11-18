import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, readingOrder } from '../app/viewer/order.js';
import { sampleBuilt } from './helpers/sample-built.js';

test('reading order follows the modules and skips headers and outside links', async () => {
  const { course } = await sampleBuilt();
  assert.deepEqual(readingOrder(course).map((e) => e.ref), ['pg1', 'f1', 'as1', 'dt1', 'qz1', 'i7', 'pg3']);
});

test('neighbors cross module boundaries', async () => {
  const { course } = await sampleBuilt();
  const first = neighbors(course, 'pg1');
  assert.equal(first.prev, null);
  assert.equal(first.next.ref, 'f1');
  const tool = neighbors(course, 'i7');
  assert.equal(tool.prev.ref, 'qz1');
  assert.equal(tool.next.ref, 'pg3');
  assert.equal(neighbors(course, 'pg3').next, null);
});

test('content outside the modules has no neighbors', async () => {
  const { course } = await sampleBuilt();
  assert.deepEqual(neighbors(course, 'pg5'), { prev: null, next: null });
});
