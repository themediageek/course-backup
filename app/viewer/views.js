// The screens of the course viewer. Each view returns { title, node }.
import { h } from './dom.js';
import { icon } from './icons.js';
import { copy } from './copy.js';
import { formatDate, isOpen, parseDate } from '../lib/dates.js';
import { safeUrl } from '../lib/links.js';
import { inlineType } from '../lib/mime.js';
import { cleanHtml, resolveLinks } from './sanitize.js';
import { neighbors, placement } from './order.js';
import { buildIndex, search } from './search.js';

export const routeFor = (type, ref) => (type === 'file' ? `#/file/${ref}` : `#/item/${ref}`);

function prose(ctx, html) {
  const div = h('div', { class: 'prose' });
  const fragment = cleanHtml(html, ctx.DOMPurify);
  resolveLinks(fragment, { course: ctx.course, files: ctx.files, now: ctx.now });
  div.appendChild(fragment);
  return div;
}

function card(...children) {
  return h('article', { class: 'card content-card' }, ...children);
}

function pageTitle(text) {
  return h('h1', { class: 'page-title', tabindex: '-1', text });
}

function notice(text, kind = 'info') {
  return h('div', { class: `notice${kind === 'warn' ? ' notice-warn' : ''}`, role: kind === 'warn' ? 'note' : null },
    icon(kind === 'warn' ? 'warn' : 'info'), h('p', { text }));
}

function backLink() {
  return h('a', { class: 'back-link', href: '#/modules' }, icon('left'), ` ${copy.backToModules}`);
}

// The date an item or file opens, if it is still ahead. The packing step
// works out opensAt from the item's own date and its modules' dates.
function lockedUntil(ctx, data) {
  const date = data && data.opensAt;
  return date && !isOpen(date, ctx.now) ? date : null;
}

function gradedInfo(item) {
  if (item.type === 'assignment' || item.type === 'quiz') return true;
  return item.type === 'discussion' && item.graded;
}

function metaText(item) {
  const parts = [copy.types[item.type] || ''];
  if (gradedInfo(item)) {
    if (item.dueAt) parts.push(copy.due(formatDate(item.dueAt)));
    if (item.points != null) parts.push(copy.points(item.points));
  }
  return parts.filter(Boolean).join(' · ');
}

function fact(label, value) {
  return h('li', {}, h('span', { class: 'fact-label', text: label }), h('span', { class: 'fact-value', text: value }));
}

function rubricTable(rubric) {
  return [
    h('h2', { class: 'section-title', text: rubric.title ? `${copy.rubric}: ${rubric.title}` : copy.rubric }),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data rubric' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: copy.rubricCriteria }),
          h('th', { scope: 'col', text: copy.rubricRatings }), h('th', { scope: 'col', text: copy.rubricPoints }))),
        h('tbody', {}, rubric.criteria.map((c) => h('tr', {},
          h('th', { scope: 'row' }, h('div', { text: c.description }),
            c.longDescription ? h('div', { class: 'muted', text: c.longDescription }) : null),
          h('td', { 'data-label': copy.rubricRatings }, c.ratings.map((r) => h('span', { class: 'rating' },
            h('strong', { text: r.description }),
            r.points != null ? h('span', { class: 'rating-points', text: ` (${copy.points(r.points)})` }) : null,
            r.longDescription ? h('span', { class: 'muted', text: ` ${r.longDescription}` }) : null))),
          h('td', { 'data-label': copy.rubricPoints, text: c.points != null ? String(c.points) : '' }))))),
    ),
  ];
}

function prevNext(ctx, ref) {
  const { prev, next } = neighbors(ctx.course, ref);
  if (!prev && !next) return null;
  const link = (entry, label, cls) => h('a', { class: cls, href: routeFor(entry.type, entry.ref) },
    h('span', { class: 'pn-label', text: label }), h('span', { class: 'pn-title', text: entry.title }));
  return h('nav', { class: 'prevnext', 'aria-label': copy.prevNextLabel },
    prev ? link(prev, copy.previous, 'prev') : null,
    next ? link(next, copy.next, 'next') : null);
}

