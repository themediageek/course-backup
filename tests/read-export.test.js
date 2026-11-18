import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeExport, zipLib, fixture, fixtureBlob } from './helpers/make-export.js';
import { sampleFiles, QUIZ_SECRET } from './helpers/sample-course.js';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { PackError } from '../app/lib/errors.js';

async function readSample(files = sampleFiles()) {
  const bytes = await makeExport(files);
  const zip = await openZip(zipLib, new Blob([bytes]));
  return readExport(zip);
}

test('reads course settings, navigation, and syllabus', async () => {
  const raw = await readSample();
  assert.equal(raw.title, 'Ocean Studies 101');
  assert.equal(raw.code, 'OCN 101');
  assert.equal(raw.defaultView, 'wiki');
  assert.deepEqual(raw.hiddenTabs, [11]);
  assert.equal(raw.syllabusSummary, true);
  assert.match(raw.syllabusHtml, /Read the syllabus first/);
  assert.equal(raw.frontPageId, 'pg1');
});

test('reads modules with headers, indents, links, and unlock dates', async () => {
  const raw = await readSample();
  assert.equal(raw.modules.length, 3);
  const [m1, m2, m3] = raw.modules;
  assert.equal(m1.title, 'Week 1: Tides');
  assert.equal(m1.published, true);
  assert.equal(m2.published, false);
  assert.equal(m3.unlockAt, '2030-01-07T08:00:00');
  assert.deepEqual(m1.items.map((i) => i.type), [
    'ContextModuleSubHeader', 'WikiPage', 'Attachment', 'Assignment',
    'DiscussionTopic', 'Quizzes::Quiz', 'ExternalUrl', 'ContextExternalTool']);
  assert.equal(m1.items[0].ref, null);
  assert.equal(m1.items[2].indent, 1);
  assert.equal(m1.items[6].url, 'https://tidesandcurrents.noaa.gov/');
});

test('reads every content type', async () => {
  const raw = await readSample();
  assert.equal(raw.pages.pg1.title, 'Welcome & overview');
  assert.equal(raw.pages.pg1.slug, 'welcome');
  assert.equal(raw.pages.pg1.frontPage, true);
  assert.equal(raw.pages.pg4.published, false);
  assert.match(raw.pages.pg1.html, /\$IMS-CC-FILEBASE\$/);
  assert.doesNotMatch(raw.pages.pg1.html, /<body/);

  const a = raw.assignments.as1;
  assert.equal(a.published, true);
  assert.equal(a.dueAt, '2025-10-17T06:59:00');
  assert.equal(a.lockAt, '2025-10-20T06:59:00');
  assert.equal(a.points, 10);
  assert.deepEqual(a.submissionTypes, ['online_upload', 'online_text_entry']);
  assert.equal(a.rubricId, 'r1');
  assert.equal(a.groupId, 'grp1');
  assert.match(a.html, /Record the tide/);

  const d = raw.discussions.dt1;
  assert.equal(d.graded, true);
  assert.equal(d.points, 5);
  assert.equal(d.sectionOnly, true);
  assert.equal(d.html, '<p>What surprised you?</p>');
  assert.equal(raw.aliases.dtm1, 'dt1');
  assert.equal(raw.aliases.dtA1, 'dt1');

  const q = raw.quizzes.qz1;
  assert.equal(q.published, true);
  assert.equal(q.quizType, 'assignment');
  assert.equal(q.timeLimit, 10);
  assert.equal(q.allowedAttempts, 1);
  assert.equal(q.html, '<p>Ten minutes, one try.</p>');
  assert.equal(raw.aliases.qzA1, 'qz1');

  assert.equal(raw.links.lnk1.url, 'https://tidesandcurrents.noaa.gov/');
  assert.equal(raw.tools.lti1.title, 'Publisher tool');
  assert.equal(raw.tools.lti1.url, 'https://tool.example.com/launch');

  assert.equal(raw.rubrics.r1.criteria[0].ratings.length, 2);
  assert.equal(raw.rubrics.r1.criteria[0].longDescription, 'Records three tide readings.');
  assert.equal(raw.groups.grp1.weight, 40);
});

