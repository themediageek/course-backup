// Opens a .imscc file (a zip) so the rest of the library can read entries
// one at a time, without loading the whole export into memory.
import { PackError } from './errors.js';

export async function openZip(zipLib, blob) {
  if (zipLib.configure) zipLib.configure({ useWebWorkers: false });
  let reader;
  let entries;
  try {
    reader = new zipLib.ZipReader(new zipLib.BlobReader(blob));
    entries = await reader.getEntries();
  } catch (error) {
    throw new PackError('not-zip', `The file could not be opened as a zip: ${error.message}`);
  }
  const files = entries.filter((e) => !e.directory);
  if (files.length === 0) throw new PackError('not-zip', 'The zip file is empty.');

  // Some tools wrap the export in one extra folder.
  let prefix = '';
  if (!files.some((e) => e.filename === 'imsmanifest.xml')) {
    const nested = files.filter((e) => /^[^/]+\/imsmanifest\.xml$/.test(e.filename));
    if (nested.length === 1) prefix = nested[0].filename.slice(0, -'imsmanifest.xml'.length);
  }

  const byName = new Map();
  for (const entry of files) {
    if (!entry.filename.startsWith(prefix)) continue;
    byName.set(entry.filename.slice(prefix.length), entry);
  }

  function entryFor(name) {
    const entry = byName.get(name);
    if (!entry) throw new Error(`Not in the export: ${name}`);
    return entry;
  }

  return {
    names: [...byName.keys()],
    has: (name) => byName.has(name),
    info(name) {
      const entry = entryFor(name);
      return { size: entry.uncompressedSize, crc32: entry.signature };
    },
    text: (name) => entryFor(name).getData(new zipLib.TextWriter()),
    bytes: (name) => entryFor(name).getData(new zipLib.Uint8ArrayWriter()),
    stream(name) {
      const { readable, writable } = new TransformStream();
      entryFor(name).getData(writable).catch(() => {});
      return readable;
    },
    close: () => reader.close(),
  };
}
