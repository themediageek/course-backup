// The submission tracker: an Excel workbook built from the export, saved
// only on the faculty member's computer. It never goes into a course folder.
import { selectContent } from './select.js';
import { formatDate, pacificWallClock } from './dates.js';

const SUBMIT = {
  online_upload: 'File upload', online_text_entry: 'Text entry', online_url: 'Website link',
  media_recording: 'Media recording', student_annotation: 'Annotation', discussion_topic: 'Discussion post',
  online_quiz: 'Quiz', external_tool: 'Outside tool', on_paper: 'On paper', none: 'No submission',
};
const STATUSES = '"Received,Late,Missing,Excused"';
const MISSING_FILL = 'FFF8D7DA';
const LATE_FILL = 'FFFFF3CD';

function submitText(types) {
  return types.map((t) => SUBMIT[t] || t).join(', ');
}

export function trackerRows(raw) {
  const selection = selectContent(raw, { now: new Date(), exclude: new Set() });
  const { include } = selection;
  const group = (id) => (id && raw.groups[id] ? raw.groups[id].title : '');
  const graded = new Map();
  for (const id of include.assignments) {
    const a = raw.assignments[id];
    if (a.gradingType === 'not_graded' || a.submissionTypes.includes('not_graded')) continue;
    graded.set(id, { title: a.title, type: 'Assignment', dueAt: a.dueAt, points: a.points,
      submit: submitText(a.submissionTypes), group: group(a.groupId) });
  }
  for (const id of include.discussions) {
    const d = raw.discussions[id];
    if (!d.graded) continue;
    graded.set(id, { title: d.title, type: 'Discussion', dueAt: d.dueAt, points: d.points,
      submit: SUBMIT.discussion_topic, group: group(d.groupId) });
  }
  for (const id of include.quizzes) {
    const q = raw.quizzes[id];
    if (q.quizType !== 'assignment' && q.quizType !== 'graded_survey') continue;
    graded.set(id, { title: q.title, type: 'Quiz', dueAt: q.dueAt, points: q.points,
      submit: SUBMIT.online_quiz, group: group(q.groupId) });
  }

  const rows = [];
  const used = new Set();
  for (const m of raw.modules) {
    if (!include.modules.has(m.id)) continue;
    for (const item of m.items) {
      const id = item.ref && (raw.aliases[item.ref] || item.ref);
      if (!item.published || !graded.has(id) || used.has(id)) continue;
      used.add(id);
      rows.push({ module: m.title, ...graded.get(id) });
    }
  }
  const time = (row) => (row.dueAt ? new Date(`${row.dueAt}Z`).getTime() : Infinity);
  const rest = [...graded].filter(([id]) => !used.has(id)).map(([, row]) => ({ module: null, ...row }));
  rest.sort((a, b) => time(a) - time(b) || a.title.localeCompare(b.title));
  return [...rows, ...rest];
}

