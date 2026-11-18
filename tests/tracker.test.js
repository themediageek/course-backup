import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { trackerRows, buildTracker, trackerFileName } from '../app/lib/tracker.js';
import { formatDate } from '../app/lib/dates.js';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { makeExport, zipLib, fixture, fixtureBlob } from './helpers/make-export.js';
import { sampleFiles } from './helpers/sample-course.js';

const INSTRUCTIONS = ['FERPA line', 'Step one', 'Step two'];

async function sampleRaw() {
  return readExport(await openZip(zipLib, new Blob([await makeExport(sampleFiles())])));
}

async function workbookFor(rows) {
  const wb = buildTracker(ExcelJS, { courseTitle: 'Ocean Studies 101', rows, instructions: INSTRUCTIONS, studentRows: 10 });
  const buffer = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  const zip = await openZip(zipLib, new Blob([buffer]));
  const sheetXml = async (n) => zip.text(`xl/worksheets/sheet${n}.xml`);
  return { back, sheetXml };
}

test('formatDate shows Pacific time', () => {
  const now = new Date('2025-11-01T00:00:00Z');
  assert.equal(formatDate('2025-10-17T06:59:00', now), 'Thu, Oct 16, 11:59 PM');
  assert.equal(formatDate('2024-01-10T20:00:00', now), 'Wed, Jan 10, 2024, 12:00 PM');
  assert.equal(formatDate(null, now), '');
});

test('rows list graded work in module order', async () => {
  const rows = trackerRows(await sampleRaw());
  assert.deepEqual(rows.map((r) => [r.module, r.title, r.type]), [
    ['Week 1: Tides', 'Tide journal', 'Assignment'],
    ['Week 1: Tides', 'Tide talk', 'Discussion'],
    ['Week 1: Tides', 'Tide quiz', 'Quiz'],
  ]);
  assert.equal(rows[0].points, 10);
  assert.equal(rows[0].submit, 'File upload, Text entry');
  assert.equal(rows[0].group, 'Journals');
  assert.equal(rows[0].dueAt, '2025-10-17T06:59:00');
});

test('ungraded and unpublished work is left out, and work outside modules follows by due date', async () => {
  const raw = await sampleRaw();
  raw.assignments.extra = { ...raw.assignments.as1, id: 'extra', title: 'Late essay', dueAt: '2025-12-01T07:59:00' };
  raw.assignments.early = { ...raw.assignments.as1, id: 'early', title: 'Early essay', dueAt: '2025-09-01T06:59:00' };
  raw.assignments.nodate = { ...raw.assignments.as1, id: 'nodate', title: 'Anytime essay', dueAt: null };
  raw.assignments.ng = { ...raw.assignments.as1, id: 'ng', title: 'Ungraded', gradingType: 'not_graded' };
  raw.assignments.draft = { ...raw.assignments.as1, id: 'draft', title: 'Draft', published: false };
  raw.quizzes.practice = { ...raw.quizzes.qz1, id: 'practice', title: 'Practice', quizType: 'practice_quiz' };
  const titles = trackerRows(raw).map((r) => r.title);
  assert.deepEqual(titles.slice(3), ['Early essay', 'Late essay', 'Anytime essay']);
  for (const t of ['Ungraded', 'Draft', 'Practice']) assert.ok(!titles.includes(t), t);
});

test('the workbook has four sheets in order', async () => {
  const { back } = await workbookFor(trackerRows(await sampleRaw()));
  assert.deepEqual(back.worksheets.map((w) => w.name), ['Instructions', 'Assignments', 'Submissions', 'Scores']);
  assert.equal(back.getWorksheet('Instructions').getCell('A1').value, 'FERPA line');
});

test('the Assignments sheet lists every row', async () => {
  const { back } = await workbookFor(trackerRows(await sampleRaw()));
  const ws = back.getWorksheet('Assignments');
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Module', 'Assignment', 'Type', 'Due', 'Points', 'How students submit', 'Group']);
  assert.equal(ws.getCell('B2').value, 'Tide journal');
  assert.equal(ws.getCell('E2').value, 10);
});

test('the Submissions sheet has headers, drop-downs, colors, a Missing count, and frozen panes', async () => {
  const rows = trackerRows(await sampleRaw());
  const { back, sheetXml } = await workbookFor(rows);
  const ws = back.getWorksheet('Submissions');
  assert.equal(ws.getCell('A3').value, 'Student name');
  assert.equal(ws.getCell('C1').value, 'Tide journal');
  assert.equal(ws.getCell('C2').value, 'Due Thu, Oct 16, 2025, 11:59 PM', 'the year shows because it is not this year');
  assert.equal(ws.getCell('C3').value, '10 pts');
  assert.equal(ws.getCell('F3').value, 'Missing');
  assert.equal(ws.getCell('F4').value.formula, 'COUNTIF(C4:E4,"Missing")');
  const xml = await sheetXml(3);
  assert.match(xml, /<dataValidation[^>]*type="list"[^>]*sqref="C4:E13"/);
  assert.match(xml, /<formula1>&quot;Received,Late,Missing,Excused&quot;<\/formula1>/);
  assert.match(xml, /<conditionalFormatting sqref="C4:E13">/);
  assert.match(xml, /<pane xSplit="2" ySplit="3"/);
});

test('the Scores sheet copies names and totals points', async () => {
  const { back } = await workbookFor(trackerRows(await sampleRaw()));
  const ws = back.getWorksheet('Scores');
  assert.equal(ws.getCell('A4').value.formula, 'IF(Submissions!A4="","",Submissions!A4)');
  assert.equal(ws.getCell('F3').value, 'Total');
  assert.equal(ws.getCell('G3').value, 'Total possible');
  assert.equal(ws.getCell('H3').value, 'Percent');
  assert.equal(ws.getCell('F4').value.formula, 'IF(COUNT(C4:E4)=0,"",SUM(C4:E4))');
  assert.equal(ws.getCell('G4').value, 19);
  assert.equal(ws.getCell('H4').value.formula, 'IF(F4="","",F4/G4)');
});

test('file names come from the course code', () => {
  assert.equal(trackerFileName('LAS 291/292', 'Global Perspectives'), 'LAS 291-292 submission tracker.xlsx');
  assert.equal(trackerFileName('', 'Ocean: Studies?'), 'Ocean- Studies- submission tracker.xlsx');
});

test('real 291.292 rows follow module order and skip ungraded work', { skip: !fixture('las291') }, async () => {
  const raw = await readExport(await openZip(zipLib, fixtureBlob('las291')));
  const rows = trackerRows(raw);
  assert.ok(rows.length > 0);
  const moduleTitles = raw.modules.map((m) => m.title);
  const positions = rows.filter((r) => r.module).map((r) => moduleTitles.indexOf(r.module));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  const titles = new Set(rows.map((r) => r.title));
  for (const a of Object.values(raw.assignments)) {
    if (a.gradingType === 'not_graded' || a.submissionTypes.includes('not_graded')) assert.ok(!titles.has(a.title), a.title);
  }
});

test('real 1B critical thinking course lists every graded item', { skip: !fixture('ct1b') }, async () => {
  const raw = await readExport(await openZip(zipLib, fixtureBlob('ct1b')));
  const graded = Object.values(raw.discussions).filter((d) => d.published && d.graded).length;
  assert.equal(trackerRows(raw).length, 19 + 15 + graded);
});
