// Reads a Canvas course export into a RawCourse: every module, page, file,
// assignment, discussion, quiz, link, and tool, with its publish state.
// Quiz questions are never read, except to find which files they link to.
import { parseXml, kids, kid, txt, all } from './xml.js';
import { PackError } from './errors.js';
import { makeFileResolver, fileBaseRefs } from './paths.js';

const num = (s) => (s == null || s === '' ? null : Number(s));
const isTrue = (s) => s === 'true';
const published = (state) => state !== 'unpublished' && state !== 'deleted';

function bodyOf(html) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return (m ? m[1] : html).trim();
}

function headOf(html) {
  const doc = new globalThis.DOMParser().parseFromString(html, 'text/html');
  const meta = (name) => {
    for (const el of doc.querySelectorAll('meta')) {
      if (el.getAttribute('name') === name) return el.getAttribute('content');
    }
    return null;
  };
  const titleEl = doc.querySelector('title');
  return { title: titleEl ? titleEl.textContent.trim() : '', meta };
}

function fileName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

async function readXml(zip, name) {
  return zip.has(name) ? parseXml(await zip.text(name)) : null;
}

function readManifest(doc) {
  const resources = {};
  const root = kid(doc.documentElement, 'resources');
  for (const r of kids(root, 'resource')) {
    resources[r.getAttribute('identifier')] = {
      type: r.getAttribute('type') || '',
      href: r.getAttribute('href'),
      files: kids(r, 'file').map((f) => f.getAttribute('href')),
      deps: kids(r, 'dependency').map((d) => d.getAttribute('identifierref')),
    };
  }
  return resources;
}

function readSettings(doc, raw) {
  const c = doc ? doc.documentElement : null;
  raw.title = txt(c, 'title') || 'Untitled course';
  raw.code = txt(c, 'course_code') || '';
  raw.defaultView = txt(c, 'default_view');
  raw.syllabusSummary = txt(c, 'syllabus_course_summary') !== 'false';
  raw.hiddenTabs = [];
  const tabs = txt(c, 'tab_configuration');
  if (tabs) {
    try {
      for (const tab of JSON.parse(tabs)) {
        if (tab.hidden && typeof tab.id === 'number') raw.hiddenTabs.push(tab.id);
      }
    } catch {
      // A damaged tab list means no tabs are hidden.
    }
  }
}

function readModules(doc) {
  if (!doc) return [];
  return kids(doc.documentElement, 'module').map((m) => ({
    id: m.getAttribute('identifier'),
    title: txt(m, 'title') || '',
    published: published(txt(m, 'workflow_state')),
    unlockAt: txt(m, 'unlock_at'),
    items: kids(kid(m, 'items'), 'item').map((i) => ({
      id: i.getAttribute('identifier'),
      type: txt(i, 'content_type') || '',
      title: txt(i, 'title') || '',
      ref: txt(i, 'identifierref'),
      url: txt(i, 'url'),
      indent: num(txt(i, 'indent')) || 0,
      published: published(txt(i, 'workflow_state')),
      newTab: isTrue(txt(i, 'new_tab')),
    })),
  }));
}

