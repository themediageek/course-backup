// Rewrites the links Canvas writes into course HTML into the site's own
// link forms, which only the viewer resolves:
//   cbs-file:<fileId>      cbs-item:<id>      cbs-modules:[<moduleId>]
//   cbs-route:<syllabus|assignments|pages|files>
//   cbs-missing:file       cbs-missing:item   cbs-missing:canvas

const OBJECT_KINDS = {
  assignments: 'assignments', discussion_topics: 'discussions', quizzes: 'quizzes',
  modules: 'modules', pages: 'pages', wiki_pages: 'pages', attachments: 'files', files: 'files',
};
const COURSE_ROUTES = {
  'assignments/syllabus': 'syllabus', syllabus: 'syllabus', assignments: 'assignments',
  quizzes: 'assignments', pages: 'pages', wiki: 'pages', files: 'files',
};
const URL_ATTRS = new Set(['href', 'src', 'poster', 'data', 'action', 'cite', 'background']);

export function isCanvasLink(url) {
  const value = (url || '').trim();
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  const m = /^https?:\/\/([^/?#]+)/i.exec(value);
  return Boolean(m && /canvas|instructure/i.test(m[1]));
}

function rewriteUrl(url, resolve) {
  let m = /^\$IMS-CC-FILEBASE\$\/(.*)$/.exec(url);
  if (m) {
    const id = resolve.file(m[1]);
    return id ? `cbs-file:${id}` : 'cbs-missing:file';
  }
  m = /^\$WIKI_REFERENCE\$\/(?:pages|wiki)\/([^?#]+)/.exec(url);
  if (m) {
    let slug = m[1];
    try { slug = decodeURIComponent(slug); } catch { /* keep as written */ }
    const id = resolve.page(slug);
    return id ? `cbs-item:${id}` : 'cbs-missing:item';
  }
  m = /^\$CANVAS_OBJECT_REFERENCE\$\/([a-z_]+)\/([^?#/]+)/.exec(url);
  if (m) {
    const kind = OBJECT_KINDS[m[1]];
    const id = kind ? resolve.object(kind, m[2]) : null;
    if (!id) return kind === 'files' ? 'cbs-missing:file' : 'cbs-missing:item';
    if (kind === 'modules') return `cbs-modules:${id}`;
    if (kind === 'files') return `cbs-file:${id}`;
    return `cbs-item:${id}`;
  }
  m = /^\$CANVAS_COURSE_REFERENCE\$\/?([^?#]*)/.exec(url);
  if (m) {
    const path = m[1].replace(/\/+$/, '');
    if (path === 'modules' || path === '') return 'cbs-modules:';
    const route = COURSE_ROUTES[path];
    return route ? `cbs-route:${route}` : 'cbs-missing:canvas';
  }
  return url;
}

const PLACEHOLDER = /^\s*\$(IMS-CC-FILEBASE|WIKI_REFERENCE|CANVAS_OBJECT_REFERENCE|CANVAS_COURSE_REFERENCE)\$/;

export function rewriteHtml(html, resolve) {
  const canvasLinks = [];
  const out = (html || '').replace(/(\s)([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (whole, space, name, quoted, dq, sq) => {
    const quote = quoted[0];
    const value = dq !== undefined ? dq : sq;
    const attr = name.toLowerCase();
    let next = value;
    if (URL_ATTRS.has(attr)) {
      if (PLACEHOLDER.test(value)) {
        next = rewriteUrl(value.trim().replace(/&amp;/g, '&'), resolve);
      } else if (isCanvasLink(value) && (attr === 'href' || attr === 'src')) {
        canvasLinks.push(value.trim().replace(/&amp;/g, '&'));
      }
    } else if (attr === 'style' && value.includes('$')) {
      next = value
        .replace(/url\(\s*(['"])(\$.*?)\1\s*\)/g,
          (u, q, inner) => `url(${q}${rewriteUrl(inner.replace(/&amp;/g, '&'), resolve)}${q})`)
        .replace(/url\(\s*(\$[^)'"\s]+)\s*\)/g,
          (u, inner) => `url(${rewriteUrl(inner.replace(/&amp;/g, '&'), resolve)})`);
    }
    return next === value ? whole : `${space}${name}=${quote}${next}${quote}`;
  });
  return { html: out, canvasLinks };
}

// Link addresses that come straight from the export (module links, tools)
// skip DOMPurify, so only plain web and email addresses may become links.
// Browsers ignore spaces and control characters inside a scheme
// ("java\tscript:"), so those are removed before checking.
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  const cleaned = [...url].filter((c) => c.charCodeAt(0) > 32).join('');
  return /^(https?:\/\/[^/]|mailto:[^/])/i.test(cleaned) ? cleaned : null;
}
