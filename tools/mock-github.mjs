// Local stand-in for GitHub, for trying the publish page without a real
// account or token. It serves the site, answers the GitHub API calls the
// page makes under /mock-api, and serves published courses from its memory.
// The key "test-key" belongs to the account "alice", whose repository is
// "course-backup". Opening the page as central/course-backup-site acts like a
// faculty member using someone else's publish page.
//   node tools/mock-github.mjs   then open
//   http://localhost:8795/publish/?repo=central/course-backup-site&api=/mock-api
// Options: --pages-off starts with GitHub Pages off, --empty makes the
// repository empty, --port=N picks the port. Development only.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeGitHub } from '../tests/helpers/fake-github.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const arg = (name) => process.argv.find((a) => a === name || a.startsWith(`${name}=`));
const port = Number((arg('--port') || '').split('=')[1]) || Number(process.env.PORT) || 8795;
const gh = createFakeGitHub({
  token: 'test-key',
  owner: 'alice',
  repo: 'course-backup',
  siteUrl: `http://localhost:${port}/`,
  pages: !arg('--pages-off'),
  empty: Boolean(arg('--empty')),
  files: { 'old-course/key.json': '{"format":1,"title":"Old Course","packId":"aaaaaaaa","course":"course-aaaaaaaa.bin"}' },
});

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream',
};

function sendBytes(req, res, bytes, type) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (range) {
    const start = range[1] === '' ? bytes.length - Number(range[2]) : Number(range[1]);
    const end = range[1] === '' || range[2] === '' ? bytes.length - 1 : Math.min(Number(range[2]), bytes.length - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 });
    res.end(bytes.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': bytes.length });
  res.end(bytes);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Stands in for clicking Save in GitHub's Pages settings.
  if (url.pathname === '/mock-turn-on-pages') {
    gh.state.pages = true;
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('GitHub Pages is on.');
    return;
  }
  if (url.pathname.startsWith('/mock-api/')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = await gh.handle(req.method, url.pathname.slice('/mock-api'.length) + url.search, body ? JSON.parse(body) : null, req.headers);
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.json));
    return;
  }
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const published = gh.filesAt();
  const fromRepo = published.get(path) || published.get(`${path.replace(/\/$/, '')}/index.html`);
  if (fromRepo) {
    sendBytes(req, res, fromRepo, types[extname(path)] || (path.endsWith('/') || !extname(path) ? types['.html'] : 'application/octet-stream'));
    return;
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403).end(); return; }
  try {
    let stat = statSync(file);
    if (stat.isDirectory()) { file = join(file, 'index.html'); stat = statSync(file); }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`Mock GitHub site at http://localhost:${port}/publish/?repo=central/course-backup-site&api=/mock-api (key: test-key)`));
