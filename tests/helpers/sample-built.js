// The made-up course, read, selected, and built: the CourseData the viewer gets.
import { openZip } from '../../app/lib/zip-source.js';
import { readExport } from '../../app/lib/read-export.js';
import { selectContent } from '../../app/lib/select.js';
import { buildCourse } from '../../app/lib/build-course.js';
import { makeExport, zipLib } from './make-export.js';
import { sampleFiles } from './sample-course.js';

export const NOW = new Date('2026-11-17T12:00:00Z');

export async function sampleBuilt(overrides) {
  const zip = await openZip(zipLib, new Blob([await makeExport(sampleFiles(overrides))]));
  const raw = await readExport(zip);
  const selection = selectContent(raw, { now: NOW, exclude: new Set() });
  const built = buildCourse(raw, selection, { packId: '0a1b2c3d', instructor: { name: 'Dr. Rivera', email: 'rivera@example.edu' }, now: NOW });
  return { zip, raw, built, course: built.course };
}
