// Turns a RawCourse and a Selection into CourseData (what the viewer reads),
// the list of files to pack, and the report the packing page shows.
import { rewriteHtml, safeUrl } from './links.js';
import { parseDate } from './dates.js';
import { makeFileResolver } from './paths.js';
import { mimeFor } from './mime.js';
import { hasStudentContent } from './select.js';

const PIECE = 1048576;
const TABS = { syllabus: 1, pages: 2, assignments: 3, files: 11 };
const ITEM_TYPES = {
  ContextModuleSubHeader: 'header', WikiPage: 'page', Attachment: 'file', Assignment: 'assignment',
  DiscussionTopic: 'discussion', 'Quizzes::Quiz': 'quiz', ExternalUrl: 'link', ContextExternalTool: 'tool',
};
const STORE_OF = { page: 'pages', assignment: 'assignments', discussion: 'discussions', quiz: 'quizzes', file: 'files' };

function hasContent(html) {
  if (!html) return false;
  if (/<(img|iframe|video|audio|object|embed|table)\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '').length > 0;
}

function cleanRubric(rubric) {
  if (!rubric) return null;
  return {
    title: rubric.title,
    points: rubric.points,
    criteria: rubric.criteria.map((c) => ({
      description: c.description, longDescription: c.longDescription, points: c.points,
      ratings: c.ratings.map((r) => ({ description: r.description, longDescription: r.longDescription, points: r.points })),
    })),
  };
}