function crumb(ctx, ref) {
  const p = placement(ctx.course, ref);
  if (!p) return null;
  return h('p', { class: 'breadcrumb' }, h('a', { href: `#/modules/${p.moduleId}`, text: p.moduleTitle }));
}

// ---------- Item ----------

export function itemView(ctx, id) {
  const item = ctx.course.items[id];
  if (!item) return notFoundView();
  const locked = lockedUntil(ctx, item);
  const parts = [backLink(), crumb(ctx, id), pageTitle(item.title)];
  if (locked) {
    parts.push(notice(copy.lockedItem(formatDate(locked, ctx.now))));
    return { title: item.title, node: h('div', { class: 'content' }, card(...parts), prevNext(ctx, id)) };
  }
  if (item.type === 'page') {
    parts.push(prose(ctx, item.html));
  } else if (item.type === 'assignment') {
    parts.push(h('ul', { class: 'facts' },
      fact(copy.assignmentsDue, item.dueAt ? formatDate(item.dueAt, ctx.now) : copy.noDue),
      item.points != null ? fact(copy.assignmentsPoints, copy.points(item.points)) : null,
      item.groupTitle ? fact(copy.countsToward, item.groupTitle) : null));
    parts.push(prose(ctx, item.html));
    const kinds = (item.submissionTypes || []).map((t) => copy.submitTypes[t] || t);
    if (kinds.length) {
      parts.push(h('h2', { class: 'section-title', text: copy.submitHeading }), h('p', { text: kinds.join(', ') }));
    }
    parts.push(notice(copy.submitNote));
    if (item.rubric) parts.push(...rubricTable(item.rubric));
  } else if (item.type === 'discussion') {
    if (item.graded) {
      parts.push(h('ul', { class: 'facts' },
        fact(copy.assignmentsDue, item.dueAt ? formatDate(item.dueAt, ctx.now) : copy.noDue),
        item.points != null ? fact(copy.assignmentsPoints, copy.points(item.points)) : null));
    }
    parts.push(prose(ctx, item.html), notice(copy.discussionNote));
    if (item.rubric) parts.push(...rubricTable(item.rubric));
  } else if (item.type === 'quiz') {
    parts.push(h('ul', { class: 'facts' },
      fact(copy.assignmentsDue, item.dueAt ? formatDate(item.dueAt, ctx.now) : copy.noDue),
      item.points != null ? fact(copy.assignmentsPoints, copy.points(item.points)) : null,
      item.timeLimit ? fact(copy.timeLimitLabel, copy.minutes(item.timeLimit)) : null,
      fact(copy.attemptsLabel, copy.attempts(item.allowedAttempts))));
    parts.push(notice(copy.quizNote, 'warn'), prose(ctx, item.html));
  } else if (item.type === 'tool') {
    parts.push(notice(copy.toolNote, 'warn'));
    if (safeUrl(item.url)) {
      parts.push(h('p', {}, h('a', { class: 'btn', href: safeUrl(item.url), target: '_blank', rel: 'noopener noreferrer' },
        icon('external'), copy.toolTry, h('span', { class: 'visually-hidden', text: ` ${copy.newTab}` }))));
    }
  }
  return { title: item.title, node: h('div', { class: 'content' }, card(...parts), prevNext(ctx, id)) };
}

// ---------- File ----------

