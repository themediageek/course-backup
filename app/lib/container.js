// How encrypted files are laid out in a course folder.
// Each file is cut into 1 MiB pieces; each piece is encrypted on its own
// (12-byte IV + ciphertext + 16-byte tag) and the pieces are stored back to
// back in numbered bundle files of at most 24 MB, so every file in the
// folder fits GitHub's 25 MiB upload limit. A file's pieces are recorded as
// runs: [bundleIndex, byteOffset, pieceCount].
import { PIECE_SIZE, BUNDLE_MAX, encryptPiece, decryptPiece } from './crypto.js';

const OVERHEAD = 28;

export function bundleName(packId, index) {
  return `data-${packId}-${String(index).padStart(3, '0')}.bin`;
}

export class BundleWriter {
  constructor({ key, packId, out, maxBytes = BUNDLE_MAX }) {
    this.key = key;
    this.packId = packId;
    this.out = out;
    this.maxBytes = maxBytes;
    this.names = [];
    this.parts = [];
    this.used = 0;
  }

  async flush() {
    if (this.used === 0) return;
    const name = bundleName(this.packId, this.names.length);
    await this.out.write(name, new Blob(this.parts));
    this.names.push(name);
    this.parts = [];
    this.used = 0;
  }

  async addPiece(fileId, index, plain, runs) {
    const enc = await encryptPiece(this.key, plain, `${fileId}:${index}`);
    if (this.used > 0 && this.used + enc.length > this.maxBytes) await this.flush();
    const bundle = this.names.length;
    const last = runs[runs.length - 1];
    if (last && last[0] === bundle) last[2]++;
    else runs.push([bundle, this.used, 1]);
    this.parts.push(enc);
    this.used += enc.length;
  }

  async addFile(fileId, stream, size) {
    const runs = [];
    const reader = stream.getReader();
    let buffer = new Uint8Array(PIECE_SIZE);
    let filled = 0;
    let index = 0;
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      let pos = 0;
      while (pos < value.length) {
        const take = Math.min(PIECE_SIZE - filled, value.length - pos);
        buffer.set(value.subarray(pos, pos + take), filled);
        filled += take;
        pos += take;
        if (filled === PIECE_SIZE) {
          await this.addPiece(fileId, index++, buffer, runs);
          buffer = new Uint8Array(PIECE_SIZE);
          filled = 0;
        }
      }
    }
    if (filled > 0) await this.addPiece(fileId, index++, buffer.subarray(0, filled), runs);
    if (total !== size) throw new Error(`File ${fileId} was ${total} bytes, expected ${size}.`);
    return runs;
  }

  async finish() {
    await this.flush();
    return this.names;
  }
}

// Which encrypted pieces hold bytes start..end (inclusive) of a file.
export function piecePlan(entry, start, end) {
  const first = Math.floor(start / PIECE_SIZE);
  const last = Math.floor(end / PIECE_SIZE);
  const count = Math.ceil(entry.size / PIECE_SIZE);
  const plan = [];
  let index = 0;
  for (const [bundle, offset, n] of entry.pieces) {
    let at = offset;
    for (let k = 0; k < n; k++, index++) {
      const plain = index === count - 1 ? entry.size - index * PIECE_SIZE : PIECE_SIZE;
      const length = plain + OVERHEAD;
      if (index >= first && index <= last) plan.push({ bundle, offset: at, length, index });
      at += length;
    }
  }
  return plan;
}

// Reads and decrypts bytes start..end (inclusive). fetchBytes(name, offset,
// length) returns those bytes of a bundle file. fileId is the id the pieces
// were encrypted under (a duplicate file uses its original's id).
export async function readRange({ key, fileId, entry, bundles, fetchBytes }, start, end) {
  const plan = piecePlan(entry, start, end);
  const plains = [];
  let i = 0;
  while (i < plan.length) {
    // Fetch neighbouring pieces in one request.
    let j = i;
    while (j + 1 < plan.length && plan[j + 1].bundle === plan[i].bundle &&
      plan[j + 1].offset === plan[j].offset + plan[j].length) j++;
    const from = plan[i].offset;
    const span = plan[j].offset + plan[j].length - from;
    const bytes = await fetchBytes(bundles[plan[i].bundle], from, span);
    for (let k = i; k <= j; k++) {
      const p = plan[k];
      plains.push(await decryptPiece(key, bytes.subarray(p.offset - from, p.offset - from + p.length), `${fileId}:${p.index}`));
    }
    i = j + 1;
  }
  const joined = new Uint8Array(plains.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of plains) { joined.set(p, at); at += p.length; }
  const base = plan.length ? plan[0].index * PIECE_SIZE : 0;
  return joined.slice(start - base, end - base + 1);
}

// Reads an HTTP Range header. Returns null to send the whole file,
// 'invalid' for a range that cannot be met, or { start, end } inclusive.
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
