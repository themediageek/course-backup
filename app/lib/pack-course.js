// Encrypts a built course and writes its folder: index.html, the data
// bundles, the course file, and key.json (written last).
import { makeKeyFile, sealJson } from './crypto.js';
import { BundleWriter } from './container.js';
import { COURSE_INDEX_HTML } from './course-index.js';

export async function packCourse({ zip, built, password, out, onProgress = () => {} }) {
  const { course, packFiles } = built;
  const { keyJson, key } = await makeKeyFile({ title: course.title, packId: course.packId, password });
  const written = [];
  let bytes = 0;
  const write = async (name, data) => {
    await out.write(name, data);
    written.push(name);
    bytes += data instanceof Blob ? data.size : data.length;
  };
  const counting = {
    write: (name, data) => write(name, data),
    close: () => out.close(),
  };

  await write('index.html', new TextEncoder().encode(COURSE_INDEX_HTML));

  const total = packFiles.reduce((sum, f) => sum + f.size, 0);
  let done = 0;
  onProgress(done, total);
  const bundles = new BundleWriter({ key, packId: course.packId, out: counting });
  for (const f of packFiles) {
    course.files[f.fileId].pieces = await bundles.addFile(f.fileId, zip.stream(f.path), f.size);
    done += f.size;
    onProgress(done, total);
  }
  course.bundles = await bundles.finish();
  for (const entry of Object.values(course.files)) {
    if (entry.same) entry.pieces = course.files[entry.same].pieces;
  }

  await write(keyJson.course, await sealJson(key, course));
  await write('key.json', new TextEncoder().encode(`${JSON.stringify(keyJson, null, 2)}\n`));
  return { files: written, bytes };
}
