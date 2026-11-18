// Files for a packed course on the web. With the service worker in control,
// each file has its own address under <course>/f/. Without it, the viewer
// downloads the pieces itself and decrypts them in the page.
import { readRange } from '../lib/container.js';

export async function fetchBytes(base, name, offset, length) {
  const response = await fetch(`${base}${name}`, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  if (!response.ok) throw new Error(`Could not read ${name} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return response.status === 206 ? bytes : bytes.subarray(offset, offset + length);
}

export function createRemoteSource({ base, course, key, swReady }) {
  return {
    url(fileId) {
      const entry = course.files[fileId];
      if (!swReady || !entry) return null;
      return `${base}f/${encodeURIComponent(fileId)}/${encodeURIComponent(entry.name)}`;
    },
    async blob(fileId) {
      const entry = course.files[fileId];
      if (entry.size === 0) return new Blob([], { type: entry.mime });
      const bytes = await readRange({
        key, fileId: entry.same || fileId, entry, bundles: course.bundles,
        fetchBytes: (name, offset, length) => fetchBytes(base, name, offset, length),
      }, 0, entry.size - 1);
      return new Blob([bytes], { type: entry.mime });
    },
  };
}
