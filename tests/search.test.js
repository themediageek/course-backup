import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search } from '../app/viewer/search.js';

const course = {
  items: {
    p1: { type: 'page', title: 'Week 2 readings', html: '<p>Read the essay by Virginia <b>Woolf</b> before class.</p>' },
    p2: { type: 'page', title: 'Woolf and the essay', html: '<p>Notes on form.</p>' },
    p3: { type: 'assignment', title: 'Café journal', html: '<p>Describe a café you visit.</p>' },
    t1: { type: 'tool', title: 'Publisher tool', url: 'https://x' },
  },
  files: {
    f1: { name: 'Woolf - I never meant to say that.pdf', hidden: false },
    f2: { name: 'secret-key.pdf', hidden: true },
  },
};

test('finds a word in a page body and ranks title matches first', () => {
  const results = search(buildIndex(course), 'woolf');
  assert.deepEqual(results.map((r) => r.id), ['p2', 'f1', 'p1']);
  assert.match(results[2].snippet, /Virginia Woolf before class/);
});

test('every word must match, in any order', () => {
  assert.deepEqual(search(buildIndex(course), 'essay virginia').map((r) => r.id), ['p1']);
  assert.deepEqual(search(buildIndex(course), 'virginia nothing'), []);
});

test('accents and case do not matter', () => {
  assert.deepEqual(search(buildIndex(course), 'CAFE').map((r) => r.id), ['p3']);
});

test('hidden files are not searchable, and an empty query finds nothing', () => {
  assert.deepEqual(search(buildIndex(course), 'secret'), []);
  assert.deepEqual(search(buildIndex(course), '   '), []);
});
