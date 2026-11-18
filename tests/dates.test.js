import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, isOpen, parseDate } from '../app/lib/dates.js';

test('Canvas UTC times show in Pacific time', () => {
  const now = new Date('2025-11-01T00:00:00Z');
  assert.equal(formatDate('2025-10-17T04:59:00', now), 'Thu, Oct 16, 9:59 PM');
  assert.equal(formatDate('2025-12-01T07:59:00', now), 'Sun, Nov 30, 11:59 PM', 'standard time after November 2');
});

test('isOpen turns true exactly at the unlock time', () => {
  const unlock = '2030-01-07T08:00:00';
  assert.equal(isOpen(unlock, new Date('2030-01-07T07:59:59Z')), false);
  assert.equal(isOpen(unlock, new Date('2030-01-07T08:00:00Z')), true);
  assert.equal(isOpen(null, new Date()), true);
});

test('dates with a zone marker are read as written', () => {
  assert.equal(parseDate('2025-10-17T04:59:00Z').toISOString(), '2025-10-17T04:59:00.000Z');
  assert.equal(parseDate('2025-10-17T04:59:00-07:00').toISOString(), '2025-10-17T11:59:00.000Z');
  assert.equal(parseDate('not a date'), null);
});
