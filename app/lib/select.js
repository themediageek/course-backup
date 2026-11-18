// Decides what students will see: the content rules in the design's
// "What goes into a course" section, applied to a RawCourse.
import { makeFileResolver, fileBaseRefs } from './paths.js';
import { parseDate } from './dates.js';

export { parseDate };

const KIND_OF_ITEM = {
  WikiPage: 'page', Assignment: 'assignment', DiscussionTopic: 'discussion',
  'Quizzes::Quiz': 'quiz', Attachment: 'file', ExternalUrl: 'link', ContextExternalTool: 'tool',
};
const CONTENT = [['page', 'pages'], ['assignment', 'assignments'], ['discussion', 'discussions'], ['quiz', 'quizzes']];

export function selectContent(raw, { now, exclude }) {
  const isFuture = (text) => {
    const date = parseDate(text);
    return Boolean(date && date > now);
  };
  const include = {
    modules: new Set(), pages: new Set(), assignments: new Set(), discussions: new Set(),
    quizzes: new Set(), links: new Set(), tools: new Set(), files: new Set(),
  };
  const leftOut = { unpublished: 0, locked: 0, quizFiles: 0, unlinked: 0, chosen: [] };
  const future = [];
  const everyone = [];
  const canon = (ref) => raw.aliases[ref] || ref;

  // Where each piece of content sits in the modules.
  const placements = new Map();
  for (const m of raw.modules) {
    const chosenOut = exclude.has(m.id);
    if (chosenOut) leftOut.chosen.push({ kind: 'module', id: m.id, title: m.title });
    const moduleOk = m.published && !chosenOut;
    if (moduleOk) {
      include.modules.add(m.id);
      if (isFuture(m.unlockAt)) future.push({ kind: 'module', id: m.id, title: m.title, unlockAt: m.unlockAt });
    }
    for (const item of m.items) {
      if (!item.ref) continue;
      const id = canon(item.ref);
      const p = placements.get(id) || { good: false, excluded: false, type: item.type };
      if (moduleOk && item.published) p.good = true;
      if (chosenOut && m.published) p.excluded = true;
      placements.set(id, p);
    }
  }
  const placedOk = (id) => {
    const p = placements.get(id);
    return !p || p.good;
  };
  const droppedByModuleChoice = (id) => {
    const p = placements.get(id);
    return Boolean(p && !p.good && p.excluded);
  };

  // Pages, assignments, discussions, quizzes.
  const futureContent = [];
  for (const [kind, store] of CONTENT) {
    for (const item of Object.values(raw[store])) {
      if (exclude.has(item.id)) {
        leftOut.chosen.push({ kind, id: item.id, title: item.title });
        continue;
      }
      if (!item.published || !placedOk(item.id)) {
        if (!droppedByModuleChoice(item.id)) leftOut.unpublished++;
        continue;
      }
      include[store].add(item.id);
      if (isFuture(item.unlockAt)) futureContent.push({ kind, id: item.id, title: item.title, unlockAt: item.unlockAt });
      if (item.sectionOnly) everyone.push({ kind, id: item.id, title: item.title });
    }
  }

  // Links and tools exist for students only as module items.
  for (const [id, p] of placements) {
    if (!p.good) continue;
    const kind = KIND_OF_ITEM[p.type];
    if (kind === 'link' && raw.links[id]) include.links.add(id);
    if (kind === 'tool' && raw.tools[id]) include.tools.add(id);
  }

  // Files. A hidden file stays only when included content links to it.
  const resolve = makeFileResolver(raw.files);
  const linked = new Set();
  const htmlSources = [raw.syllabusHtml || ''];
  for (const [, store] of CONTENT) for (const id of include[store]) htmlSources.push(raw[store][id].html || '');
  for (const html of htmlSources) {
    for (const ref of fileBaseRefs(html)) {
      const id = resolve(ref);
      if (id) linked.add(id);
    }
  }
  for (const [id, p] of placements) if (p.good && raw.files[id]) linked.add(id);
  const quizRefs = new Set(raw.quizFileRefs);
  const futureFiles = [];
  // Identical copies are packed once, so leaving one out leaves out all of them.
  const sameBytes = (f) => `${f.size}:${f.crc32}`;
  const excludedBytes = new Set([...exclude].filter((id) => raw.files[id]).map((id) => sameBytes(raw.files[id])));
  for (const f of Object.values(raw.files)) {
    if (exclude.has(f.id)) {
      leftOut.chosen.push({ kind: 'file', id: f.id, title: f.name, size: f.size });
      continue;
    }
    if (excludedBytes.has(sameBytes(f))) continue;
    if (f.locked) { leftOut.locked++; continue; }
    if (f.path.startsWith('web_resources/assessment_questions/')) { leftOut.quizFiles++; continue; }
    if (!placedOk(f.id)) {
      if (!droppedByModuleChoice(f.id)) leftOut.unpublished++;
      continue;
    }
    if (quizRefs.has(f.id) && !linked.has(f.id)) { leftOut.quizFiles++; continue; }
    if (f.hidden && !linked.has(f.id)) { leftOut.unlinked++; continue; }
    include.files.add(f.id);
    if (isFuture(f.unlockAt)) futureFiles.push({ kind: 'file', id: f.id, title: f.name, unlockAt: f.unlockAt });
  }

  return { include, future: [...future, ...futureContent, ...futureFiles], leftOut, everyone };
}

export function hasStudentContent(selection) {
  const { include } = selection;
  return ['pages', 'assignments', 'discussions', 'quizzes', 'links', 'tools', 'files']
    .some((store) => include[store].size > 0);
}
