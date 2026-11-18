// Tests for reading the site's own files so they can be copied into a
// faculty member's repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSiteFiles } from '../publish/site-files.js';

function fakeFetch(served) {
  const asked = [];
  const impl = async (url) => {
    asked.push(url);
    if (!(url in served)) return new Response('Not found', { status: 404 });
    return new Response(served[url], { status: 200 });
  };
  return { impl, asked };
}

test('loadSiteFiles reads the list and then every file on it, from the site root', async () => {
  const { impl, asked } = fakeFetch({
    'https://ann.github.io/site/site-files.json': JSON.stringify({ files: ['sw.js', 'app/site.js'] }),
    'https://ann.github.io/site/sw.js': 'worker',
    'https://ann.github.io/site/app/site.js': 'theme',
  });
  const files = await loadSiteFiles('https://ann.github.io/site/', impl);
  assert.deepEqual(files.map((f) => f.path), ['sw.js', 'app/site.js']);
  assert.equal(new TextDecoder().decode(files[0].data), 'worker');
  assert.equal(asked[0], 'https://ann.github.io/site/site-files.json');
});

test('a site without a file list copies nothing', async () => {
  const { impl } = fakeFetch({});
  assert.deepEqual(await loadSiteFiles('https://ann.github.io/site/', impl), []);
});

test('a listed file that will not load stops the copy with an error', async () => {
  const { impl } = fakeFetch({ 'https://ann.github.io/site/site-files.json': JSON.stringify({ files: ['sw.js'] }) });
  await assert.rejects(loadSiteFiles('https://ann.github.io/site/', impl), /sw\.js/);
});
