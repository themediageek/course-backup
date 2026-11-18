import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteHtml, isCanvasLink } from '../app/lib/links.js';
import { makeFileResolver } from '../app/lib/paths.js';
import { mimeFor, inlineType } from '../app/lib/mime.js';

const files = {
  f1: { path: "web_resources/Uploaded Media/O'Connor - Culture, After All.pdf" },
  f2: { path: 'web_resources/Uploaded Media/travel-04(2) (1).jpg' },
  f3: { path: 'web_resources/Week #3 notes.pdf' },
  f4: { path: 'web_resources/Lectures/café.pdf'.normalize('NFD') },
  gone: { path: 'web_resources/locked.pdf' },
};
const fileIds = makeFileResolver(files);
const resolve = {
  file: (path) => {
    const id = fileIds(path);
    return id && id !== 'gone' ? id : null;
  },
  page: (slug) => ({ welcome: 'pg1' }[slug] || null),
  object: (kind, id) => ({ 'assignments:as1': 'as1', 'assignments:dtA1': 'dt1', 'quizzes:qz1': 'qz1', 'modules:m1': 'm1' }[`${kind}:${id}`] || null),
};
const rw = (html) => rewriteHtml(html, resolve).html;

test('file links become cbs-file links and drop the Canvas query', () => {
  assert.equal(rw('<a href="$IMS-CC-FILEBASE$/Uploaded%20Media/O%27Connor%20-%20Culture%2C%20After%20All.pdf?canvas_=1&amp;canvas_qs_wrap=1">R</a>'),
    '<a href="cbs-file:f1">R</a>');
  assert.equal(rw('<img src="$IMS-CC-FILEBASE$/Uploaded%20Media/travel-04(2)%20(1).jpg?canvas_download=1" alt="x">'),
    '<img src="cbs-file:f2" alt="x">');
  assert.equal(rw('<a href="$IMS-CC-FILEBASE$/Week%20%233%20notes.pdf">N</a>'), '<a href="cbs-file:f3">N</a>');
  assert.equal(rw('<a href="$IMS-CC-FILEBASE$/Lectures/caf%C3%A9.pdf">C</a>'), '<a href="cbs-file:f4">C</a>');
});

test('a file path written with plain spaces resolves', () => {
  assert.equal(rw('<source src="$IMS-CC-FILEBASE$/Uploaded Media/travel-04(2) (1).jpg" data-media-type="video">'),
    '<source src="cbs-file:f2" data-media-type="video">');
});

test('a file that was left out becomes cbs-missing:file', () => {
  assert.equal(rw('<a href="$IMS-CC-FILEBASE$/locked.pdf">L</a>'), '<a href="cbs-missing:file">L</a>');
  assert.equal(rw('<a href="$IMS-CC-FILEBASE$/nothing-here.pdf">L</a>'), '<a href="cbs-missing:file">L</a>');
});

test('file links inside inline styles are rewritten', () => {
  assert.equal(rw('<div style="background: url(\'$IMS-CC-FILEBASE$/Uploaded%20Media/travel-04(2)%20(1).jpg\')">x</div>'),
    '<div style="background: url(\'cbs-file:f2\')">x</div>');
});

test('page and object links become cbs-item links or missing notes', () => {
  assert.equal(rw('<a href="$WIKI_REFERENCE$/pages/welcome">W</a>'), '<a href="cbs-item:pg1">W</a>');
  assert.equal(rw('<a href="$WIKI_REFERENCE$/pages/welcome#part-2">W</a>'), '<a href="cbs-item:pg1">W</a>');
  assert.equal(rw('<a href="$WIKI_REFERENCE$/pages/answer-key">K</a>'), '<a href="cbs-missing:item">K</a>');
  assert.equal(rw('<a href="$CANVAS_OBJECT_REFERENCE$/assignments/as1">A</a>'), '<a href="cbs-item:as1">A</a>');
  assert.equal(rw('<a href="$CANVAS_OBJECT_REFERENCE$/assignments/dtA1">D</a>'), '<a href="cbs-item:dt1">D</a>');
  assert.equal(rw('<a href="$CANVAS_OBJECT_REFERENCE$/quizzes/qz1">Q</a>'), '<a href="cbs-item:qz1">Q</a>');
  assert.equal(rw('<a href="$CANVAS_OBJECT_REFERENCE$/modules/m1">M</a>'), '<a href="cbs-modules:m1">M</a>');
  assert.equal(rw('<a href="$CANVAS_OBJECT_REFERENCE$/quizzes/gone">Q</a>'), '<a href="cbs-missing:item">Q</a>');
});

test('course-level Canvas links become site routes or a Canvas note', () => {
  assert.equal(rw('<a href="$CANVAS_COURSE_REFERENCE$/modules">M</a>'), '<a href="cbs-modules:">M</a>');
  assert.equal(rw('<a href="$CANVAS_COURSE_REFERENCE$/assignments/syllabus">S</a>'), '<a href="cbs-route:syllabus">S</a>');
  assert.equal(rw('<a href="$CANVAS_COURSE_REFERENCE$/assignments">A</a>'), '<a href="cbs-route:assignments">A</a>');
  assert.equal(rw('<a href="$CANVAS_COURSE_REFERENCE$/grades">G</a>'), '<a href="cbs-missing:canvas">G</a>');
  assert.equal(rw('<a href="$CANVAS_COURSE_REFERENCE$/external_tools/12">T</a>'), '<a href="cbs-missing:canvas">T</a>');
});

test('absolute Canvas links stay and are reported', () => {
  const out = rewriteHtml('<a href="https://canvas.example.edu/courses/698/files/1">F</a><a href="https://docs.google.com/x">G</a>', resolve);
  assert.match(out.html, /href="https:\/\/canvas\.example\.edu\/courses\/698\/files\/1"/);
  assert.deepEqual(out.canvasLinks, ['https://canvas.example.edu/courses/698/files/1']);
});

test('isCanvasLink', () => {
  assert.equal(isCanvasLink('https://canvas.example.edu/courses/698/files/1'), true);
  assert.equal(isCanvasLink('https://college.instructure.com/courses/1'), true);
  assert.equal(isCanvasLink('/courses/42534/pages/x'), true);
  assert.equal(isCanvasLink('/media_objects/m-123'), true);
  assert.equal(isCanvasLink('https://docs.google.com/document/d/1'), false);
  assert.equal(isCanvasLink('//cdn.example.com/x.js'), false);
  assert.equal(isCanvasLink('cbs-file:f1'), false);
  assert.equal(isCanvasLink('#top'), false);
});

test('mime types, and which files open in the browser', () => {
  assert.equal(mimeFor('Reading.PDF'), 'application/pdf');
  assert.equal(mimeFor('clip.mp4'), 'video/mp4');
  assert.equal(mimeFor('notes.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(mimeFor('no-extension'), 'application/octet-stream');
  assert.equal(inlineType('application/pdf'), true);
  assert.equal(inlineType('image/png'), true);
  assert.equal(inlineType('video/mp4'), true);
  assert.equal(inlineType('audio/mpeg'), true);
  assert.equal(inlineType('text/plain'), true);
  assert.equal(inlineType('image/svg+xml'), false, 'SVG can carry scripts');
  assert.equal(inlineType('text/html'), false, 'HTML can carry scripts');
  assert.equal(inlineType(mimeFor('notes.docx')), false);
});
