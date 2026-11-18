// Tests for the findings of the final review, written before the fixes.
import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import vm from 'node:vm';
import { safeUrl } from '../app/lib/links.js';
import { selectContent } from '../app/lib/select.js';
import { buildCourse } from '../app/lib/build-course.js';
import { zipWriter } from '../app/lib/writers.js';
import { openZip } from '../app/lib/zip-source.js';
import { makeKeyFile, unlockTyped } from '../app/lib/crypto.js';
import { COURSE_INDEX_HTML } from '../app/lib/course-index.js';
import { zipLib } from './helpers/make-export.js';
import { sampleBuilt, NOW } from './helpers/sample-built.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.github.io/site/ocean/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
const DOMPurify = createDOMPurify(dom.window);
const file = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ---------- Critical 1: unsafe link addresses ----------

test('safeUrl allows only http, https, and mailto', () => {
  assert.equal(safeUrl('https://tidesandcurrents.noaa.gov/'), 'https://tidesandcurrents.noaa.gov/');
  assert.equal(safeUrl('http://example.org/a'), 'http://example.org/a');
  assert.equal(safeUrl('mailto:someone@example.edu'), 'mailto:someone@example.edu');
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', '/courses/1', '', null]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test('build drops link and tool addresses that are not http, https, or mailto', async () => {
  const { raw } = await sampleBuilt();
  const items = raw.modules[0].items;
  items.find((i) => i.type === 'ExternalUrl').url = 'javascript:alert(document.domain)';
  items.find((i) => i.type === 'ContextExternalTool').url = 'javascript:alert(2)';
  raw.tools.lti1.url = 'javascript:alert(3)';
  const { course } = buildCourse(raw, selectContent(raw, { now: NOW, exclude: new Set() }), { packId: 'aaaaaaaa', instructor: {}, now: NOW });
  const types = course.modules[0].items.map((i) => i.type);
  assert.ok(!types.includes('link'), 'the unsafe link item is dropped');
  assert.equal(course.items.i7.url, null);
  assert.ok(!JSON.stringify(course).includes('javascript:'));
});

test('the viewer never writes an unsafe address into a link', async () => {
  const { modulesView, itemView } = await import('../app/viewer/views.js');
  const { course } = await sampleBuilt();
  course.modules[0].items.find((i) => i.type === 'link').url = 'javascript:alert(1)';
  course.items.i7.url = 'javascript:alert(2)';
  const ctx = { course, files: { url: () => null, blob: async () => new Blob() }, now: NOW, DOMPurify };
  const html = modulesView(ctx).node.outerHTML + itemView(ctx, 'i7').node.outerHTML;
  assert.doesNotMatch(html, /javascript:/);
});

test('every page carries a script policy and has no inline scripts', () => {
  const pages = { 'course index': COURSE_INDEX_HTML, 'index.html': file('index.html'), 'publish/index.html': file('publish/index.html'), 'pack/index.html': file('pack/index.html'), 'help/index.html': file('help/index.html') };
  for (const [name, html] of Object.entries(pages)) {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    assert.ok(csp, `${name} has a Content-Security-Policy`);
    assert.match(csp[1], /script-src 'self'(;|$)/, name);
    assert.match(csp[1], /object-src 'none'/, name);
    assert.match(csp[1], /base-uri 'none'/, name);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\ssrc=/, `${name} has an inline script`);
  }
});

