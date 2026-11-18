import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectContent, hasStudentContent } from '../app/lib/select.js';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { makeExport, zipLib, fixture, fixtureBlob } from './helpers/make-export.js';
import { sampleFiles } from './helpers/sample-course.js';

const NOW = new Date('2026-11-17T12:00:00Z');

function page(id, extra = {}) {
  return { id, slug: id, title: id, html: '', published: true, frontPage: false, ...extra };
}
function file(id, path, extra = {}) {
  return { id, path, name: path.split('/').pop(), size: 10, crc32: 1, hidden: false, locked: false, unlockAt: null, ...extra };
}
function mod(id, items, extra = {}) {
  return { id, title: id, published: true, unlockAt: null, items, ...extra };
}
function entry(id, type, ref, extra = {}) {
  return { id, type, title: id, ref, url: null, indent: 0, published: true, newTab: false, ...extra };
}
function raw(extra = {}) {
  return {
    title: 'T', code: 'C', defaultView: 'modules', hiddenTabs: [], syllabusHtml: null, syllabusSummary: true,
    frontPageId: null, modules: [], pages: {}, assignments: {}, discussions: {}, quizzes: {}, links: {}, tools: {},
    files: {}, folders: [], rubrics: {}, groups: {}, quizFileRefs: [], aliases: {}, ...extra,
  };
}
const opts = (exclude = []) => ({ now: NOW, exclude: new Set(exclude) });

test('drops unpublished items', () => {
  const r = raw({
    pages: { p1: page('p1'), p2: page('p2', { published: false }) },
    modules: [mod('m1', [entry('e1', 'WikiPage', 'p1'), entry('e2', 'WikiPage', 'p2', { published: false })]),
      mod('m2', [], { published: false })],
  });
  const s = selectContent(r, opts());
  assert.deepEqual([...s.include.pages], ['p1']);
  assert.deepEqual([...s.include.modules], ['m1']);
  assert.ok(s.leftOut.unpublished >= 1);
});

test('drops content found only in an unpublished module', () => {
  const r = raw({
    pages: { key: page('key') },
    modules: [mod('hidden', [entry('e1', 'WikiPage', 'key')], { published: false })],
  });
  const s = selectContent(r, opts());
  assert.equal(s.include.pages.has('key'), false);
  assert.equal(s.leftOut.unpublished, 1);
});

test('keeps published content that is in no module', () => {
  const r = raw({ pages: { extra: page('extra') }, assignments: { a1: { id: 'a1', title: 'A', published: true, unlockAt: null, sectionOnly: false } } });
  const s = selectContent(r, opts());
  assert.equal(s.include.pages.has('extra'), true);
  assert.equal(s.include.assignments.has('a1'), true);
});

test('drops locked files and files in locked folders', () => {
  const r = raw({
    files: { f1: file('f1', 'web_resources/a.pdf'), f2: file('f2', 'web_resources/b.pdf', { locked: true }) },
  });
  const s = selectContent(r, opts());
  assert.deepEqual([...s.include.files], ['f1']);
  assert.equal(s.leftOut.locked, 1);
});

test('drops quiz question images', () => {
  const r = raw({
    files: {
      q: file('q', 'web_resources/assessment_questions/q.png'),
      chart: file('chart', 'web_resources/Uploaded Media/chart.png', { hidden: true }),
      plain: file('plain', 'web_resources/chart2.png'),
    },
    quizFileRefs: ['chart', 'plain'],
  });
  const s = selectContent(r, opts());
  assert.deepEqual([...s.include.files], []);
  assert.equal(s.leftOut.quizFiles, 3);
});

test('keeps a quiz image that a page also uses', () => {
  const r = raw({
    pages: { p1: page('p1', { html: '<img src="$IMS-CC-FILEBASE$/chart2.png">' }) },
    files: { plain: file('plain', 'web_resources/chart2.png') },
    quizFileRefs: ['plain'],
  });
  const s = selectContent(r, opts());
  assert.equal(s.include.files.has('plain'), true);
});

test('keeps hidden files only when included content links to them', () => {
  const r = raw({
    pages: {
      shown: page('shown', { html: '<img src="$IMS-CC-FILEBASE$/Uploaded%20Media/used.png">' }),
      draft: page('draft', { published: false, html: '<a href="$IMS-CC-FILEBASE$/Uploaded%20Media/key.pdf">' }),
    },
    files: {
      used: file('used', 'web_resources/Uploaded Media/used.png', { hidden: true }),
      key: file('key', 'web_resources/Uploaded Media/key.pdf', { hidden: true }),
    },
  });
  const s = selectContent(r, opts());
  assert.equal(s.include.files.has('used'), true);
  assert.equal(s.include.files.has('key'), false);
  assert.equal(s.leftOut.unlinked, 1);
});

