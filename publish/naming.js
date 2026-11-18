// Folder names and suggested passwords for the packing page.

const RESERVED = new Set(['app', 'pack', 'publish', 'help', 'vendor', 'docs', 'tests', 'tools', 'test-courses', 'node-modules']);

function slug(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const at = cut.lastIndexOf('-');
  return (at > 1 ? cut.slice(0, at) : text.slice(0, max)).replace(/-+$/, '');
}

// A course code like "LAS 291/292" makes the shortest link. Canvas codes that
// are not course codes ("dev_jdoe7_104233") fall back to the title.
export function suggestFolder(code, title) {
  const fromCode = slug(code || '');
  if (/^[a-z]{2,8}-?\d/.test(fromCode) && fromCode.length <= 30) return fromCode;
  const fromTitle = shorten(slug(title || ''), 30);
  return fromTitle.length >= 2 ? fromTitle : 'course';
}

export function checkFolder(name) {
  if (!name) return 'empty';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return 'characters';
  if (name.length < 2 || name.length > 60) return 'length';
  if (RESERVED.has(name) || name.startsWith('test-')) return 'reserved';
  return null;
}

function secureIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

export function suggestPassword(words, pick = secureIndex) {
  return Array.from({ length: 4 }, () => words[pick(words.length)]).join(' ');
}
