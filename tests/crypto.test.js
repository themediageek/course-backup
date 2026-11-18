import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIECE_SIZE, BUNDLE_MAX, ITERATIONS, normalizePassword, newPackId, makeKeyFile, unlock,
  encryptPiece, decryptPiece, sealJson, openJson, WrongPasswordError,
} from '../app/lib/crypto.js';

const bytes = (text) => new TextEncoder().encode(text);

test('constants match the design', () => {
  assert.equal(PIECE_SIZE, 1048576);
  assert.equal(BUNDLE_MAX, 24000000);
  assert.equal(ITERATIONS, 600000);
});

test('pack ids are 8 lowercase hex characters', () => {
  assert.match(newPackId(), /^[0-9a-f]{8}$/);
  assert.notEqual(newPackId(), newPackId());
});

test('a piece survives a round trip', async () => {
  const { key } = await makeKeyFile({ title: 'T', packId: 'aaaaaaaa', password: null });
  const enc = await encryptPiece(key, bytes('tide tables'), 'f1:0');
  assert.equal(enc.length, 'tide tables'.length + 28);
  assert.deepEqual(await decryptPiece(key, enc, 'f1:0'), bytes('tide tables'));
});

test('a changed byte or the wrong label fails to decrypt', async () => {
  const { key } = await makeKeyFile({ title: 'T', packId: 'aaaaaaaa', password: null });
  const enc = await encryptPiece(key, bytes('tide tables'), 'f1:0');
  const tampered = enc.slice();
  tampered[20] ^= 1;
  await assert.rejects(decryptPiece(key, tampered, 'f1:0'));
  await assert.rejects(decryptPiece(key, enc, 'f1:1'));
});

test('the right password unlocks and a wrong one does not', async () => {
  const { keyJson, key } = await makeKeyFile({ title: 'Ocean 101', packId: '0a1b2c3d', password: 'maple river canyon sound' });
  assert.equal(keyJson.format, 1);
  assert.equal(keyJson.title, 'Ocean 101');
  assert.equal(keyJson.course, 'course-0a1b2c3d.bin');
  assert.equal(keyJson.kdf.iterations, ITERATIONS);
  assert.equal(keyJson.key, undefined, 'the raw key is not stored when there is a password');
  const sealed = await sealJson(key, { hello: 'world' });
  const unlocked = await unlock(keyJson, 'maple river canyon sound');
  assert.deepEqual(await openJson(unlocked, sealed), { hello: 'world' });
  await assert.rejects(unlock(keyJson, 'maple river canyon'), WrongPasswordError);
  await assert.rejects(unlock(keyJson, null), WrongPasswordError);
});

test('phone typing differences do not matter', async () => {
  const { keyJson } = await makeKeyFile({ title: 'T', packId: 'aaaaaaaa', password: 'Maple River' });
  await unlock(keyJson, '  Maple  River ');
  const accented = await makeKeyFile({ title: 'T', packId: 'aaaaaaaa', password: 'café bleu' });
  await unlock(accented.keyJson, 'café bleu');
  assert.equal(normalizePassword('  a \t b\n'), 'a b');
});

test('a course with no password opens without one', async () => {
  const { keyJson, key } = await makeKeyFile({ title: 'Open', packId: 'bbbbbbbb', password: null });
  assert.equal(typeof keyJson.key, 'string');
  assert.equal(keyJson.kdf, undefined);
  const sealed = await sealJson(key, [1, 2, 3]);
  assert.deepEqual(await openJson(await unlock(keyJson, null), sealed), [1, 2, 3]);
});

test('the unlocked key cannot be exported', async () => {
  const { keyJson } = await makeKeyFile({ title: 'T', packId: 'aaaaaaaa', password: 'x y z w' });
  const key = await unlock(keyJson, 'x y z w');
  assert.equal(key.extractable, false);
});

test('sealed course data is compressed and labeled', async () => {
  const { key } = await makeKeyFile({ title: 'T', packId: 'aaaaaaaa', password: null });
  const big = { text: 'tide '.repeat(20000) };
  const sealed = await sealJson(key, big);
  assert.ok(sealed.length < 10000, `compressed to ${sealed.length} bytes`);
  await assert.rejects(decryptPiece(key, sealed, 'f1:0'));
});
