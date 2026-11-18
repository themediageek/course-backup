import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { cleanHtml, resolveLinks } from '../app/viewer/sanitize.js';

// DOMPurify needs a fuller DOM than linkedom provides, so these tests use jsdom.
const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
const { document } = window;
const DOMPurify = createDOMPurify(window);
const NOW = new Date('2026-11-17T12:00:00Z');

function html(fragment) {
  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML;
}

const course = {
  nav: { syllabus: true, assignments: false, pages: true, files: true },
  items: { pg1: { type: 'page', title: 'Welcome' }, pg3: { type: 'page', title: 'Later', unlockAt: '2030-01-07T08:00:00' } },
  files: {
    f1: { name: 'Reading.pdf', mime: 'application/pdf', hidden: false },
    f2: { name: 'photo.jpg', mime: 'image/jpeg', hidden: true },
    f3: { name: 'notes.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  },
  modules: [{ id: 'm1', items: [] }],
};
const swFiles = { url: (id) => `https://example.github.io/site/course/f/${id}/${encodeURIComponent(course.files[id].name)}`, blob: async () => new Blob() };
const noSwFiles = { url: () => null, blob: async () => new Blob(['x']) };

function render(input, files = swFiles) {
  const fragment = cleanHtml(input, DOMPurify);
  resolveLinks(fragment, { course, files, now: NOW, document });
  return html(fragment);
}

test('scripts, event handlers, and javascript links are removed', () => {
  const out = render('<p onclick="steal()">Hi<script>steal()</script></p><a href="javascript:steal()">x</a><img src="x" onerror="steal()">');
  assert.doesNotMatch(out, /script|onclick|onerror|javascript:/i);
  assert.match(out, /Hi/);
});

test('https iframes stay and other iframes go', () => {
  assert.match(render('<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>'), /<iframe[^>]*src="https:\/\/www\.youtube\.com\/embed\/abc"/);
  assert.doesNotMatch(render('<iframe src="http://example.com/x"></iframe>'), /<iframe/);
});

test('style tags are removed, inline styles stay', () => {
  const out = render('<style>body{display:none}</style><p style="color: red">x</p>');
  assert.doesNotMatch(out, /<style/);
  assert.match(out, /style="color: red"/);
});

test('internal links become site routes and file addresses', () => {
  const out = render('<a href="cbs-item:pg1">W</a><a href="cbs-modules:m1">M</a><a href="cbs-route:syllabus">S</a><a href="cbs-file:f1">R</a><img src="cbs-file:f2" alt="Beach">');
  assert.match(out, /href="#\/item\/pg1"/);
  assert.match(out, /href="#\/modules\/m1"/);
  assert.match(out, /href="#\/syllabus"/);
  assert.match(out, /href="https:\/\/example\.github\.io\/site\/course\/f\/f1\/Reading\.pdf"[^>]*target="_blank"/);
  assert.match(out, /<img src="https:\/\/example\.github\.io\/site\/course\/f\/f2\/photo\.jpg" alt="Beach">/);
});

test('a file that cannot open in the browser links without a new tab', () => {
  const out = render('<a href="cbs-file:f3">Notes</a>');
  assert.match(out, /href="https:\/\/example\.github\.io\/site\/course\/f\/f3\/notes\.docx"/);
  assert.doesNotMatch(out, /target="_blank"/);
});

test('without a service worker, file links go to the file page', () => {
  const out = render('<a href="cbs-file:f1">R</a><img src="cbs-file:f2" alt="Beach">', noSwFiles);
  assert.match(out, /href="#\/file\/f1"/);
  assert.match(out, /<img[^>]*data-cbs-file="f2"/);
});

test('missing content and hidden lists become plain notes', () => {
  const out = render('<a href="cbs-missing:file">Key</a><a href="cbs-missing:item">Answers</a><a href="cbs-route:assignments">All work</a><a href="cbs-missing:canvas">Grades</a>');
  assert.doesNotMatch(out, /href="cbs-/);
  assert.match(out, /<span class="missing-note">Key/);
  assert.match(out, /<span class="missing-note">Answers/);
  assert.match(out, /<span class="missing-note">All work/);
  assert.match(out, /<span class="missing-note">Grades/);
});

test('Canvas links get a label, and links to Canvas media are replaced', () => {
  const out = render('<a href="https://canvas.example.edu/courses/698/files/1">Old</a><iframe src="/media_attachments_iframe/123"></iframe><a href="/courses/5/pages/x">Rel</a>');
  assert.match(out, /href="https:\/\/canvas\.example\.edu\/courses\/698\/files\/1"[^>]*>Old<\/a><span class="canvas-label">/);
  assert.doesNotMatch(out, /media_attachments_iframe/);
  assert.match(out, /class="missing-note"/);
  assert.doesNotMatch(out, /href="\/courses/);
});

test('outside links open in a new tab safely', () => {
  const out = render('<a href="https://docs.google.com/x">Doc</a>');
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
});
