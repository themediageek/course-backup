import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse } from '../app/lib/build-course.js';
import { selectContent } from '../app/lib/select.js';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { makeExport, zipLib, fixture, fixtureBlob } from './helpers/make-export.js';
import { sampleFiles, QUIZ_SECRET } from './helpers/sample-course.js';

const NOW = new Date('2026-11-17T12:00:00Z');
const OPTS = { packId: '0a1b2c3d', instructor: { name: 'Dr. Rivera', email: 'rivera@example.edu' }, now: NOW };

async function sampleRaw(overrides) {
  const zip = await openZip(zipLib, new Blob([await makeExport(sampleFiles(overrides))]));
  return readExport(zip);
}
function build(raw, exclude = []) {
  return buildCourse(raw, selectContent(raw, { now: NOW, exclude: new Set(exclude) }), OPTS);
}
function withSettings(view, tabs) {
  return {
    'course_settings/course_settings.xml': `<?xml version="1.0"?><course identifier="c1" xmlns="http://canvas.instructure.com/xsd/cccv1p0">
<title>Ocean Studies 101</title><course_code>OCN 101</course_code><default_view>${view}</default_view>
<tab_configuration>${JSON.stringify(tabs)}</tab_configuration></course>`,
  };
}

test('home follows the default view', async () => {
  assert.deepEqual(build(await sampleRaw()).course.home, { type: 'page', id: 'pg1' });
  assert.deepEqual(build(await sampleRaw(withSettings('syllabus', []))).course.home, { type: 'syllabus' });
  assert.deepEqual(build(await sampleRaw(withSettings('modules', []))).course.home, { type: 'modules' });
  assert.deepEqual(build(await sampleRaw(withSettings('feed', []))).course.home, { type: 'modules' });
});

test('navigation follows hidden tabs', async () => {
  assert.deepEqual(build(await sampleRaw()).course.nav, { syllabus: true, assignments: true, pages: true, files: false });
  const hidden = [1, 2, 3, 11].map((id) => ({ id, hidden: true }));
  assert.deepEqual(build(await sampleRaw(withSettings('modules', hidden))).course.nav,
    { syllabus: false, assignments: false, pages: false, files: false });
  const noSyllabus = build(await sampleRaw({ 'course_settings/syllabus.html': '<html><body> <p> </p> </body></html>' }));
  assert.equal(noSyllabus.course.nav.syllabus, false);
  assert.equal(noSyllabus.course.syllabus, null);
});

test('course data holds the course, instructor, and module items', async () => {
  const { course } = build(await sampleRaw());
  assert.equal(course.format, 1);
  assert.equal(course.packId, '0a1b2c3d');
  assert.equal(course.title, 'Ocean Studies 101');
  assert.deepEqual(course.instructor, OPTS.instructor);
  assert.deepEqual(course.modules.map((m) => m.id), ['m1', 'm3']);
  const items = course.modules[0].items;
  assert.deepEqual(items.map((i) => i.type), ['header', 'page', 'file', 'assignment', 'discussion', 'quiz', 'link', 'tool']);
  assert.equal(items[1].ref, 'pg1');
  assert.equal(items[2].ref, 'f1');
  assert.equal(items[2].indent, 1);
  assert.equal(items[6].url, 'https://tidesandcurrents.noaa.gov/');
  assert.deepEqual(course.items[items[7].ref], { type: 'tool', title: 'Publisher tool', url: 'https://tool.example.com/launch', opensAt: null });
  assert.equal(course.modules[1].unlockAt, '2030-01-07T08:00:00');
});