export function buildCourse(raw, selection, { packId, instructor, now }) {
  const { include } = selection;
  const canon = (id) => raw.aliases[id] || id;

  // One packed copy per identical file.
  const packFiles = [];
  const firstByContent = new Map();
  const files = {};
  for (const id of include.files) {
    const f = raw.files[id];
    const key = `${f.size}:${f.crc32}`;
    if (!firstByContent.has(key)) {
      firstByContent.set(key, id);
      packFiles.push({ fileId: id, path: f.path, size: f.size, crc32: f.crc32 });
    }
    const rel = f.path.replace(/^web_resources\//, '');
    const entry = {
      name: f.name,
      folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
      mime: mimeFor(f.name),
      size: f.size,
      hidden: f.hidden,
      unlockAt: f.unlockAt,
      pieces: [],
    };
    if (firstByContent.get(key) !== id) entry.same = firstByContent.get(key);
    files[id] = entry;
  }

  // Link resolvers for rewriting HTML.
  const fileIds = makeFileResolver(raw.files);
  const pageBySlug = new Map();
  for (const id of include.pages) pageBySlug.set(raw.pages[id].slug, id);
  const resolve = {
    file: (path) => {
      const id = fileIds(path);
      return id && include.files.has(id) ? id : null;
    },
    page: (slug) => pageBySlug.get(slug) || pageBySlug.get(slug.toLowerCase()) || null,
    object: (kind, ref) => {
      const id = canon(ref);
      if (kind === 'modules') return include.modules.has(id) ? id : null;
      for (const store of kind === 'assignments' ? ['assignments', 'discussions', 'quizzes'] : [kind]) {
        if (include[store] && include[store].has(id)) return id;
      }
      return null;
    },
  };
  const canvasLinks = [];
  const rewrite = (html, title) => {
    const out = rewriteHtml(html, resolve);
    for (const url of out.canvasLinks) {
      if (!canvasLinks.some((c) => c.url === url && c.itemTitle === title)) canvasLinks.push({ itemTitle: title, url });
    }
    return out.html;
  };

  // Items.
  const items = {};
  const groupTitle = (id) => (id && raw.groups[id] ? raw.groups[id].title : '');
  for (const id of include.pages) {
    const p = raw.pages[id];
    items[id] = { type: 'page', title: p.title, html: rewrite(p.html, p.title), unlockAt: null };
  }
  for (const id of include.assignments) {
    const a = raw.assignments[id];
    items[id] = {
      type: 'assignment', title: a.title, html: rewrite(a.html, a.title), dueAt: a.dueAt, unlockAt: a.unlockAt,
      points: a.points, submissionTypes: a.submissionTypes, groupTitle: groupTitle(a.groupId),
      rubric: cleanRubric(raw.rubrics[a.rubricId]),
    };
  }
  for (const id of include.discussions) {
    const d = raw.discussions[id];
    items[id] = {
      type: 'discussion', title: d.title, html: rewrite(d.html, d.title), graded: d.graded, dueAt: d.dueAt,
      unlockAt: d.unlockAt, points: d.points, rubric: cleanRubric(raw.rubrics[d.rubricId]),
    };
  }
  for (const id of include.quizzes) {
    const q = raw.quizzes[id];
    items[id] = {
      type: 'quiz', title: q.title, html: rewrite(q.html, q.title), dueAt: q.dueAt, unlockAt: q.unlockAt,
      points: q.points, timeLimit: q.timeLimit, allowedAttempts: q.allowedAttempts,
    };
  }

  // Modules, keeping only items students may open.
  const toolTitles = new Set(Object.values(raw.tools).map((t) => t.title).filter(Boolean));
  const modules = [];
  let linkCount = 0;
  let toolCount = 0;
  for (const m of raw.modules) {
    if (!include.modules.has(m.id)) continue;
    const out = [];
    for (const it of m.items) {
      const type = ITEM_TYPES[it.type];
      if (!type || !it.published) continue;
      const base = { id: it.id, type, title: it.title, indent: it.indent };
      if (type === 'header') {
        out.push(base);
      } else if (type === 'link') {
        const url = safeUrl(it.url || (raw.links[it.ref] && raw.links[it.ref].url));
        if (!url) continue;
        out.push({ ...base, url });
        linkCount++;
      } else if (type === 'tool') {
        const tool = raw.tools[it.ref];
        const url = safeUrl(it.url || (tool ? tool.url : null));
        items[it.id] = { type: 'tool', title: it.title, url, opensAt: m.unlockAt || null };
        out.push({ ...base, ref: it.id });
        toolCount++;
        toolTitles.add(it.title);
      } else {
        const ref = canon(it.ref);
        const store = STORE_OF[type];
        if (!ref || !include[store].has(ref)) continue;
        const own = type === 'file' ? files[ref].unlockAt : items[ref].unlockAt;
        out.push({ ...base, ref, unlockAt: own || null });
      }
    }
    modules.push({ id: m.id, title: m.title, unlockAt: m.unlockAt, items: out });
  }

  // When each item and file opens: the later of its own unlock date and its
  // modules' date. Content in at least one module without a date, or in no
  // module, opens with its own date only.
  const later = (a, b) => (!a ? b : !b ? a : (parseDate(a) >= parseDate(b) ? a : b));
  const earlier = (a, b) => (!a ? b : !b ? a : (parseDate(a) <= parseDate(b) ? a : b));
  const placementOpens = new Map();
  for (const m of raw.modules) {
    if (!include.modules.has(m.id)) continue;
    for (const it of m.items) {
      if (!it.ref || !it.published) continue;
      const ref = canon(it.ref);
      const seen = placementOpens.get(ref);
      if (seen === null) continue;
      placementOpens.set(ref, m.unlockAt ? earlier(seen, m.unlockAt) : null);
    }
  }
  const opensAt = (ref, own) => later(own || null, placementOpens.has(ref) ? placementOpens.get(ref) : null) || null;
  for (const [id, item] of Object.entries(items)) {
    if (item.type !== 'tool') item.opensAt = opensAt(id, item.unlockAt);
  }
  for (const [id, entry] of Object.entries(files)) entry.opensAt = opensAt(id, entry.unlockAt);

  // Syllabus, home, navigation.
  const syllabus = hasContent(raw.syllabusHtml)
    ? { html: rewrite(raw.syllabusHtml, 'Syllabus'), summary: raw.syllabusSummary }
    : null;
  let home = { type: 'modules' };
  if (raw.defaultView === 'wiki' && raw.frontPageId && include.pages.has(raw.frontPageId)) {
    home = { type: 'page', id: raw.frontPageId };
  } else if (raw.defaultView === 'syllabus' && syllabus) {
    home = { type: 'syllabus' };
  }
  const shown = (tab) => !raw.hiddenTabs.includes(TABS[tab]);
  const nav = {
    syllabus: shown('syllabus') && Boolean(syllabus),
    assignments: shown('assignments'),
    pages: shown('pages'),
    files: shown('files'),
  };

  const course = {
    format: 1, packId, title: raw.title, code: raw.code, instructor, packedAt: now.toISOString(),
    home, nav, syllabus, modules, items, files, bundles: [],
  };

  // Report.
  const packBytes = packFiles.reduce((sum, f) => sum + f.size + 28 * Math.max(1, Math.ceil(f.size / PIECE)), 0);
  const estimatedBytes = packBytes + 65536;
  const warnings = [];
  if (!hasStudentContent(selection)) warnings.push('empty');
  if (estimatedBytes > 1_000_000_000) warnings.push('over-1gb');
  else if (estimatedBytes > 500_000_000) warnings.push('over-500mb');
  const report = {
    counts: {
      modules: modules.length, pages: include.pages.size, files: include.files.size,
      assignments: include.assignments.size, discussions: include.discussions.size,
      quizzes: include.quizzes.size, links: linkCount, tools: toolCount,
    },
    leftOut: selection.leftOut,
    quizzesStripped: include.quizzes.size,
    tools: [...toolTitles],
    everyone: selection.everyone,
    canvasLinks,
    future: selection.future,
    estimatedBytes,
    largest: packFiles.slice().sort((a, b) => b.size - a.size).slice(0, 15)
      .map((f) => ({ id: f.fileId, name: raw.files[f.fileId].name, size: f.size })),
    warnings,
  };
  return { course, packFiles, report };
}