export function trackerFileName(code, title) {
  const base = (code || title || 'Course').replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${base} submission tracker.xlsx`;
}

function col(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function header(ws, courseTitle, rows, dueText) {
  ws.getCell('A1').value = courseTitle;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A3').value = 'Student name';
  ws.getCell('B3').value = 'Email';
  rows.forEach((row, i) => {
    const c = col(3 + i);
    ws.getCell(`${c}1`).value = row.title;
    ws.getCell(`${c}2`).value = dueText(row);
    ws.getCell(`${c}3`).value = row.points == null ? '' : `${row.points} pts`;
    ws.getColumn(3 + i).width = 18;
  });
  for (const r of [1, 2, 3]) ws.getRow(r).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(3).font = { bold: true };
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 30;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
}

export function buildTracker(ExcelJS, { courseTitle, rows, instructions, studentRows = 60 }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Course backup site';
  const first = 4;
  const last = first + studentRows - 1;
  const n = rows.length;
  const lastCol = col(2 + n);
  const dueText = (row) => (row.dueAt ? `Due ${formatDate(row.dueAt)}` : 'No due date');

  const intro = wb.addWorksheet('Instructions');
  intro.getColumn(1).width = 110;
  instructions.forEach((line, i) => {
    const cell = intro.getCell(`A${i + 1}`);
    cell.value = line;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) cell.font = { bold: true, color: { argb: 'FF9B1C1C' } };
  });

  const list = wb.addWorksheet('Assignments', { views: [{ state: 'frozen', ySplit: 1 }] });
  list.columns = [
    { header: 'Module', key: 'module', width: 30 },
    { header: 'Assignment', key: 'title', width: 42 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Due', key: 'due', width: 22, style: { numFmt: 'ddd mmm d, h:mm AM/PM' } },
    { header: 'Points', key: 'points', width: 9 },
    { header: 'How students submit', key: 'submit', width: 26 },
    { header: 'Group', key: 'group', width: 20 },
  ];
  list.getRow(1).font = { bold: true };
  for (const row of rows) {
    list.addRow({ ...row, module: row.module || '', due: pacificWallClock(row.dueAt) });
  }
  list.autoFilter = { from: 'A1', to: `G${Math.max(1, n + 1)}` };

  const subs = wb.addWorksheet('Submissions');
  header(subs, courseTitle, rows, dueText);
  const missing = col(3 + n);
  subs.getCell(`${missing}3`).value = 'Missing';
  subs.getColumn(3 + n).width = 10;
  if (n > 0) {
    const range = `C${first}:${lastCol}${last}`;
    subs.dataValidations.add(range, {
      type: 'list', allowBlank: true, formulae: [STATUSES], showErrorMessage: true,
      errorTitle: 'Pick from the list', error: 'Choose Received, Late, Missing, or Excused.',
    });
    subs.addConditionalFormatting({
      ref: range,
      rules: [
        { type: 'cellIs', operator: 'equal', formulae: ['"Missing"'], priority: 1,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: MISSING_FILL } } } },
        { type: 'cellIs', operator: 'equal', formulae: ['"Late"'], priority: 2,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: LATE_FILL } } } },
      ],
    });
    for (let r = first; r <= last; r++) {
      subs.getCell(`${missing}${r}`).value = { formula: `COUNTIF(C${r}:${lastCol}${r},"Missing")` };
    }
  }

  const scores = wb.addWorksheet('Scores');
  header(scores, courseTitle, rows, dueText);
  const total = col(3 + n);
  const possible = col(4 + n);
  const percent = col(5 + n);
  scores.getCell(`${total}3`).value = 'Total';
  scores.getCell(`${possible}3`).value = 'Total possible';
  scores.getCell(`${percent}3`).value = 'Percent';
  for (const c of [3 + n, 4 + n, 5 + n]) scores.getColumn(c).width = 14;
  const possiblePoints = rows.reduce((sum, row) => sum + (row.points || 0), 0);
  if (n > 0) {
    scores.dataValidations.add(`C${first}:${lastCol}${last}`, {
      type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true,
      errorTitle: 'Numbers only', error: 'Type the points earned, as a number.',
    });
  }
  for (let r = first; r <= last; r++) {
    scores.getCell(`A${r}`).value = { formula: `IF(Submissions!A${r}="","",Submissions!A${r})` };
    scores.getCell(`B${r}`).value = { formula: `IF(Submissions!B${r}="","",Submissions!B${r})` };
    if (n > 0) scores.getCell(`${total}${r}`).value = { formula: `IF(COUNT(C${r}:${lastCol}${r})=0,"",SUM(C${r}:${lastCol}${r}))` };
    scores.getCell(`${possible}${r}`).value = possiblePoints;
    scores.getCell(`${percent}${r}`).value = { formula: `IF(${total}${r}="","",${total}${r}/${possible}${r})` };
    scores.getCell(`${percent}${r}`).numFmt = '0.0%';
  }
  return wb;
}
