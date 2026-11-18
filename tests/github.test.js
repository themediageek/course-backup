import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubRepoFromLocation, uploadUrl, folderUrl, courseUrl, siteRoot } from '../publish/github.js';

test('finds the repository from a project site address', () => {
  assert.deepEqual(githubRepoFromLocation('https://alice.github.io/course-backup-site/publish/'), { owner: 'alice', repo: 'course-backup-site' });
  assert.deepEqual(githubRepoFromLocation('https://Alice.github.io/course-backup-site/publish/index.html?x=1'), { owner: 'alice', repo: 'course-backup-site' });
});

test('finds the repository from a user site address', () => {
  assert.deepEqual(githubRepoFromLocation('https://alice.github.io/publish/'), { owner: 'alice', repo: 'alice.github.io' });
});

test('other hosts give no repository', () => {
  assert.equal(githubRepoFromLocation('http://localhost:8793/publish/'), null);
  assert.equal(githubRepoFromLocation('https://courses.example.edu/publish/'), null);
});

test('GitHub page addresses', () => {
  const repo = { owner: 'alice', repo: 'course-backup-site' };
  assert.equal(uploadUrl(repo), 'https://github.com/alice/course-backup-site/upload/main');
  assert.equal(folderUrl(repo, 'ocean-101'), 'https://github.com/alice/course-backup-site/tree/main/ocean-101');
});

test('the course link sits beside the packing page', () => {
  assert.equal(siteRoot('https://alice.github.io/course-backup-site/publish/'), 'https://alice.github.io/course-backup-site/');
  assert.equal(courseUrl('https://alice.github.io/course-backup-site/publish/index.html', 'ocean-101'), 'https://alice.github.io/course-backup-site/ocean-101/');
  assert.equal(courseUrl('http://localhost:8793/publish/', 'las'), 'http://localhost:8793/las/');
});
