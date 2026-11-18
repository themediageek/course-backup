// Publishing a course straight to the faculty member's GitHub repository,
// through GitHub's REST API, with a token they create once. The token is sent
// only to the GitHub API address.
import { toBase64 } from '../app/lib/crypto.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  // code: 'bad-token' | 'no-access' | 'not-found' | 'empty' | 'conflict' | 'too-large' | 'network' | 'failed'
  constructor(code, status, detail = '') {
    super(`GitHub ${code} (${status}) ${detail}`.trim());
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

// The name the new-site form gives a faculty member's repository.
export const DEFAULT_REPO = 'course-backup';

// GitHub's token form, filled in except for the repository, which the
// faculty member picks. Contents (write) uploads courses; Pages (read)
// shows whether Pages is on and when GitHub has finished publishing.
// Turning Pages on through the API would need admin rights over the
// repository, so the page asks the person to switch it on themselves.
export function tokenUrl(owner) {
  const params = new URLSearchParams({
    name: 'Course backup',
    description: 'Lets the course backup page publish and take down courses. Under Repository access, choose only your course backup repository.',
    ...(owner ? { target_name: owner } : {}),
    expires_in: '366',
    contents: 'write',
    pages: 'read',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

// GitHub's new-repository form, filled in to copy the site from a template.
export function templateUrl({ owner, repo }) {
  const params = new URLSearchParams({ template_owner: owner, template_name: repo, name: DEFAULT_REPO, visibility: 'public' });
  return `https://github.com/new?${params}`;
}

// Git's name for a file's contents: SHA-1 of "blob <size>\0" and the bytes.
// Equal names mean equal files, so unchanged site files are not sent again.
export async function gitBlobSha(data) {
  const bytes = typeof Blob !== 'undefined' && data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', all));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function errorFor(status, detail) {
  if (status === 401) return new GitHubError('bad-token', 401);
  if (status === 409 && /empty/i.test(detail)) return new GitHubError('empty', 409, detail.slice(0, 200));
  const code = status === 403 || status === 404 ? 'no-access'
    : status === 409 || status === 422 ? (/too large|size/i.test(detail) ? 'too-large' : 'conflict')
      : status === 413 ? 'too-large' : 'failed';
  return new GitHubError(code, status, detail.slice(0, 200));
}

function headersFor(token, withBody) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(withBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

// The GitHub account name that owns this key.
export async function whoAmI({ token, apiBase = API, fetchImpl = (...a) => fetch(...a) }) {
  let response;
  try {
    response = await fetchImpl(`${apiBase}/user`, { method: 'GET', headers: headersFor(token, false) });
  } catch (error) {
    throw new GitHubError('network', 0, error.message);
  }
  if (!response.ok) throw errorFor(response.status, await response.text().catch(() => ''));
  return (await response.json()).login;
}

async function base64Of(data) {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    if (typeof FileReader !== 'undefined') {
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(data);
      });
      return url.slice(url.indexOf(',') + 1);
    }
    return toBase64(new Uint8Array(await data.arrayBuffer()));
  }
  return toBase64(data);
}

export function createClient({ token, owner, repo, apiBase = API, fetchImpl = (...a) => fetch(...a) }) {
  const root = `/repos/${owner}/${repo}`;

  async function call(method, path, body, { allow404 = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: headersFor(token, Boolean(body)),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new GitHubError('network', 0, error.message);
    }
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw errorFor(response.status, await response.text().catch(() => ''));
    return response.status === 204 ? null : response.json();
  }

  async function upload(data) {
    const blob = await call('POST', `${root}/git/blobs`, { content: await base64Of(data), encoding: 'base64' });
    return blob.sha;
  }

  // The site files whose contents differ from what the repository holds.
  async function changedSiteFiles(siteFiles, branch) {
    if (!siteFiles.length) return [];
    const { tree } = await headState(branch);
    const all = await call('GET', `${root}/git/trees/${tree}?recursive=1`);
    const held = new Map(all.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
    const changed = [];
    for (const file of siteFiles) {
      if (held.get(file.path) !== await gitBlobSha(file.data)) changed.push(file);
    }
    return changed;
  }

  async function headState(branch) {
    const ref = await call('GET', `${root}/git/ref/heads/${branch}`);
    const commit = await call('GET', `${root}/git/commits/${ref.object.sha}`);
    return { head: ref.object.sha, tree: commit.tree.sha };
  }

  // The names of the files directly inside a folder at the top of the repository.
  async function folderFiles(treeSha, folder) {
    const top = await call('GET', `${root}/git/trees/${treeSha}`);
    const entry = top.tree.find((e) => e.path === folder && e.type === 'tree');
    if (!entry) return [];
    const inside = await call('GET', `${root}/git/trees/${encodeURIComponent(entry.sha)}?recursive=1`);
    return inside.tree.filter((e) => e.type === 'blob').map((e) => `${folder}/${e.path}`);
  }

  // One commit that sets these files (full paths) and removes the folder's
  // other files. Retried when the repository moved on in the meantime.
  async function commitFolder({ folder, uploads, branch, message }) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { head, tree } = await headState(branch);
      const keep = new Set(uploads.map((u) => u.path));
      const removals = (await folderFiles(tree, folder)).filter((p) => !keep.has(p));
      const entries = [
        ...uploads.map((u) => ({ path: u.path, mode: '100644', type: 'blob', sha: u.sha })),
        ...removals.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
      ];
      const newTree = await call('POST', `${root}/git/trees`, { base_tree: tree, tree: entries });
      const commit = await call('POST', `${root}/git/commits`, { message, tree: newTree.sha, parents: [head] });
      try {
        await call('PATCH', `${root}/git/refs/heads/${branch}`, { sha: commit.sha });
        return commit.sha;
      } catch (error) {
        if (error.code !== 'conflict' || attempt === 2) throw error;
      }
    }
    throw new GitHubError('conflict', 422);
  }

  return {
    // Checks that the repository exists, the key can change it, and it has
    // at least one commit. Returns the branch GitHub publishes by default.
    async check() {
      const info = await call('GET', root, null, { allow404: true });
      if (!info) throw new GitHubError('not-found', 404);
      if (info.permissions && info.permissions.push === false) throw new GitHubError('no-access', 403);
      const branch = info.default_branch || 'main';
      await headState(branch);
      return { branch };
    },

    // Where GitHub Pages serves the site, and whether it serves this branch
    // from the top folder. Null when Pages is off.
    async pagesSite(branch) {
      const site = await call('GET', `${root}/pages`, null, { allow404: true });
      if (!site) return null;
      const source = site.source || {};
      const ready = site.build_type !== 'workflow' && source.branch === branch && (source.path || '/') === '/';
      const url = site.html_url.endsWith('/') ? site.html_url : `${site.html_url}/`;
      return { url, ready };
    },

    // Uploads the course files into the folder and, in the same commit,
    // brings the site files up to date. Unchanged site files are not sent.
    async publish({ folder, files, branch, message, siteFiles = [], onProgress = () => {} }) {
      const site = await changedSiteFiles(siteFiles, branch);
      const total = files.length + site.length;
      const uploads = [];
      for (const file of files) {
        uploads.push({ path: `${folder}/${file.name}`, sha: await upload(file.data) });
        onProgress(uploads.length, total);
      }
      for (const file of site) {
        uploads.push({ path: file.path, sha: await upload(file.data) });
        onProgress(uploads.length, total);
      }
      return commitFolder({ folder, uploads, branch, message });
    },

    remove({ folder, branch, message }) {
      return commitFolder({ folder, uploads: [], branch, message });
    },

    async listCourses(branch) {
      const { tree } = await headState(branch);
      const all = await call('GET', `${root}/git/trees/${tree}?recursive=1`);
      const folders = all.tree
        .filter((e) => e.type === 'blob' && /^[^/]+\/key\.json$/.test(e.path))
        .map((e) => e.path.split('/')[0]);
      const courses = [];
      for (const folder of folders) {
        let title = folder;
        try {
          const file = await call('GET', `${root}/contents/${folder}/key.json?ref=${branch}`);
          const text = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
          title = JSON.parse(text).title || folder;
        } catch {
          // Keep the folder name as the title.
        }
        courses.push({ folder, title });
      }
      return courses;
    },

    // Waits until GitHub Pages has published this commit. Returns 'built',
    // 'errored', or 'timeout'.
    async waitForBuild(commitSha, { interval = 5000, timeout = 300000, onTick = () => {} } = {}) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const build = await call('GET', `${root}/pages/builds/latest`, null, { allow404: true });
        const status = build ? build.status : 'waiting';
        onTick(status);
        if (build && build.commit === commitSha && status === 'built') return 'built';
        if (build && build.commit === commitSha && status === 'errored') return 'errored';
        await new Promise((r) => setTimeout(r, interval));
      }
      return 'timeout';
    },
  };
}
