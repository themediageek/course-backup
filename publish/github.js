// Addresses on GitHub and on the published site, worked out from the
// packing page's own address (https://<owner>.github.io/<repo>/publish/).

export function githubRepoFromLocation(href) {
  const url = new URL(href);
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(url.hostname);
  if (!m) return null;
  const owner = m[1].toLowerCase();
  const first = url.pathname.split('/').filter(Boolean)[0];
  if (!first || first === 'publish') return { owner, repo: `${owner}.github.io` };
  return { owner, repo: first };
}

export function uploadUrl({ owner, repo }) {
  return `https://github.com/${owner}/${repo}/upload/main`;
}

export function folderUrl({ owner, repo }, folder) {
  return `https://github.com/${owner}/${repo}/tree/main/${folder}`;
}

export function pagesSettingsUrl({ owner, repo }) {
  return `https://github.com/${owner}/${repo}/settings/pages`;
}

// The site's top folder: the folder that holds pack/.
export function siteRoot(href) {
  return new URL('../', new URL('./', href)).href;
}

export function courseUrl(href, folder) {
  return `${siteRoot(href)}${folder}/`;
}