test('reads files with folder rules, sizes, and checksums', async () => {
  const raw = await readSample();
  const f1 = raw.files.f1;
  assert.equal(f1.path, "web_resources/O'Connor - Culture.pdf");
  assert.equal(f1.name, "O'Connor - Culture.pdf");
  assert.ok(f1.size > 0);
  assert.equal(typeof f1.crc32, 'number');
  assert.equal(raw.files.f2.hidden, true, 'Uploaded Media folder is hidden');
  assert.equal(raw.files.f3.locked, true);
  assert.equal(raw.files.f4.locked, true, 'Instructor folder is locked');
  assert.equal(raw.files.f1.crc32, raw.files.f7.crc32);
});

test('collects files that quiz questions link to, and keeps no question text', async () => {
  const raw = await readSample();
  assert.deepEqual(raw.quizFileRefs, ['f6']);
  assert.ok(!JSON.stringify(raw).includes(QUIZ_SECRET));
});

test('reads an export wrapped in one extra folder', async () => {
  const wrapped = Object.fromEntries(Object.entries(sampleFiles()).map(([k, v]) => [`My Course/${k}`, v]));
  const raw = await readSample(wrapped);
  assert.equal(raw.title, 'Ocean Studies 101');
});

test('rejects a file that is not a zip', async () => {
  await assert.rejects(openZip(zipLib, new Blob(['just some text'])), (e) => e instanceof PackError && e.code === 'not-zip');
});

test('rejects a truncated export', async () => {
  const bytes = await makeExport(sampleFiles());
  const half = bytes.slice(0, Math.floor(bytes.length / 2));
  await assert.rejects(openZip(zipLib, new Blob([half])), (e) => e instanceof PackError && e.code === 'not-zip');
});

test('rejects a cartridge that did not come from Canvas', async () => {
  const bytes = await makeExport({ 'imsmanifest.xml': '<manifest/>', 'page.html': '<p>x</p>' });
  const zip = await openZip(zipLib, new Blob([bytes]));
  await assert.rejects(readExport(zip), (e) => e instanceof PackError && e.code === 'not-canvas');
});

test('real 291.292 export', { skip: !fixture('las291') }, async () => {
  const zip = await openZip(zipLib, fixtureBlob('las291'));
  const raw = await readExport(zip);
  assert.equal(raw.modules.length, 5);
  const counts = {};
  for (const m of raw.modules) for (const i of m.items) counts[i.type] = (counts[i.type] || 0) + 1;
  assert.deepEqual(counts, { WikiPage: 19, ExternalUrl: 4, Attachment: 1, ContextModuleSubHeader: 2,
    Assignment: 10, 'Quizzes::Quiz': 4, DiscussionTopic: 16 });
  assert.equal(raw.modules.filter((m) => m.unlockAt).length, 2);
  assert.equal(raw.pages[raw.frontPageId].slug, 'las-291-slash-292-global-perspectives-for-study-abroad');

  // No question text from the quiz files may reach the RawCourse.
  const json = JSON.stringify(raw);
  const quizNames = zip.names.filter((n) => n.endsWith('.qti') || n.endsWith('assessment_qti.xml'));
  let checked = 0;
  for (const name of quizNames) {
    const xml = await zip.text(name);
    for (const m of xml.matchAll(/<mattext[^>]*>([\s\S]*?)<\/mattext>/g)) {
      const plain = m[1].replace(/&lt;[\s\S]*?&gt;/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (plain.length < 30) continue;
      checked++;
      assert.ok(!json.includes(plain.slice(0, 30)), `question text leaked: ${plain.slice(0, 60)}`);
    }
  }
  assert.ok(checked > 0, 'the export has question text to check');
});

test('real GC export', { skip: !fixture('gc') }, async () => {
  const raw = await readExport(await openZip(zipLib, fixtureBlob('gc')));
  // GC hides Pages, Modules, Files, and Syllabus; LTI tabs are not numbers and are skipped.
  for (const tab of [1, 2, 10, 11]) assert.equal(raw.hiddenTabs.includes(tab), true);
  assert.equal(raw.hiddenTabs.includes(0), false);
  assert.ok(raw.hiddenTabs.every((t) => typeof t === 'number'));
  const corey = Object.values(raw.files).find((f) =>
    f.path === 'web_resources/Student Annotation Documents/Corey - From Liberation Education to Liberal Education (1).pdf');
  assert.ok(corey);
  assert.equal(corey.hidden, true);
});
