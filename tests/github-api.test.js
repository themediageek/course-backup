import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, GitHubError, tokenUrl } from '../publish/github-api.js';
import { createTokenStore } from '../publish/token-store.js';
import { createFakeGitHub } from './helpers/fake-github.js';

const SITE = { 'index.html': '<!doctype html>', 'app/styles.css': 'body{}', 'old-course/key.json': '{"title":"Old Course"}', 'old-course/data-aaaaaaaa-000.bin': 'x' };
const bytes = (text) => new TextEncoder().encode(text);
const client = (gh, token = 'good-token') => createClient({ token, owner: 'alice', repo: 'course-backup-site', apiBase: 'https://api.test', fetchImpl: gh.fetch });

test('check accepts a working token and names the branch', async () => {
  const gh = createFakeGitHub({ files: SITE });
  assert.deepEqual(await client(gh).check(), { branch: 'main' });
});

test('check explains a token GitHub refuses and a token for another repository', async () => {
  const gh = createFakeGitHub({ files: SITE });
  await assert.rejects(client(gh, 'wrong').check(), (e) => e instanceof GitHubError && e.code === 'bad-token');
  const other = createClient({ token: 'good-token', owner: 'alice', repo: 'something-else', apiBase: 'https://api.test', fetchImpl: gh.fetch });
  await assert.rejects(other.check(), (e) => e instanceof GitHubError && e.code === 'not-found');
});

