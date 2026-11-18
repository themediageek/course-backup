// Service worker for the course backup site.
//
// A course's files are stored encrypted, in pieces, inside bundle files. When
// the course page asks for <course>/f/<fileId>/<name>, this script fetches only
// the pieces it needs, decrypts them, and answers like an ordinary file, so
// PDFs open in the browser's viewer, videos can skip ahead, and downloads keep
// their names.
//
// This is a classic script because some browsers cannot load a service worker
// written as a module. parseRange, piecePlan, and inlineType copy the versions
// in app/lib/; tests/sw.test.js checks that they agree.
'use strict';

const PIECE_SIZE = 1048576;
const OVERHEAD = 28;
const GROUP = 8; // pieces fetched per request when streaming a whole file
const OPEN_ENDED_MEDIA_LIMIT = 2 * PIECE_SIZE;
const DB_NAME = 'course-backup';
const STORE = 'keys';
const NOT_OPEN_TEXT = 'This file belongs to a protected course. Open the course and type the password, then try this link again.';
const NOT_OPEN_LINK = 'Open the course';
const NOT_YET_TEXT = 'This file is not open yet. The course shows the date it opens.';

const courses = new Map();

// ---------- Copies of library functions ----------

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

function piecePlan(entry, start, end) {
  const first = Math.floor(start / PIECE_SIZE);
  const last = Math.floor(end / PIECE_SIZE);
  const count = Math.ceil(entry.size / PIECE_SIZE);
  const plan = [];
  let index = 0;
  for (const [bundle, offset, n] of entry.pieces) {
    let at = offset;
    for (let k = 0; k < n; k++, index++) {
      const plain = index === count - 1 ? entry.size - index * PIECE_SIZE : PIECE_SIZE;
      const length = plain + OVERHEAD;
      if (index >= first && index <= last) plan.push({ bundle, offset: at, length, index });
      at += length;
    }
  }
  return plan;
}

function inlineType(mime) {
  if (mime === 'image/svg+xml') return false;
  return mime === 'application/pdf' || mime === 'text/plain' ||
    mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
}

// True when a file has an opening date that is still ahead.
function opensLater(entry, now) {
  if (!entry || !entry.opensAt) return false;
  const text = entry.opensAt;
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return !Number.isNaN(date.getTime()) && date > now;
}

function matchFileUrl(pathname) {
  const m = /^(.*\/)f\/([^/]+)\/[^/]*$/.exec(pathname);
  return m ? { folder: m[1], fileId: decodeURIComponent(m[2]) } : null;
}

// ---------- Getting the course's key and file list ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rememberedKey(base) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(base);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function askOpenPages(base) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const answers = windows.map((client) => new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data && event.data.type === 'course' ? event.data : null);
    };
    client.postMessage({ type: 'need-course', base }, [channel.port2]);
  }));
  for (const answer of await Promise.all(answers)) if (answer) return answer;
  return null;
}

async function decrypt(key, bytes, aad) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(aad) }, key, bytes.subarray(12));
  return new Uint8Array(plain);
}

async function loadWithRememberedKey(base) {
  const key = await rememberedKey(base);
  if (!key) return null;
  try {
    const keyJson = await (await fetch(`${base}key.json`, { cache: 'no-cache' })).json();
    const sealed = new Uint8Array(await (await fetch(`${base}${keyJson.course}`)).arrayBuffer());
    const gz = await decrypt(key, sealed, 'course');
    const json = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const course = JSON.parse(json);
    return { type: 'course', base, key, files: course.files, bundles: course.bundles };
  } catch {
    return null;
  }
}

async function courseContext(base) {
  if (courses.has(base)) return courses.get(base);
  const context = (await askOpenPages(base)) || (await loadWithRememberedKey(base));
  if (context) courses.set(base, context);
  return context;
}

// ---------- Reading pieces ----------