test('items carry rewritten HTML, rubrics, and graded discussion details', async () => {
  const { course } = build(await sampleRaw());
  const welcome = course.items.pg1;
  assert.equal(welcome.type, 'page');
  assert.match(welcome.html, /src="cbs-file:f2"/);
  assert.match(welcome.html, /href="cbs-file:f1"/);
  assert.match(welcome.html, /href="cbs-missing:item"/, 'the answer key is left out');
  const a = course.items.as1;
  assert.equal(a.type, 'assignment');
  assert.equal(a.points, 10);
  assert.equal(a.groupTitle, 'Journals');
  assert.equal(a.rubric.title, 'Journal rubric');
  assert.equal(a.rubric.criteria[0].ratings[0].description, 'Full');
  const d = course.items.dt1;
  assert.equal(d.graded, true);
  assert.equal(d.points, 5);
  const q = course.items.qz1;
  assert.deepEqual([q.timeLimit, q.allowedAttempts, q.points], [10, 1, 4]);
  assert.ok(!JSON.stringify(course).includes(QUIZ_SECRET));
});

test('duplicate files share one packed copy', async () => {
  const { course, packFiles } = build(await sampleRaw());
  assert.ok(course.files.f1 && course.files.f7);
  assert.equal(packFiles.filter((p) => p.fileId === 'f1' || p.fileId === 'f7').length, 1);
  assert.equal(course.files.f7.same, 'f1');
  assert.equal(course.files.f1.mime, 'application/pdf');
  assert.equal(course.files.f1.folder, '');
  assert.equal(course.files.f7.folder, 'Copies');
  assert.equal(course.files.f2.hidden, true);
  assert.deepEqual(course.files.f1.pieces, []);
  assert.deepEqual(course.bundles, []);
});

test('the report counts what is in and out', async () => {
  const { report } = build(await sampleRaw(), ['qz1']);
  assert.equal(report.counts.pages, 3);
  assert.equal(report.counts.quizzes, 0);
  assert.equal(report.leftOut.chosen[0].id, 'qz1');
  assert.deepEqual(report.tools, ['Publisher tool']);
  assert.deepEqual(report.canvasLinks, [{ itemTitle: 'Welcome & overview', url: 'https://canvas.example.edu/courses/12/pages/old' }]);
  assert.deepEqual(report.future.map((f) => f.id), ['m3']);
  assert.deepEqual(report.everyone.map((e) => e.id), ['dt1']);
  assert.ok(report.estimatedBytes > 65536);
  assert.deepEqual(report.warnings, []);
});

test('an empty course is flagged', async () => {
  const raw = await sampleRaw();
  for (const store of ['pages', 'assignments', 'discussions', 'quizzes']) for (const v of Object.values(raw[store])) v.published = false;
  for (const f of Object.values(raw.files)) f.locked = true;
  raw.modules = [];
  assert.deepEqual(build(raw).report.warnings, ['empty']);
});

test('real 291.292 export', { skip: !fixture('las291') }, async () => {
  const zip = await openZip(zipLib, fixtureBlob('las291'));
  const raw = await readExport(zip);
  const { course, report } = build(raw);
  const json = JSON.stringify(course);
  for (const name of zip.names.filter((n) => n.endsWith('assessment_qti.xml'))) {
    const xml = await zip.text(name);
    for (const m of xml.matchAll(/<mattext[^>]*>([\s\S]*?)<\/mattext>/g)) {
      const plain = m[1].replace(/&lt;[\s\S]*?&gt;/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (plain.length >= 30) assert.ok(!json.includes(plain.slice(0, 30)), plain.slice(0, 60));
    }
  }
  for (const tool of Object.values(raw.tools)) assert.ok(report.tools.includes(tool.title), tool.title);
  assert.ok(report.canvasLinks.length > 0);
  assert.deepEqual(report.warnings, []);
});

test('real GC export: every file link points at an included file', { skip: !fixture('gc') }, async () => {
  const raw = await readExport(await openZip(zipLib, fixtureBlob('gc')));
  const { course } = build(raw);
  let links = 0;
  for (const item of Object.values(course.items)) {
    for (const m of (item.html || '').matchAll(/cbs-file:([^"'\s)]+)/g)) {
      links++;
      assert.ok(course.files[m[1]], `${item.title} links to ${m[1]}`);
    }
  }
  assert.ok(links > 0);
});