function readFiles(zip, resources, filesMeta) {
  const fileMeta = {};
  const folders = [];
  if (filesMeta) {
    const root = filesMeta.documentElement;
    for (const f of all(root, 'file')) fileMeta[f.getAttribute('identifier')] = f;
    for (const f of all(root, 'folder')) {
      folders.push({
        path: f.getAttribute('path').replace(/^\/+|\/+$/g, ''),
        hidden: isTrue(txt(f, 'hidden')),
        locked: isTrue(txt(f, 'locked')),
      });
    }
  }
  const inFolder = (rel, folder) => rel.startsWith(`${folder.path}/`);
  const files = {};
  const listed = new Set();
  const add = (id, path) => {
    const rel = path.replace(/^web_resources\//, '');
    const meta = fileMeta[id];
    const info = zip.info(path);
    files[id] = {
      id,
      path,
      name: (meta && txt(meta, 'display_name')) || fileName(path),
      size: info.size,
      crc32: info.crc32,
      hidden: (meta ? isTrue(txt(meta, 'hidden')) : false) || folders.some((f) => f.hidden && inFolder(rel, f)),
      locked: (meta ? isTrue(txt(meta, 'locked')) : false) || folders.some((f) => f.locked && inFolder(rel, f)),
      unlockAt: meta ? txt(meta, 'unlock_at') : null,
    };
    listed.add(path);
  };
  for (const [id, r] of Object.entries(resources)) {
    if (r.type === 'webcontent' && r.href && r.href.startsWith('web_resources/') && zip.has(r.href)) add(id, r.href);
  }
  // Files the manifest forgot still need to resolve from links.
  let n = 0;
  for (const name of zip.names) {
    if (name.startsWith('web_resources/') && !listed.has(name)) add(`unlisted-${++n}`, name);
  }
  return { files, folders };
}

async function readPages(zip, resources) {
  const pages = {};
  for (const [resId, r] of Object.entries(resources)) {
    if (r.type !== 'webcontent' || !r.href || !r.href.startsWith('wiki_content/') || !zip.has(r.href)) continue;
    const html = await zip.text(r.href);
    const head = headOf(html);
    const id = head.meta('identifier') || resId;
    pages[id] = {
      id,
      slug: fileName(r.href).replace(/\.html?$/i, ''),
      title: head.title,
      html: bodyOf(html),
      published: published(head.meta('workflow_state')),
      frontPage: head.meta('front_page') === 'true',
    };
  }
  return pages;
}

async function readAssignments(zip) {
  const assignments = {};
  for (const name of zip.names) {
    const m = /^([^/]+)\/assignment_settings\.xml$/.exec(name);
    if (!m) continue;
    const a = parseXml(await zip.text(name)).documentElement;
    const id = a.getAttribute('identifier') || m[1];
    const htmlName = zip.names.find((n) => n.startsWith(`${m[1]}/`) && /\.html?$/i.test(n));
    assignments[id] = {
      id,
      title: txt(a, 'title') || '',
      html: htmlName ? bodyOf(await zip.text(htmlName)) : '',
      published: published(txt(a, 'workflow_state')),
      dueAt: txt(a, 'due_at'),
      unlockAt: txt(a, 'unlock_at'),
      lockAt: txt(a, 'lock_at'),
      points: num(txt(a, 'points_possible')),
      gradingType: txt(a, 'grading_type') || 'points',
      submissionTypes: (txt(a, 'submission_types') || '').split(',').map((s) => s.trim()).filter(Boolean),
      groupId: txt(a, 'assignment_group_identifierref'),
      rubricId: txt(a, 'rubric_identifierref'),
      sectionOnly: isTrue(txt(a, 'only_visible_to_overrides')),
    };
  }
  return assignments;
}

async function readDiscussions(zip, resources, aliases) {
  const discussions = {};
  for (const [id, r] of Object.entries(resources)) {
    if (r.type !== 'imsdt_xmlv1p1') continue;
    const topicFile = r.files[0];
    if (!topicFile || !zip.has(topicFile)) continue;
    const topic = parseXml(await zip.text(topicFile)).documentElement;
    let metaDoc = null;
    let metaId = null;
    for (const dep of r.deps) {
      const d = resources[dep];
      const href = d && (d.href || d.files[0]);
      if (href && zip.has(href)) {
        metaDoc = parseXml(await zip.text(href));
        metaId = dep;
        break;
      }
    }
    const meta = metaDoc ? metaDoc.documentElement : null;
    if (meta && txt(meta, 'type') === 'announcement') continue;
    const assignment = kid(meta, 'assignment');
    if (metaId) aliases[metaId] = id;
    if (assignment && assignment.getAttribute('identifier')) aliases[assignment.getAttribute('identifier')] = id;
    const state = meta ? txt(meta, 'workflow_state') : 'active';
    discussions[id] = {
      id,
      title: (meta && txt(meta, 'title')) || txt(topic, 'title') || '',
      html: (kid(topic, 'text') ? kid(topic, 'text').textContent : '').trim(),
      published: published(state),
      graded: Boolean(assignment),
      dueAt: assignment ? txt(assignment, 'due_at') : null,
      unlockAt: (meta && txt(meta, 'delayed_post_at')) || (assignment ? txt(assignment, 'unlock_at') : null),
      points: assignment ? num(txt(assignment, 'points_possible')) : null,
      groupId: assignment ? txt(assignment, 'assignment_group_identifierref') : null,
      rubricId: assignment ? txt(assignment, 'rubric_identifierref') : null,
      sectionOnly: isTrue(txt(meta, 'only_visible_to_overrides')) ||
        (assignment ? isTrue(txt(assignment, 'only_visible_to_overrides')) : false),
    };
  }
  return discussions;
}

async function readQuizzes(zip, aliases) {
  const quizzes = {};
  for (const name of zip.names) {
    const m = /^([^/]+)\/assessment_meta\.xml$/.exec(name);
    if (!m) continue;
    const q = parseXml(await zip.text(name)).documentElement;
    const id = q.getAttribute('identifier') || m[1];
    const assignment = kid(q, 'assignment');
    if (assignment && assignment.getAttribute('identifier')) aliases[assignment.getAttribute('identifier')] = id;
    const available = txt(q, 'available');
    quizzes[id] = {
      id,
      title: txt(q, 'title') || '',
      html: (kid(q, 'description') ? kid(q, 'description').textContent : '').trim(),
      published: available != null ? available === 'true' : published(txt(q, 'workflow_state')),
      dueAt: txt(q, 'due_at'),
      unlockAt: txt(q, 'unlock_at'),
      points: num(txt(q, 'points_possible')),
      quizType: txt(q, 'quiz_type') || 'assignment',
      timeLimit: num(txt(q, 'time_limit')),
      allowedAttempts: num(txt(q, 'allowed_attempts')),
      groupId: assignment ? txt(assignment, 'assignment_group_identifierref') : null,
      sectionOnly: isTrue(txt(q, 'only_visible_to_overrides')),
    };
  }
  return quizzes;
}

async function readLinksAndTools(zip, resources) {
  const links = {};
  const tools = {};
  for (const [id, r] of Object.entries(resources)) {
    const href = r.files[0];
    if (!href || !zip.has(href)) continue;
    if (r.type.startsWith('imswl_')) {
      const w = parseXml(await zip.text(href)).documentElement;
      const url = kid(w, 'url');
      links[id] = { id, title: txt(w, 'title') || '', url: url ? url.getAttribute('href') : '' };
    } else if (r.type.startsWith('imsbasiclti_')) {
      const t = parseXml(await zip.text(href)).documentElement;
      tools[id] = { id, title: txt(t, 'title') || '', url: txt(t, 'secure_launch_url') || txt(t, 'launch_url') };
    }
  }
  return { links, tools };
}

function readRubrics(doc) {
  const rubrics = {};
  if (!doc) return rubrics;
  for (const r of kids(doc.documentElement, 'rubric')) {
    const id = r.getAttribute('identifier');
    rubrics[id] = {
      id,
      title: txt(r, 'title') || '',
      points: num(txt(r, 'points_possible')),
      criteria: kids(kid(r, 'criteria'), 'criterion').map((c) => ({
        description: txt(c, 'description') || '',
        longDescription: txt(c, 'long_description') || '',
        points: num(txt(c, 'points')),
        ratings: kids(kid(c, 'ratings'), 'rating').map((x) => ({
          description: txt(x, 'description') || '',
          longDescription: txt(x, 'long_description') || '',
          points: num(txt(x, 'points')),
        })),
      })),
    };
  }
  return rubrics;
}

function readGroups(doc) {
  const groups = {};
  if (!doc) return groups;
  for (const g of kids(doc.documentElement, 'assignmentGroup')) {
    const id = g.getAttribute('identifier');
    groups[id] = { id, title: txt(g, 'title') || '', weight: num(txt(g, 'group_weight')) || 0 };
  }
  return groups;
}

async function readQuizFileRefs(zip, files) {
  const resolve = makeFileResolver(files);
  const ids = new Set();
  for (const name of zip.names) {
    if (!name.endsWith('.qti') && !name.endsWith('assessment_qti.xml')) continue;
    for (const ref of fileBaseRefs(await zip.text(name))) {
      const id = resolve(ref);
      if (id) ids.add(id);
    }
  }
  return [...ids].sort();
}

export async function readExport(zip) {
  if (!zip.has('course_settings/canvas_export.txt')) {
    throw new PackError('not-canvas', 'This file is not a Canvas course export.');
  }
  const manifest = await readXml(zip, 'imsmanifest.xml');
  const resources = manifest ? readManifest(manifest) : {};
  const raw = { aliases: {} };
  readSettings(await readXml(zip, 'course_settings/course_settings.xml'), raw);
  raw.syllabusHtml = zip.has('course_settings/syllabus.html')
    ? bodyOf(await zip.text('course_settings/syllabus.html')) || null
    : null;
  raw.modules = readModules(await readXml(zip, 'course_settings/module_meta.xml'));
  const { files, folders } = readFiles(zip, resources, await readXml(zip, 'course_settings/files_meta.xml'));
  raw.files = files;
  raw.folders = folders;
  raw.pages = await readPages(zip, resources);
  raw.frontPageId = Object.values(raw.pages).find((p) => p.frontPage)?.id || null;
  raw.assignments = await readAssignments(zip);
  raw.discussions = await readDiscussions(zip, resources, raw.aliases);
  raw.quizzes = await readQuizzes(zip, raw.aliases);
  Object.assign(raw, await readLinksAndTools(zip, resources));
  raw.rubrics = readRubrics(await readXml(zip, 'course_settings/rubrics.xml'));
  raw.groups = readGroups(await readXml(zip, 'course_settings/assignment_groups.xml'));
  raw.quizFileRefs = await readQuizFileRefs(zip, raw.files);
  return raw;
}