test('a network failure has its own code', async () => {
  const c = createClient({ token: 't', owner: 'a', repo: 'r', apiBase: 'https://api.test', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(c.check(), (e) => e.code === 'network');
});

test('publish puts every file under the link name in one commit and reports progress', async () => {
  const gh = createFakeGitHub({ files: SITE });
  const progress = [];
  const before = gh.head();
  const sha = await client(gh).publish({
    folder: 'ocean-101', branch: 'main', message: 'Publish Ocean 101',
    files: [{ name: 'key.json', data: bytes('{"title":"Ocean"}') }, { name: 'data-bbbbbbbb-000.bin', data: new Blob([bytes('\u0000\u0001\u0002')]) }],
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.notEqual(sha, before);
  assert.equal(gh.head(), sha);
  const files = gh.filesAt();
  assert.equal(files.get('ocean-101/key.json').toString(), '{"title":"Ocean"}');
  assert.deepEqual([...files.get('ocean-101/data-bbbbbbbb-000.bin')], [0, 1, 2]);
  assert.ok(files.has('app/styles.css'), 'the rest of the site is untouched');
  assert.deepEqual(progress.at(-1), [2, 2]);
  assert.equal(gh.state.calls.filter((c) => c.startsWith('PATCH')).length, 1);
});

test('publishing to an existing link replaces the old files in the same commit', async () => {
  const gh = createFakeGitHub({ files: SITE });
  await client(gh).publish({ folder: 'old-course', branch: 'main', message: 'Replace', files: [{ name: 'key.json', data: bytes('{"title":"New"}') }, { name: 'data-cccccccc-000.bin', data: bytes('y') }] });
  const files = gh.filesAt();
  assert.equal(files.has('old-course/data-aaaaaaaa-000.bin'), false);
  assert.equal(files.get('old-course/key.json').toString(), '{"title":"New"}');
  assert.ok(files.has('index.html'));
});

test('publish tries again when someone else changed the repository at the same moment', async () => {
  const gh = createFakeGitHub({ files: SITE });
  gh.state.conflictsLeft = 1;
  await client(gh).publish({ folder: 'ocean-101', branch: 'main', message: 'Publish', files: [{ name: 'key.json', data: bytes('{}') }] });
  assert.ok(gh.filesAt().has('ocean-101/key.json'));
  assert.equal(gh.state.calls.filter((c) => c.startsWith('PATCH')).length, 2);
  assert.equal(gh.state.calls.filter((c) => c.startsWith('POST /repos/alice/course-backup-site/git/blobs')).length, 1, 'files are uploaded once');
});

test('remove takes a course down and leaves everything else', async () => {
  const gh = createFakeGitHub({ files: SITE });
  await client(gh).remove({ folder: 'old-course', branch: 'main', message: 'Take down' });
  const files = gh.filesAt();
  assert.equal([...files.keys()].some((p) => p.startsWith('old-course/')), false);
  assert.ok(files.has('app/styles.css'));
});

test('listCourses finds folders that hold a key.json and reads their titles', async () => {
  const gh = createFakeGitHub({ files: { ...SITE, 'ocean-101/key.json': '{"title":"Ocean Studies 101"}', 'ocean-101/index.html': 'x' } });
  const courses = await client(gh).listCourses('main');
  assert.deepEqual(courses.sort((a, b) => a.folder.localeCompare(b.folder)), [
    { folder: 'ocean-101', title: 'Ocean Studies 101' },
    { folder: 'old-course', title: 'Old Course' },
  ]);
});

test('waitForBuild returns once GitHub has published the commit', async () => {
  const gh = createFakeGitHub({ files: SITE, buildSequence: ['building', 'building', 'built'] });
  const sha = await client(gh).publish({ folder: 'x1', branch: 'main', message: 'm', files: [{ name: 'key.json', data: bytes('{}') }] });
  const ticks = [];
  const result = await client(gh).waitForBuild(sha, { interval: 1, onTick: (s) => ticks.push(s) });
  assert.equal(result, 'built');
  assert.deepEqual(ticks, ['building', 'building', 'built']);
});

test('waitForBuild gives up after its time limit', async () => {
  const gh = createFakeGitHub({ files: SITE, buildSequence: Array(50).fill('building') });
  const result = await client(gh).waitForBuild('c00000001', { interval: 1, timeout: 20 });
  assert.equal(result, 'timeout');
});

test('the token link fills in the name, owner, one-year expiry, and two permissions', () => {
  const url = new URL(tokenUrl('alice'));
  assert.equal(url.origin + url.pathname, 'https://github.com/settings/personal-access-tokens/new');
  assert.equal(url.searchParams.get('target_name'), 'alice');
  assert.equal(url.searchParams.get('expires_in'), '366');
  assert.equal(url.searchParams.get('contents'), 'write');
  assert.equal(url.searchParams.get('pages'), 'read');
  assert.ok(url.searchParams.get('name').length <= 40);
  assert.equal(url.searchParams.get('administration'), null);
});

function memoryStorage(fail = false) {
  const data = new Map();
  return {
    getItem: (k) => { if (fail) throw new Error('blocked'); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { if (fail) throw new Error('blocked'); data.set(k, v); },
    removeItem: (k) => { if (fail) throw new Error('blocked'); data.delete(k); },
    data,
  };
}

test('the token stays for the session unless the faculty member asks to remember it', () => {
  const session = memoryStorage();
  const local = memoryStorage();
  const store = createTokenStore({ session, local });
  store.save('abc', false);
  assert.equal(session.data.size, 1);
  assert.equal(local.data.size, 0);
  assert.equal(store.load(), 'abc');
  store.save('def', true);
  assert.equal(local.data.size, 1);
  assert.equal(session.data.size, 0);
  assert.equal(store.load(), 'def');
  assert.equal(store.remembered(), true);
  store.clear();
  assert.equal(store.load(), null);
});

test('the store keeps the repository name with the key, in the same place', () => {
  const session = memoryStorage();
  const local = memoryStorage();
  const store = createTokenStore({ session, local });
  store.save('abc', true, 'course-backup');
  assert.equal(store.repo(), 'course-backup');
  assert.equal(local.data.size, 2);
  store.save('abc', false, 'my-site');
  assert.equal(store.repo(), 'my-site');
  assert.equal(local.data.size, 0);
  store.clear();
  assert.equal(store.repo(), null);
  local.setItem('cbs-github-token', 'saved-before-names');
  assert.equal(store.load(), 'saved-before-names');
  assert.equal(store.repo(), null, 'a key saved before the page kept names has no name');
});

test('blocked storage does not break the page', () => {
  const store = createTokenStore({ session: memoryStorage(true), local: memoryStorage(true) });
  store.save('abc', true);
  assert.equal(store.load(), null);
  store.clear();
});

test('the publish page may connect only to its own site and the GitHub API', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../publish/index.html', import.meta.url), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /connect-src 'self' https:\/\/api\.github\.com;/);
});