test('keeps a hidden file linked by a path written with plain spaces', () => {
  const r = raw({
    discussions: { d1: { id: 'd1', title: 'Talk', published: true, unlockAt: null, sectionOnly: false,
      html: '<video><source src="$IMS-CC-FILEBASE$/Uploaded Media/Love is Blind-1.mp4" data-media-type="video"></video>' +
        '<div style="background: url($IMS-CC-FILEBASE$/Uploaded%20Media/banner%20(2).jpg)"></div>' } },
    files: {
      v: file('v', 'web_resources/Uploaded Media/Love is Blind-1.mp4', { hidden: true }),
      b: file('b', 'web_resources/Uploaded Media/banner (2).jpg', { hidden: true }),
    },
  });
  const s = selectContent(r, opts());
  assert.equal(s.include.files.has('v'), true);
  assert.equal(s.include.files.has('b'), true);
});

test('lists future items and keeps them', () => {
  const r = raw({
    pages: { p1: page('p1'), p2: page('p2') },
    assignments: { a1: { id: 'a1', title: 'Later essay', published: true, unlockAt: '2027-01-05T08:00:00', sectionOnly: false } },
    modules: [mod('m9', [entry('e1', 'WikiPage', 'p1')], { unlockAt: '2027-01-04T08:00:00', title: 'Week 9' }),
      mod('m1', [entry('e2', 'WikiPage', 'p2')], { unlockAt: '2026-01-01T08:00:00' })],
  });
  const s = selectContent(r, opts());
  assert.equal(s.include.pages.has('p1'), true);
  assert.equal(s.include.modules.has('m9'), true);
  assert.deepEqual(s.future.map((f) => [f.kind, f.id]), [['module', 'm9'], ['assignment', 'a1']]);
  assert.equal(s.future[0].title, 'Week 9');
});

test('exclude moves items to leftOut.chosen, and a module takes its items with it', () => {
  const r = raw({
    pages: { p1: page('p1'), p2: page('p2') },
    files: { big: file('big', 'web_resources/lecture.mp4', { size: 600_000_000 }) },
    modules: [mod('m9', [entry('e1', 'WikiPage', 'p1')], { unlockAt: '2027-01-04T08:00:00' })],
  });
  const s = selectContent(r, opts(['m9', 'big']));
  assert.equal(s.include.modules.has('m9'), false);
  assert.equal(s.include.pages.has('p1'), false);
  assert.equal(s.include.files.has('big'), false);
  assert.deepEqual(s.leftOut.chosen.map((c) => c.id).sort(), ['big', 'm9']);
  assert.equal(s.leftOut.chosen.find((c) => c.id === 'big').size, 600_000_000);
});

test('lists section-only items', () => {
  const r = raw({ discussions: { d1: { id: 'd1', title: 'Group talk', published: true, unlockAt: null, sectionOnly: true } } });
  const s = selectContent(r, opts());
  assert.equal(s.include.discussions.has('d1'), true);
  assert.deepEqual(s.everyone, [{ kind: 'discussion', id: 'd1', title: 'Group talk' }]);
});

test('ignores available-until dates', () => {
  const r = raw({ assignments: { a1: { id: 'a1', title: 'Old', published: true, unlockAt: null, lockAt: '2020-01-01T00:00:00', sectionOnly: false } } });
  assert.equal(selectContent(r, opts()).include.assignments.has('a1'), true);
});

test('the made-up course: answer key, locked files, and quiz images stay out', async () => {
  const zip = await openZip(zipLib, new Blob([await makeExport(sampleFiles())]));
  const s = selectContent(await readExport(zip), opts());
  assert.equal(s.include.pages.has('pg2'), false, 'answer key is only in the unpublished module');
  assert.equal(s.include.pages.has('pg4'), false, 'draft is unpublished');
  assert.equal(s.include.pages.has('pg5'), true, 'extra reading is in no module');
  for (const id of ['f3', 'f4', 'f5', 'f6']) assert.equal(s.include.files.has(id), false, id);
  for (const id of ['f1', 'f2', 'f7']) assert.equal(s.include.files.has(id), true, id);
  assert.equal(hasStudentContent(s), true);
});

test('real Jills Course has no student content', { skip: !fixture('jills') }, async () => {
  const s = selectContent(await readExport(await openZip(zipLib, fixtureBlob('jills'))), opts());
  assert.equal(hasStudentContent(s), false);
});

test('real 291.292 leaves out its unpublished module entries', { skip: !fixture('las291') }, async () => {
  const r = await readExport(await openZip(zipLib, fixtureBlob('las291')));
  const s = selectContent(r, opts());
  const unpublishedModules = r.modules.filter((m) => !m.published).map((m) => m.id);
  assert.ok(unpublishedModules.length > 0);
  for (const id of unpublishedModules) assert.equal(s.include.modules.has(id), false);
  for (const m of r.modules.filter((x) => !x.published)) {
    for (const i of m.items) {
      const elsewhere = r.modules.some((o) => o.published && o.items.some((x) => x.published && x.ref === i.ref));
      if (i.ref && !elsewhere && r.pages[i.ref]) assert.equal(s.include.pages.has(i.ref), false, i.title);
    }
  }
  assert.ok(s.leftOut.unpublished > 0);
  assert.equal(hasStudentContent(s), true);
});
