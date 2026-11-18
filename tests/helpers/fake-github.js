import { createHash } from 'node:crypto';

// Git names a file's contents by the SHA-1 of "blob <size>\0<bytes>".
function gitSha(buffer) {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buffer.length}\0`), buffer])).digest('hex');
}

// A stand-in for the parts of GitHub's REST API the publish page uses:
// repository check, Git data (refs, commits, trees, blobs), file contents,
// and the latest Pages build. Used by unit tests and by tools/mock-github.mjs.

export function createFakeGitHub({
  owner = 'alice', repo = 'course-backup-site', token = 'good-token', files = {}, buildSequence = null,
  pages = true, empty = false, pagesSource = { branch: 'main', path: '/' }, siteUrl: siteUrlOption = null,
} = {}) {
  let counter = 0;
  const newSha = (prefix) => `${prefix}${(++counter).toString(16).padStart(8, '0')}`;
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const state = { conflictsLeft: 0, calls: [], builds: buildSequence ? [...buildSequence] : null, pages, empty };
  const siteUrl = siteUrlOption || (repo === `${owner}.github.io` ? `https://${owner}.github.io/` : `https://${owner}.github.io/${repo}/`);

  const initial = new Map();
  for (const [path, content] of Object.entries(files)) {
    const buffer = Buffer.from(content);
    const sha = gitSha(buffer);
    blobs.set(sha, buffer.toString('base64'));
    initial.set(path, sha);
  }
  const rootTree = newSha('t');
  trees.set(rootTree, initial);
  let head = newSha('c');
  commits.set(head, { tree: rootTree, parents: [], message: 'Initial commit' });

  // Entries under a folder of a tree, the way GitHub lists them.
  function listing(flat, dir, recursive) {
    const prefix = dir ? `${dir}/` : '';
    const out = new Map();
    for (const [path, sha] of flat) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const parts = rest.split('/');
      if (parts.length === 1) out.set(rest, { path: rest, type: 'blob', mode: '100644', sha });
      else {
        for (let i = 1; i < (recursive ? parts.length : 2); i++) {
          const sub = parts.slice(0, i).join('/');
          out.set(sub, { path: sub, type: 'tree', mode: '040000', sha: `T${encodeURIComponent(`${treeIdOf(flat)}|${prefix}${sub}`)}` });
        }
        if (recursive) out.set(rest, { path: rest, type: 'blob', mode: '100644', sha });
      }
    }
    return [...out.values()];
  }
  function treeIdOf(flat) {
    for (const [id, t] of trees) if (t === flat) return id;
    return '';
  }

  async function handle(method, path, body, headers = {}) {
    state.calls.push(`${method} ${path}`);
    if (headers.authorization !== `Bearer ${token}`) return { status: 401, json: { message: 'Bad credentials' } };
    if (method === 'GET' && path === '/user') return { status: 200, json: { login: owner } };
    const base = `/repos/${owner}/${repo}`;
    if (!path.startsWith(base)) return { status: 404, json: { message: 'Not Found' } };
    const rest = path.slice(base.length);
    const [route, query = ''] = rest.split('?');

    if (method === 'GET' && route === '') {
      return { status: 200, json: { full_name: `${owner}/${repo}`, default_branch: 'main', permissions: { push: true } } };
    }
    if (method === 'GET' && route === '/pages') {
      return state.pages
        ? { status: 200, json: { html_url: siteUrl, status: 'built', build_type: 'legacy', source: pagesSource } }
        : { status: 404, json: { message: 'Not Found' } };
    }
    if (method === 'POST' && route === '/pages') {
      if (state.pages) return { status: 409, json: { message: 'GitHub Pages is already enabled.' } };
      state.pages = true;
      return { status: 201, json: { html_url: siteUrl } };
    }
    if (state.empty && route.startsWith('/git/')) return { status: 409, json: { message: 'Git Repository is empty.' } };
    if (method === 'GET' && route === '/git/ref/heads/main') return { status: 200, json: { object: { sha: head } } };
    let m = /^\/git\/commits\/(.+)$/.exec(route);
    if (method === 'GET' && m) {
      const c = commits.get(m[1]);
      return c ? { status: 200, json: { sha: m[1], tree: { sha: c.tree } } } : { status: 404, json: {} };
    }
    m = /^\/git\/trees\/(.+)$/.exec(route);
    if (method === 'GET' && m) {
      let id = decodeURIComponent(m[1]);
      let dir = '';
      if (id.startsWith('T')) [id, dir] = decodeURIComponent(id.slice(1)).split('|');
      const flat = trees.get(id);
      if (!flat) return { status: 404, json: {} };
      return { status: 200, json: { sha: m[1], tree: listing(flat, dir, query.includes('recursive=1')), truncated: false } };
    }
    if (method === 'POST' && route === '/git/blobs') {
      const sha = gitSha(Buffer.from(body.content, 'base64'));
      blobs.set(sha, body.content);
      return { status: 201, json: { sha } };
    }
    if (method === 'POST' && route === '/git/trees') {
      const flat = new Map(trees.get(body.base_tree) || []);
      for (const entry of body.tree) {
        if (entry.sha === null) flat.delete(entry.path);
        else flat.set(entry.path, entry.sha);
      }
      const sha = newSha('t');
      trees.set(sha, flat);
      return { status: 201, json: { sha } };
    }
    if (method === 'POST' && route === '/git/commits') {
      const sha = newSha('c');
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return { status: 201, json: { sha } };
    }
    if (method === 'PATCH' && route === '/git/refs/heads/main') {
      const next = commits.get(body.sha);
      if (state.conflictsLeft > 0) {
        state.conflictsLeft--;
        const other = newSha('c');
        commits.set(other, { tree: commits.get(head).tree, parents: [head], message: 'someone else' });
        head = other;
        return { status: 422, json: { message: 'Update is not a fast forward' } };
      }
      if (!next || next.parents[0] !== head) return { status: 422, json: { message: 'Update is not a fast forward' } };
      head = body.sha;
      return { status: 200, json: { object: { sha: head } } };
    }
    m = /^\/contents\/(.+)$/.exec(route);
    if (method === 'GET' && m) {
      const flat = trees.get(commits.get(head).tree);
      const sha = flat.get(decodeURIComponent(m[1]));
      return sha ? { status: 200, json: { encoding: 'base64', content: blobs.get(sha) } } : { status: 404, json: { message: 'Not Found' } };
    }
    if (method === 'GET' && route === '/pages/builds/latest') {
      const status = state.builds && state.builds.length ? state.builds.shift() : 'built';
      return { status: 200, json: { status, commit: head } };
    }
    return { status: 404, json: { message: 'Not Found' } };
  }

  async function fetchImpl(url, options = {}) {
    const u = new URL(url);
    const headers = {};
    for (const [k, v] of Object.entries(options.headers || {})) headers[k.toLowerCase()] = v;
    const body = options.body ? JSON.parse(options.body) : null;
    const { status, json } = await handle(options.method || 'GET', u.pathname + u.search, body, headers);
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  }

  function filesAt() {
    const flat = trees.get(commits.get(head).tree);
    const out = new Map();
    for (const [path, sha] of flat) out.set(path, Buffer.from(blobs.get(sha), 'base64'));
    return out;
  }

  return { handle, fetch: fetchImpl, state, filesAt, head: () => head };
}