export function fileView(ctx, id) {
  const file = ctx.course.files[id];
  if (!file) return notFoundView();
  const locked = lockedUntil(ctx, file);
  const parts = [backLink(), crumb(ctx, id), pageTitle(file.name),
    h('div', { class: 'meta' }, h('span', { class: 'chip', text: copy.fileKind(file.mime) }), h('span', { class: 'chip', text: copy.size(file.size) }))];
  if (locked) {
    parts.push(notice(copy.lockedItem(formatDate(locked, ctx.now))));
    return { title: file.name, node: h('div', { class: 'content' }, card(...parts), prevNext(ctx, id)) };
  }
  const url = ctx.files.url(id);
  const view = h('div', { class: 'file-view' });
  const status = h('p', { class: 'muted', role: 'status' });
  if (file.mime.startsWith('image/') && inlineType(file.mime)) {
    view.appendChild(h('img', { alt: '', src: url, 'data-cbs-file': url ? null : id }));
  } else if (file.mime.startsWith('video/')) {
    view.appendChild(h('video', { controls: true, preload: 'metadata', src: url, 'data-cbs-file': url ? null : id }));
  } else if (file.mime.startsWith('audio/')) {
    view.appendChild(h('audio', { controls: true, preload: 'metadata', src: url, 'data-cbs-file': url ? null : id }));
  }
  const actions = h('div', { class: 'actions' });
  if (url) {
    if (inlineType(file.mime)) {
      actions.appendChild(h('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener' },
        icon('external'), copy.fileOpen, h('span', { class: 'visually-hidden', text: ` ${copy.newTab}` })));
    }
    actions.appendChild(h('a', { class: inlineType(file.mime) ? 'btn' : 'btn btn-primary', href: `${url}?download=1`, download: file.name },
      icon('download'), copy.fileDownload));
  } else {
    const fetchBlob = async () => {
      status.textContent = copy.fileLoading;
      try {
        const blob = await ctx.files.blob(id);
        status.textContent = '';
        return URL.createObjectURL(blob);
      } catch {
        status.textContent = copy.fileFailed;
        return null;
      }
    };
    if (inlineType(file.mime)) {
      actions.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const blobUrl = await fetchBlob();
        if (blobUrl) window.open(blobUrl, '_blank', 'noopener');
      } }, icon('external'), copy.fileOpen));
    }
    actions.appendChild(h('button', { class: inlineType(file.mime) ? 'btn' : 'btn btn-primary', type: 'button', onclick: async () => {
      const blobUrl = await fetchBlob();
      if (!blobUrl) return;
      const a = h('a', { href: blobUrl, download: file.name });
      document.body.appendChild(a);
      a.click();
      a.remove();
    } }, icon('download'), copy.fileDownload));
  }
  view.appendChild(actions);
  view.appendChild(status);
  parts.push(view);
  return { title: file.name, node: h('div', { class: 'content' }, card(...parts), prevNext(ctx, id)) };
}

// ---------- Modules ----------

function moduleItemRow(ctx, m, it, mode) {
  const indent = it.indent ? ` indent-${Math.min(4, it.indent)}` : '';
  if (it.type === 'header') {
    return h('li', { class: mode === 'outline' ? 'outline-header' : `mi-header${indent}`, text: it.title });
  }
  const data = it.type === 'file' ? ctx.course.files[it.ref] : it.type === 'link' ? null : ctx.course.items[it.ref];
  // Canvas locks every item in a module that has not opened, even items that open elsewhere.
  const moduleLocked = m.unlockAt && !isOpen(m.unlockAt, ctx.now) ? m.unlockAt : null;
  const locked = moduleLocked || lockedUntil(ctx, data);
  const url = it.type === 'link' ? safeUrl(it.url) : null;
  const iconName = locked ? 'clock' : it.type;
  let meta = it.type === 'link' ? `${copy.types.link} · ${copy.newTab.replace(/[()]/g, '')}` : data && data.type ? metaText(data) : copy.types[it.type];
  if (it.type === 'file' && data) meta = `${copy.types.file} · ${copy.fileKind(data.mime)}, ${copy.size(data.size)}`;
  if (locked) meta = copy.opens(formatDate(locked, ctx.now));
  const typeWord = h('span', { class: 'visually-hidden', text: `, ${copy.types[it.type] || ''}` });

  if (mode === 'outline') {
    if (locked || (it.type === 'link' && !url)) {
      return h('li', {}, h('span', { class: 'locked-row' }, icon(locked ? 'clock' : iconName),
        h('span', {}, h('span', { text: it.title }), typeWord,
          locked ? h('span', { class: 'outline-meta', text: copy.opens(formatDate(locked, ctx.now)) }) : null)));
    }
    const href = it.type === 'link' ? url : routeFor(it.type, it.ref);
    return h('li', {}, h('a', { href, 'data-ref': it.ref || null, target: it.type === 'link' ? '_blank' : null, rel: it.type === 'link' ? 'noopener noreferrer' : null },
      icon(iconName), h('span', { text: it.title }), typeWord));
  }
  const body = h('span', { class: 'mi-body' }, h('span', { class: 'mi-title', text: it.title }), h('span', { class: 'mi-meta', text: meta }));
  const iconBox = h('span', { class: 'mi-icon' }, icon(iconName));
  if (locked || (it.type === 'link' && !url)) return h('li', {}, h('div', { class: `mi locked${indent}` }, iconBox, body));
  if (it.type === 'link') {
    return h('li', {}, h('a', { class: `mi${indent}`, href: url, target: '_blank', rel: 'noopener noreferrer' }, iconBox, body));
  }
  return h('li', {}, h('a', { class: `mi${indent}`, href: routeFor(it.type, it.ref) }, iconBox, body));
}

