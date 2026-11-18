import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestFolder, checkFolder, suggestPassword } from '../publish/naming.js';
import { WORDS } from '../publish/words.js';

test('a course code becomes the folder name', () => {
  assert.equal(suggestFolder('LAS 291/292', 'Global Perspectives'), 'las-291-292');
  assert.equal(suggestFolder('OCN 101', 'Ocean Studies 101'), 'ocn-101');
});

test('a code that is not a course code falls back to the title', () => {
  assert.equal(suggestFolder('dev_jdoe7_104233', 'DEVELOPMENT - LAS 291/292: Global Perspectives for Study Abroad'),
    'development-las-291-292-global');
  assert.equal(suggestFolder('', 'Café Culture & Society'), 'cafe-culture-society');
  assert.equal(suggestFolder('', '!!!'), 'course');
});

test('checkFolder explains what is wrong', () => {
  assert.equal(checkFolder('ocean-101'), null);
  assert.equal(checkFolder(''), 'empty');
  assert.equal(checkFolder('Ocean 101'), 'characters');
  assert.equal(checkFolder('-ocean'), 'characters');
  assert.equal(checkFolder('ocean-'), 'characters');
  assert.equal(checkFolder('a'), 'length');
  assert.equal(checkFolder('a'.repeat(61)), 'length');
  for (const name of ['app', 'pack', 'publish', 'help', 'vendor', 'docs', 'node_modules', 'tests', 'tools', 'test-courses']) {
    assert.equal(checkFolder(name), name === 'node_modules' ? 'characters' : 'reserved', name);
  }
});

test('suggested passwords are four words from the list', () => {
  assert.equal(WORDS.length, 1296);
  const password = suggestPassword(WORDS);
  const parts = password.split(' ');
  assert.equal(parts.length, 4);
  for (const word of parts) assert.ok(WORDS.includes(word), word);
  let i = 0;
  assert.equal(suggestPassword(['a', 'b', 'c'], () => i++ % 3), 'a b c a');
});
