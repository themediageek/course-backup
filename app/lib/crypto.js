// Encryption for packed courses, using the browser's built-in Web Crypto.
// Each course has one random content key. A password protects that key
// through PBKDF2; a course with no password stores the key in key.json.

export const PIECE_SIZE = 1048576;
export const BUNDLE_MAX = 24000000;
export const ITERATIONS = 600000;
const IV_BYTES = 12;

export class WrongPasswordError extends Error {
  constructor() {
    super('The password is not right.');
    this.name = 'WrongPasswordError';
  }
}

const subtle = () => globalThis.crypto.subtle;
const encoder = new TextEncoder();

export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

export function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Phones capitalize, add spaces, and may send accents in a different form.
export function normalizePassword(text) {
  return String(text).normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function newPackId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function importContentKey(raw) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function passwordKey(password, salt, iterations) {
  const base = await subtle().importKey('raw', encoder.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPiece(key, bytes, aad) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, bytes));
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv, 0);
  out.set(sealed, IV_BYTES);
  return out;
}

export async function decryptPiece(key, bytes, aad) {
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: encoder.encode(aad) },
    key,
    bytes.subarray(IV_BYTES),
  );
  return new Uint8Array(plain);
}

export async function makeKeyFile({ title, packId, password }) {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const key = await importContentKey(raw);
  const keyJson = { format: 1, title, packId, course: `course-${packId}.bin` };
  if (password == null) {
    keyJson.key = toBase64(raw);
  } else {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const wrapper = await passwordKey(password, salt, ITERATIONS);
    keyJson.kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) };
    keyJson.wrappedKey = toBase64(await encryptPiece(wrapper, raw, 'key'));
  }
  raw.fill(0);
  return { keyJson, key };
}

export async function unlock(keyJson, password) {
  if (keyJson.key) return importContentKey(fromBase64(keyJson.key));
  if (password == null || !keyJson.kdf) throw new WrongPasswordError();
  const wrapper = await passwordKey(password, fromBase64(keyJson.kdf.salt), keyJson.kdf.iterations);
  let raw;
  try {
    raw = await decryptPiece(wrapper, fromBase64(keyJson.wrappedKey), 'key');
  } catch {
    throw new WrongPasswordError();
  }
  const key = await importContentKey(raw);
  raw.fill(0);
  return key;
}

async function pipeThrough(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sealJson(key, value) {
  const gz = await pipeThrough(encoder.encode(JSON.stringify(value)), new CompressionStream('gzip'));
  return encryptPiece(key, gz, 'course');
}

export async function openJson(key, bytes) {
  const gz = await decryptPiece(key, bytes, 'course');
  const plain = await pipeThrough(gz, new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(plain));
}

// What the password screen calls. Some phone keyboards capitalize the first
// letter even when told not to, so a wrong password that starts with a
// capital is tried once more with that letter in lowercase.
export async function unlockTyped(keyJson, password) {
  try {
    return await unlock(keyJson, password);
  } catch (error) {
    const typed = password == null ? '' : normalizePassword(password);
    const first = typed.charAt(0);
    if (!(error instanceof WrongPasswordError) || first === first.toLowerCase()) throw error;
    return unlock(keyJson, first.toLowerCase() + typed.slice(1));
  }
}
