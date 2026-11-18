// Tests for letting anyone publish into their own repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient, whoAmI, tokenUrl, templateUrl, gitBlobSha, GitHubError } from '../publish/github-api.js';
import { siteFiles } from '../tools/site-manifest.mjs';
import { createFakeGitHub } from './helpers/fake-github.js';

const enc = (s) => new TextEncoder().encode(s);
const client = (gh, repo = 'course-backup') => createClient({ token: 'good-token', owner: 'bea', repo, apiBase: 'https://api.test', fetchImpl: gh.fetch });

test('whoAmI names the account that owns the key', async () => {
  const gh = createFakeGitHub({ owner: 'bea', repo: 'course-backup' });
  assert.equal(await whoAmI({ token: 'good-token', apiBase: 'https://api.test', fetchImpl: gh.fetch }), 'bea');
  await assert.rejects(whoAmI({ token: 'nope', apiBase: 'https://api.test', fetchImpl: gh.fetch }), (e) => e.code === 'bad-token');
});

test('pagesSite gives the site address when GitHub Pages publishes from the main branch', async () => {
  const gh = createFakeGitHub({ owner: 'bea', repo: 'course-backup' });
  assert.deepEqual(await client(gh).pagesSite('main'), { url: 'https://bea.github.io/course-backup/', ready: true });
});

test('pagesSite gives null when GitHub Pages is off, and never tries to turn it on', async () => {
  const gh = createFakeGitHub({ owner: 'bea', repo: 'course-backup', pages: false });
  assert.equal(await client(gh).pagesSite('main'), null);
  assert.equal(gh.state.calls.filter((c) => c.startsWith('POST')).length, 0);
});

test('pagesSite says not ready when Pages publishes from another branch or folder', async () => {
  const docs = createFakeGitHub({ owner: 'bea', repo: 'course-backup', pagesSource: { branch: 'main', path: '/docs' } });
  assert.equal((await client(docs).pagesSite('main')).ready, false);
  const other = createFakeGitHub({ owner: 'bea', repo: 'course-backup', pagesSource: { branch: 'gh-pages', path: '/' } });
  assert.equal((await client(other).pagesSite('main')).ready, false);
});

test('gitBlobSha names contents the way Git does', async () => {
  assert.equal(await gitBlobSha(enc('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(await gitBlobSha(new Blob([enc('hello\n')])), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('publishing also brings the site code up to date, sending only changed files', async () => {
  const gh = createFakeGitHub({ owner: 'bea', repo: 'course-backup', files: { 'sw.js': 'old worker', 'app/styles.css': 'same styles', 'README.md': 'my notes' } });
  await client(gh).publish({
    folder: 'ocean-101', branch: 'main', message: 'Publish',
    files: [{ name: 'key.json', data: enc('{}') }],
    siteFiles: [{ path: 'sw.js', data: enc('new worker') }, { path: 'app/styles.css', data: enc('same styles') }, { path: 'app/site.js', data: enc('new file') }],
  });
  const files = gh.filesAt();
  assert.equal(files.get('sw.js').toString(), 'new worker');
  assert.equal(files.get('app/site.js').toString(), 'new file');
  assert.equal(files.get('README.md').toString(), 'my notes', 'files outside the site list stay as they are');
  assert.ok(files.has('ocean-101/key.json'));
  const blobPosts = gh.state.calls.filter((c) => c.endsWith('/git/blobs')).length;
  assert.equal(blobPosts, 3, 'key.json, sw.js, and site.js; the unchanged stylesheet is not sent');
});

test('an empty repository gets a plain error, when connecting and when publishing', async () => {
  const gh = createFakeGitHub({ owner: 'bea', repo: 'course-backup', empty: true });
  await assert.rejects(client(gh).check(), (e) => e instanceof GitHubError && e.code === 'empty');
  await assert.rejects(client(gh).publish({ folder: 'x1', branch: 'main', message: 'm', files: [{ name: 'key.json', data: enc('{}') }] }),
    (e) => e instanceof GitHubError && e.code === 'empty');
});

test('a repository the key cannot find gets its own error', async () => {
  const gh = createFakeGitHub({ owner: 'bea', repo: 'course-backup' });
  await assert.rejects(client(gh, 'no-such-repo').check(), (e) => e instanceof GitHubError && e.code === 'not-found');
});

test('without an owner, the key form leaves the account to the person and asks for no admin rights', () => {
  const url = new URL(tokenUrl());
  assert.equal(url.searchParams.get('contents'), 'write');
  assert.equal(url.searchParams.get('pages'), 'read');
  assert.equal(url.searchParams.get('target_name'), null);
  assert.equal(url.searchParams.get('administration'), null);
});

test('the new-site form starts from the template, public, named course-backup', () => {
  const url = new URL(templateUrl({ owner: 'romanf88-arch', repo: 'course-backup-site' }));
  assert.equal(url.origin + url.pathname, 'https://github.com/new');
  assert.equal(url.searchParams.get('template_owner'), 'romanf88-arch');
  assert.equal(url.searchParams.get('template_name'), 'course-backup-site');
  assert.equal(url.searchParams.get('name'), 'course-backup');
  assert.equal(url.searchParams.get('visibility'), 'public');
});

test('the site files never include a published course', async () => {
  const { execFileSync } = await import('node:child_process');
  const tracked = execFileSync('git', ['ls-files'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n');
  const courseFolders = tracked.filter((p) => /^[^/]+\/key\.json$/.test(p)).map((p) => p.split('/')[0]);
  const listed = siteFiles();
  for (const folder of courseFolders) {
    assert.ok(!listed.some((p) => p.startsWith(`${folder}/`)), `${folder} is a course, not part of the site`);
  }
  for (const path of listed) assert.match(path, /^(\.nojekyll|LICENSE|index\.html|sw\.js|(app|help|pack|publish|vendor)\/.+)$/, path);
});

test('site-files.json lists exactly the site files', () => {
  const listed = JSON.parse(readFileSync(new URL('../site-files.json', import.meta.url), 'utf8')).files;
  assert.deepEqual(listed, siteFiles());
  for (const left of ['README.md', 'package.json', 'tests/xml.test.js', 'tools/serve.mjs']) assert.ok(!listed.includes(left), left);
  for (const needed of ['sw.js', 'app/viewer/main.js', 'publish/index.html', 'vendor/zip.min.js', '.nojekyll']) assert.ok(listed.includes(needed), needed);
});