async function fetchSpan(context, bundle, from, length) {
  const response = await fetch(`${context.base}${context.bundles[bundle]}`, {
    headers: { Range: `bytes=${from}-${from + length - 1}` },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return response.status === 206 ? bytes : bytes.subarray(from, from + length);
}

async function decryptPlan(context, fileId, plan) {
  const out = [];
  let i = 0;
  while (i < plan.length) {
    let j = i;
    while (j + 1 < plan.length && j - i + 1 < GROUP && plan[j + 1].bundle === plan[i].bundle &&
      plan[j + 1].offset === plan[j].offset + plan[j].length) j++;
    const from = plan[i].offset;
    const span = await fetchSpan(context, plan[i].bundle, from, plan[j].offset + plan[j].length - from);
    for (let k = i; k <= j; k++) {
      const p = plan[k];
      out.push(await decrypt(context.key, span.subarray(p.offset - from, p.offset - from + p.length), `${fileId}:${p.index}`));
    }
    i = j + 1;
  }
  return out;
}

async function readRange(context, fileId, entry, start, end) {
  const plan = piecePlan(entry, start, end);
  const pieces = await decryptPlan(context, fileId, plan);
  const joined = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) { joined.set(p, at); at += p.length; }
  const base = plan.length ? plan[0].index * PIECE_SIZE : 0;
  return joined.slice(start - base, end - base + 1);
}

function streamWhole(context, fileId, entry) {
  const plan = piecePlan(entry, 0, entry.size - 1);
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= plan.length) { controller.close(); return; }
      const group = plan.slice(i, i + GROUP);
      i += group.length;
      for (const piece of await decryptPlan(context, fileId, group)) controller.enqueue(piece);
    },
  });
}

// ---------- Answering requests ----------

function notOpenResponse(base, text = NOT_OPEN_TEXT) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NOT_OPEN_LINK}</title><style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 16px;line-height:1.6}</style></head>
<body><p>${text}</p><p><a href="${base}">${NOT_OPEN_LINK}</a></p></body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function serveFile(request, base, fileId, url) {
  const context = await courseContext(base);
  if (!context) return notOpenResponse(base);
  const entry = context.files[fileId];
  if (!entry) return new Response('Not found', { status: 404 });
  if (opensLater(entry, new Date())) return notOpenResponse(base, NOT_YET_TEXT);
  const labelId = entry.same || fileId;
  const inline = inlineType(entry.mime) && !url.searchParams.has('download');
  const headers = new Headers({
    'Content-Type': entry.mime,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
  });
  if (entry.size === 0) {
    headers.set('Content-Length', '0');
    return new Response(new Uint8Array(0), { status: 200, headers });
  }
  const range = parseRange(request.headers.get('Range'), entry.size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${entry.size}` } });
  }
  if (range) {
    let { start, end } = range;
    // Players ask for "bytes=N-"; answering a few megabytes at a time starts playback sooner.
    if (/bytes=\d+-$/.test(request.headers.get('Range').trim()) && /^(video|audio)\//.test(entry.mime)) {
      end = Math.min(end, start + OPEN_ENDED_MEDIA_LIMIT - 1);
    }
    const bytes = await readRange(context, labelId, entry, start, end);
    headers.set('Content-Range', `bytes ${start}-${end}/${entry.size}`);
    headers.set('Content-Length', String(bytes.length));
    return new Response(bytes, { status: 206, headers });
  }
  headers.set('Content-Length', String(entry.size));
  return new Response(streamWhole(context, labelId, entry), { status: 200, headers });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'course' && data.base) courses.set(data.base, data);
  if (data && data.type === 'forget' && data.base) courses.delete(data.base);
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const match = matchFileUrl(url.pathname);
  if (!match) return;
  event.respondWith(serveFile(event.request, url.origin + match.folder, match.fileId, url));
});

self.cbsInternals = { parseRange, piecePlan, inlineType, matchFileUrl, opensLater };