export function outlineList(ctx) {
  return h('ol', { class: 'outline' }, ctx.course.modules.map((m) =>
    h('li', {}, h('details', { 'data-module': m.id },
      h('summary', { text: m.title }),
      h('ol', {}, m.items.map((it) => moduleItemRow(ctx, m, it, 'outline')))))));
}

export function modulesView(ctx, focusId, { isHome = false } = {}) {
  const { course } = ctx;
  const cards = course.modules.map((m) => {
    const locked = m.unlockAt && !isOpen(m.unlockAt, ctx.now);
    return h('section', { class: 'card module-card', id: `module-${m.id}`, 'aria-labelledby': `module-title-${m.id}` },
      h('div', { class: 'module-head' },
        h('h2', { id: `module-title-${m.id}`, tabindex: '-1', text: m.title }),
        locked ? h('span', { class: 'chip chip-warn' }, icon('clock'), copy.opens(formatDate(m.unlockAt, ctx.now))) : null),
      m.items.length
        ? h('ul', { class: 'module-items' }, m.items.map((it) => moduleItemRow(ctx, m, it, 'list')))
        : h('p', { class: 'muted module-empty', text: copy.emptyModule }));
  });
  const node = h('div', {},
    isHome ? notice(copy.datesNote) : null,
    h('h1', { class: 'page-title', tabindex: '-1', text: copy.modulesTitle }),
    cards.length ? h('div', { class: 'modules' }, cards) : notice(copy.noModules));
  return { title: copy.modulesTitle, node, focusId: focusId ? `module-title-${focusId}` : null };
}

// ---------- Home ----------

export function homeView(ctx) {
  const home = ctx.course.home;
  if (home.type === 'page' && ctx.course.items[home.id]) {
    const view = itemView(ctx, home.id);
    view.node.prepend(notice(copy.datesNote));
    view.node.querySelectorAll('.back-link, .breadcrumb').forEach((el) => el.remove());
    return view;
  }
  if (home.type === 'syllabus' && ctx.course.syllabus) {
    const view = syllabusView(ctx);
    view.node.prepend(notice(copy.datesNote));
    return view;
  }
  return modulesView(ctx, null, { isHome: true });
}

// ---------- Lists ----------

function gradedItems(ctx) {
  const rows = Object.entries(ctx.course.items)
    .filter(([, item]) => gradedInfo(item))
    .map(([id, item]) => ({ id, item }));
  const time = (r) => (r.item.dueAt ? parseDate(r.item.dueAt).getTime() : Infinity);
  return rows.sort((a, b) => time(a) - time(b) || a.item.title.localeCompare(b.item.title));
}

export function syllabusView(ctx) {
  const { syllabus } = ctx.course;
  const parts = [pageTitle(copy.syllabusTitle)];
  if (syllabus) parts.push(prose(ctx, syllabus.html));
  if (syllabus && syllabus.summary) {
    const rows = gradedItems(ctx);
    if (rows.length) {
      parts.push(h('h2', { class: 'section-title', text: copy.summaryTitle }),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: copy.summaryDate }), h('th', { scope: 'col', text: copy.summaryDetails }))),
          h('tbody', {}, rows.map(({ id, item }) => h('tr', {},
            h('td', { text: item.dueAt ? formatDate(item.dueAt, ctx.now) : copy.noDue }),
            h('td', {}, h('a', { href: routeFor(item.type, id), text: item.title }))))))));
    }
  }
  return { title: copy.syllabusTitle, node: h('div', { class: 'content' }, card(...parts)) };
}