test('the template ships no page that loads an export from an address', () => {
  assert.equal(existsSync(new URL('../app/dev-preview.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('../app/dev-preview.js', import.meta.url)), false);
});

// ---------- Important 2: content that opens later ----------

test('build marks when each item and file opens, counting its module', async () => {
  const { course } = await sampleBuilt();
  assert.equal(course.items.pg3.opensAt, '2030-01-07T08:00:00', 'storm surge is only in Week 9');
  assert.equal(course.items.pg1.opensAt, null);
  assert.equal(course.files.f1.opensAt, null);
});

test('search does not show content that has not opened', async () => {
  const { buildIndex, search } = await import('../app/viewer/search.js');
  const { course } = await sampleBuilt();
  assert.deepEqual(search(buildIndex(course, NOW), 'storms'), []);
  assert.deepEqual(search(buildIndex(course, new Date('2031-01-01T00:00:00Z')), 'storms').map((r) => r.id), ['pg3']);
});

test('links and images to a file that has not opened become notes', async () => {
  const { cleanHtml, resolveLinks } = await import('../app/viewer/sanitize.js');
  const course = {
    nav: {}, items: {}, modules: [],
    files: { f9: { name: 'Answers.pdf', mime: 'application/pdf', opensAt: '2030-01-07T08:00:00' } },
  };
  const files = { url: (id) => `https://example.github.io/site/ocean/f/${id}/x.pdf`, blob: async () => new Blob() };
  const fragment = cleanHtml('<a href="cbs-file:f9">Key</a><img src="cbs-file:f9" alt="Chart">', DOMPurify);
  resolveLinks(fragment, { course, files, now: NOW, document });
  const div = document.createElement('div');
  div.appendChild(fragment);
  assert.doesNotMatch(div.innerHTML, /\/f\/f9\//);
  assert.match(div.innerHTML, /Opens/);
});

test('the service worker refuses a file that has not opened', () => {
  const self = { location: { origin: 'https://example.github.io' }, addEventListener: () => {}, clients: {} };
  vm.runInNewContext(file('sw.js'), { self, console, URL, Headers: class {}, Response: class {} });
  const { opensLater } = self.cbsInternals;
  assert.equal(opensLater({ opensAt: '2030-01-07T08:00:00' }, NOW), true);
  assert.equal(opensLater({ opensAt: '2020-01-07T08:00:00' }, NOW), false);
  assert.equal(opensLater({ opensAt: null }, NOW), false);
});

// ---------- Important 3: identical copies ----------

test('leaving out a file also leaves out its identical copies', async () => {
  const { raw } = await sampleBuilt();
  const selection = selectContent(raw, { now: NOW, exclude: new Set(['f1']) });
  assert.equal(selection.include.files.has('f1'), false);
  assert.equal(selection.include.files.has('f7'), false, 'Culture copy.pdf has the same bytes');
  assert.deepEqual(selection.leftOut.chosen.filter((c) => c.kind === 'file').map((c) => c.id), ['f1']);
});

// ---------- Important 4: zip layout ----------

test('the zip holds the course files at its top level', async () => {
  const out = zipWriter(zipLib, 'ocean-101');
  await out.write('key.json', new TextEncoder().encode('{}'));
  await out.write('index.html', new TextEncoder().encode('<!doctype html>'));
  const back = await openZip(zipLib, await out.close());
  assert.deepEqual(back.names.sort(), ['index.html', 'key.json']);
});

// ---------- Re-graded minors ----------

test('a password typed with a capital first letter still opens the course', async () => {
  const { keyJson } = await makeKeyFile({ title: 'T', packId: 'aaaaaaaa', password: 'maple river canyon sound' });
  await unlockTyped(keyJson, 'Maple river canyon sound');
  await assert.rejects(unlockTyped(keyJson, 'Maple river'));
});

test('remembering a key that cannot be stored does not stop the course from opening', async () => {
  const { rememberSafely } = await import('../app/viewer/keystore.js');
  assert.equal(await rememberSafely(async () => { throw new Error('blocked'); }, 'base', {}), false);
  assert.equal(await rememberSafely(async () => {}, 'base', {}), true);
});

test('the password button names itself by its visible text', async () => {
  const { showPasswordScreen } = await import('../app/viewer/password.js');
  const root = document.createElement('div');
  document.body.appendChild(root);
  showPasswordScreen(root, { title: 'Ocean 101', onSubmit: async () => {} });
  const toggle = root.querySelector('button[aria-pressed]');
  assert.equal(toggle.getAttribute('aria-label'), null);
  assert.equal(toggle.textContent, 'Show password');
  toggle.click();
  assert.equal(toggle.textContent, 'Hide password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
});

test('sidebar rows say their type and when they open in words', async () => {
  const { outlineList } = await import('../app/viewer/views.js');
  const { course } = await sampleBuilt();
  const ctx = { course, files: { url: () => null, blob: async () => new Blob() }, now: NOW, DOMPurify };
  const outline = outlineList(ctx);
  const tideJournal = [...outline.querySelectorAll('a')].find((a) => a.textContent.includes('Tide journal'));
  assert.match(tideJournal.textContent, /Assignment/);
  assert.ok(tideJournal.querySelector('.visually-hidden'));
  const storm = [...outline.querySelectorAll('li')].find((li) => li.textContent.includes('Storm surge'));
  assert.match(storm.textContent, /Opens/);
});