export function assignmentsView(ctx) {
  const rows = gradedItems(ctx);
  const body = rows.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ...[copy.assignmentsName, copy.assignmentsType, copy.assignmentsDue, copy.assignmentsPoints]
        .map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, rows.map(({ id, item }) => h('tr', {},
        h('td', {}, h('a', { href: routeFor(item.type, id), text: item.title })),
        h('td', { text: copy.types[item.type] }),
        h('td', { text: item.dueAt ? formatDate(item.dueAt, ctx.now) : copy.noDue }),
        h('td', { text: item.points != null ? String(item.points) : '' }))))))
    : h('p', { text: copy.noAssignments });
  return { title: copy.assignmentsTitle, node: h('div', { class: 'content' }, card(pageTitle(copy.assignmentsTitle), body)) };
}

export function pagesView(ctx) {
  const pages = Object.entries(ctx.course.items).filter(([, i]) => i.type === 'page')
    .sort((a, b) => a[1].title.localeCompare(b[1].title));
  const body = pages.length
    ? h('ul', { class: 'results' }, pages.map(([id, page]) => h('li', {}, h('a', { href: `#/item/${id}`, text: page.title }))))
    : h('p', { text: copy.noPages });
  return { title: copy.pagesTitle, node: h('div', { class: 'content' }, card(pageTitle(copy.pagesTitle), body)) };
}

export function filesView(ctx) {
  const groups = new Map();
  for (const [id, f] of Object.entries(ctx.course.files)) {
    if (f.hidden) continue;
    if (!groups.has(f.folder)) groups.set(f.folder, []);
    groups.get(f.folder).push([id, f]);
  }
  const folders = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const body = folders.length
    ? folders.map((folder) => [
      h('h2', { class: 'section-title' }, icon('folder'), ` ${folder || copy.mainFolder}`),
      h('ul', { class: 'results' }, groups.get(folder).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, f]) =>
        h('li', {}, lockedUntil(ctx, f) ? h('span', { class: 'muted', text: f.name }) : h('a', { href: `#/file/${id}`, text: f.name }),
          h('p', { text: lockedUntil(ctx, f) ? copy.opens(formatDate(f.opensAt, ctx.now)) : `${copy.fileKind(f.mime)}, ${copy.size(f.size)}` })))),
    ])
    : h('p', { text: copy.noFiles });
  return { title: copy.filesTitle, node: h('div', { class: 'content' }, card(pageTitle(copy.filesTitle), body)) };
}

export function searchView(ctx, query) {
  if (!ctx.index) ctx.index = buildIndex(ctx.course, ctx.now);
  const q = query.trim();
  const results = q ? search(ctx.index, q) : [];
  const parts = [pageTitle(q ? copy.searchTitle(q) : copy.searchButton)];
  if (!q) parts.push(h('p', { text: copy.searchEmpty }));
  else if (!results.length) parts.push(h('p', { text: copy.searchNone }));
  else {
    parts.push(h('p', { class: 'muted', role: 'status', text: copy.searchCount(results.length) }),
      h('ul', { class: 'results' }, results.map((r) => h('li', {},
        h('a', { href: r.kind === 'file' ? `#/file/${r.id}` : `#/item/${r.id}`, text: r.title }),
        h('span', { class: 'muted', text: ` · ${copy.types[r.type] || ''}` }),
        r.snippet ? h('p', { text: r.snippet }) : null))));
  }
  return { title: q ? copy.searchTitle(q) : copy.searchButton, node: h('div', { class: 'content' }, card(...parts)) };
}

export function notFoundView() {
  return {
    title: copy.notFound,
    node: h('div', { class: 'content' }, card(pageTitle(copy.notFound), h('p', {}, h('a', { href: '#/', text: copy.notFoundHome })))),
  };
}
