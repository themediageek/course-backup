// The publish page: load a Canvas export, preview it, and make it live on the
// faculty member's GitHub site. Also lists live courses with Replace and Take down.
import DOMPurify from '../vendor/purify.es.mjs';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { selectContent } from '../app/lib/select.js';
import { buildCourse } from '../app/lib/build-course.js';
import { packCourse } from '../app/lib/pack-course.js';
import { collectWriter, directoryWriter, zipWriter } from '../app/lib/writers.js';
import { trackerRows, buildTracker, trackerFileName } from '../app/lib/tracker.js';
import { newPackId } from '../app/lib/crypto.js';
import { formatDate } from '../app/lib/dates.js';
import { PackError } from '../app/lib/errors.js';
import { mountViewer, themeButton, applyStoredTheme } from '../app/viewer/render.js';
import { createMemorySource } from '../app/viewer/memory-source.js';
import { h } from '../app/viewer/dom.js';
import { icon } from '../app/viewer/icons.js';
import { copy } from './copy.js';
import { suggestFolder, checkFolder, suggestPassword } from './naming.js';
import { WORDS } from './words.js';
import { githubRepoFromLocation, pagesSettingsUrl, siteRoot } from './github.js';
import { createClient, tokenUrl, templateUrl, whoAmI, DEFAULT_REPO } from './github-api.js';
import { createTokenStore } from './token-store.js';
import { loadSiteFiles } from './site-files.js';

applyStoredTheme();
document.getElementById('theme-slot').replaceWith(themeButton());

const stepEl = document.getElementById('step');
const stepperEl = document.getElementById('stepper');
const panelEl = document.getElementById('github-panel');
const MB = 1e6;

// The repository this page is served from. Its owner publishes into it; anyone
// else publishes into their own repository, made from it as a template. On a
// local test server, ?repo=owner/name and ?api=/path stand in for the real
// site and GitHub; nowhere else are they read.
const params = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const localRepo = isLocal && /^[\w.-]+\/[\w.-]+$/.test(params.get('repo') || '') ? params.get('repo').split('/') : null;
const pageRepo = githubRepoFromLocation(location.href) || (localRepo ? { owner: localRepo[0], repo: localRepo[1] } : null);
const apiBase = isLocal && (params.get('api') || '').startsWith('/') ? new URL(params.get('api'), location.href).href.replace(/\/$/, '') : undefined;
const canWriteFolders = typeof window.showDirectoryPicker === 'function' && !params.has('zip');

function storage(name) {
  try { return window[name]; } catch { return { getItem: () => null, setItem() {}, removeItem() {} }; }
}
const tokens = createTokenStore({ session: storage('sessionStorage'), local: storage('localStorage') });

// target: the connected repository { owner, repo }. pages: { url, ready } from
// GitHub, or null while GitHub Pages is off.
const gh = { client: null, target: null, pages: null, branch: 'main', courses: [], loading: false, message: '', error: '' };
const state = {
  step: 1, zip: null, raw: null, exclude: new Set(), folder: '', replaceFolder: null, replaceTitle: '',
  passwordMode: 'suggested', suggested: suggestPassword(WORDS), own: '', name: '', email: '',
};

// ---------- Helpers ----------

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyText(text, button, doneLabel) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h('textarea', { class: 'visually-hidden' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const before = button.textContent;
  button.textContent = doneLabel;
  setTimeout(() => { button.textContent = before; }, 2000);
}

function notice(text, kind = 'info', iconName) {
  return h('div', { class: `notice${kind === 'warn' ? ' notice-warn' : ''}` },
    icon(iconName || (kind === 'warn' ? 'warn' : 'info')), h('p', { text }));
}

function password() {
  if (state.passwordMode === 'none') return null;
  return state.passwordMode === 'own' ? state.own : state.suggested;
}

function selectionFor(exclude) {
  const now = new Date();
  const selection = selectContent(state.raw, { now, exclude });
  return buildCourse(state.raw, selection, {
    packId: newPackId(), instructor: { name: state.name.trim(), email: state.email.trim() }, now,
  });
}

const targetName = (target) => (target ? `${target.owner}/${target.repo}` : '');
const pagesReady = () => Boolean(gh.pages && gh.pages.ready);

function ghMessage(error) {
  const make = copy.github.errors[error.code] || copy.github.errors.failed;
  return make(error.repoName || targetName(gh.target));
}

// The course's address on the connected site. Before the site is known, only
// the end of the address shows.
function courseLink(folder) {
  return `${gh.pages ? gh.pages.url : '…/'}${folder}/`;
}

// The Preview step shows the course link under the link name; once the site
// is known, show the full address there.
function refreshLinkPreview() {
  const field = document.getElementById('folder');
  if (field) field.dispatchEvent(new Event('input'));
}

function confirmDialog(text, yes, no) {
  const dialog = document.getElementById('confirm');
  return new Promise((resolve) => {
    const done = (answer) => { dialog.close(); resolve(answer); };
    dialog.replaceChildren(
      h('p', { id: 'confirm-text', text }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', text: yes, onclick: () => done(true) }),
        h('button', { type: 'button', class: 'btn', text: no, onclick: () => done(false) })));
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
    dialog.showModal();
  });
}

let firstShow = true;
function renderStepper() {
  stepperEl.replaceChildren(...copy.steps.map((label, i) => {
    const n = i + 1;
    const status = n < state.step ? 'done' : n === state.step ? 'current' : 'todo';
    return h('li', { class: `step-${status}`, 'aria-current': status === 'current' ? 'step' : null },
      h('span', { class: 'step-num', 'aria-hidden': 'true' }, status === 'done' ? icon('check') : String(n)),
      h('span', { class: 'step-label' }, h('span', { class: 'visually-hidden', text: `${copy.stepOf(n, 3)}: ` }), label));
  }));
}

function show(step, nodes) {
  state.step = step;
  renderStepper();
  if (!gh.client || !pagesReady()) renderPanel();
  stepEl.replaceChildren(...nodes.filter(Boolean));
  const heading = stepEl.querySelector('h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    if (!firstShow) heading.focus();
  }
  firstShow = false;
}

// ---------- GitHub connection and live courses ----------

// Connects to the key owner's repository: the name they typed, else this
// page's own repository when they own it, else the template's default name.
async function connect(token, remember, typedRepo = '') {
  const login = await whoAmI({ token, apiBase });
  const ownsPage = pageRepo && pageRepo.owner === login.toLowerCase();
  const target = { owner: login, repo: typedRepo || (ownsPage ? pageRepo.repo : DEFAULT_REPO) };
  let client;
  let branch;
  let pages;
  try {
    client = createClient({ token, owner: target.owner, repo: target.repo, apiBase });
    ({ branch } = await client.check());
    pages = await client.pagesSite(branch);
  } catch (error) {
    error.repoName = targetName(target);
    throw error;
  }
  tokens.save(token, remember, target.repo);
  Object.assign(gh, { client, target, branch, pages, error: '' });
  refreshCourses();
}

async function refreshCourses() {
  if (!gh.client) return;
  gh.loading = true;
  renderPanel();
  try {
    gh.courses = await gh.client.listCourses(gh.branch);
    gh.error = '';
  } catch (error) {
    gh.error = ghMessage(error);
    if (error.code === 'bad-token') disconnect();
  }
  gh.loading = false;
  renderPanel();
}

function disconnect() {
  tokens.clear();
  Object.assign(gh, { client: null, target: null, pages: null, courses: [] });
  renderPanel();
  if (state.step === 3) renderStep3();
}

async function takeDown(course) {
  const t = copy.github;
  if (!(await confirmDialog(t.takeDownAsk(course.title), t.takeDown, t.cancel))) return;
  gh.message = t.takingDown(course.title);
  renderPanel();
  try {
    await gh.client.remove({ folder: course.folder, branch: gh.branch, message: `Take down ${course.title}` });
    gh.message = t.takenDown(course.title);
  } catch (error) {
    gh.message = '';
    gh.error = ghMessage(error);
  }
  await refreshCourses();
}

function startReplace(course) {
  state.replaceFolder = course.folder;
  state.replaceTitle = course.title;
  renderStep1();
  stepEl.querySelector('h2').focus();
}

function renderPanel() {
  const t = copy.github;
  if (!gh.client) {
    const open = h('button', { type: 'button', class: 'btn btn-small', text: t.connectNow });
    open.addEventListener('click', () => {
      panelEl.replaceChildren(connectCard(() => {
        renderPanel();
        if (state.step === 3) renderStep3();
        refreshLinkPreview();
      }));
      panelEl.querySelector('h3').setAttribute('tabindex', '-1');
      panelEl.querySelector('h3').focus();
    });
    // Step 3 shows its own connection form, so the button here would duplicate it.
    const stepHasForm = state.step === 3;
    panelEl.replaceChildren(...[
      h('div', { class: 'not-connected' }, h('p', { class: 'muted connection', text: t.notConnected }), stepHasForm ? null : open),
      gh.error ? h('p', { role: 'alert', class: 'error', text: gh.error }) : null].filter(Boolean));
    return;
  }
  // Step 3 shows the Pages steps in place of its button, so the panel only mentions them.
  const pagesPart = pagesReady() ? null
    : state.step === 3 ? h('p', { class: 'muted', text: t.pagesBelow }) : pagesCard();
  const list = gh.courses.length
    ? h('ul', { class: 'live-list' }, gh.courses.map((course) => {
      const link = courseLink(course.folder);
      const ready = pagesReady();
      const copyBtn = ready ? h('button', { type: 'button', class: 'btn btn-small' }, icon('copy'), t.copyLink) : null;
      if (copyBtn) copyBtn.addEventListener('click', () => copyText(link, copyBtn, t.copied));
      return h('li', {},
        h('div', { class: 'live-info' },
          h('strong', { text: course.title }),
          ready ? h('a', { href: link, target: '_blank', rel: 'noopener', text: link }) : h('span', { class: 'muted', text: t.linkWaits })),
        h('div', { class: 'live-actions' }, ...[copyBtn,
          h('button', { type: 'button', class: 'btn btn-small', text: t.replace, onclick: () => startReplace(course) }),
          h('button', { type: 'button', class: 'btn btn-small btn-danger', text: t.takeDown, onclick: () => takeDown(course) })].filter(Boolean)));
    }))
    : h('p', { class: 'muted', text: gh.loading ? t.loading : t.liveNone });
  panelEl.replaceChildren(h('section', { class: 'card live-card', 'aria-labelledby': 'live-title' },
    h('div', { class: 'live-head' },
      h('p', { class: 'connection' }, icon('check'), ` ${t.connectedTo(targetName(gh.target))}`),
      h('button', { type: 'button', class: 'btn-link', text: t.disconnect, onclick: disconnect })),
    h('h2', { id: 'live-title', text: t.liveTitle }),
    list,
    pagesPart,
    gh.message ? h('p', { role: 'status', class: 'muted', text: gh.message }) : null,
    gh.error ? h('p', { role: 'alert', class: 'error', text: gh.error }) : null));
}

// ---------- Step 1: Load the export ----------

async function readFile(file, status, error) {
  error.hidden = true;
  status.textContent = copy.choose.reading;
  try {
    const zip = await openZip(window.zip, file);
    const raw = await readExport(zip);
    Object.assign(state, { zip, raw, exclude: new Set(), folder: state.replaceFolder || suggestFolder(raw.code, raw.title) });
    status.textContent = '';
    renderStep2();
  } catch (e) {
    status.textContent = '';
    error.textContent = e instanceof PackError
      ? (e.code === 'not-canvas' ? copy.choose.notCanvas : copy.choose.notZip)
      : copy.choose.other(e.message);
    error.hidden = false;
  }
}

function renderStep1() {
  const t = copy.choose;
  const input = h('input', { type: 'file', accept: '.imscc,.zip', id: 'export-file', class: 'visually-hidden' });
  const status = h('p', { class: 'muted', role: 'status' });
  const error = h('p', { class: 'notice notice-warn', role: 'alert', hidden: true });
  const zone = h('div', { class: 'dropzone' },
    icon('upload'),
    h('p', { class: 'dropzone-title', text: t.drop }),
    h('p', { class: 'muted', text: t.or }),
    input,
    h('label', { class: 'btn btn-primary', for: 'export-file', text: t.button }));
  input.addEventListener('change', () => { if (input.files[0]) readFile(input.files[0], status, error); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) readFile(file, status, error);
  });
  show(1, [h('div', { class: 'card' },
    h('h2', { text: t.title }),
    state.replaceFolder ? notice(copy.github.replacing(state.replaceTitle)) : null,
    h('p', { text: t.text }),
    zone, status, error,
    h('p', { class: 'muted small', text: t.how }))]);
}

// ---------- Step 2: Preview ----------

function countsList(report) {
  const t = copy.check.counts;
  const rows = Object.entries(report.counts).filter(([, n]) => n > 0).map(([key, n]) => h('li', {}, icon('check'), t[key](n)));
  return h('ul', { class: 'tally' }, rows.length ? rows : h('li', { class: 'muted', text: copy.check.nothing }));
}

function leftOutList(report) {
  const o = copy.check.out;
  const lo = report.leftOut;
  const rows = [
    report.quizzesStripped ? o.quizzes(report.quizzesStripped) : null,
    lo.unpublished ? o.unpublished(lo.unpublished) : null,
    lo.locked ? o.locked(lo.locked) : null,
    lo.unlinked ? o.unlinked(lo.unlinked) : null,
    lo.quizFiles ? o.quizFiles(lo.quizFiles) : null,
    lo.chosen.length ? o.chosen(lo.chosen.length) : null,
  ].filter(Boolean);
  return h('ul', { class: 'tally tally-out' }, rows.map((text) => h('li', {}, icon('close'), text)));
}

let summaryEl = null;
let continueBtn = null;
let previewBtn = null;

function checkboxList(items, label) {
  return h('ul', { class: 'check-list' }, items.map((item) => {
    const id = `keep-${item.id}`;
    const box = h('input', { type: 'checkbox', id, checked: !state.exclude.has(item.id) });
    box.addEventListener('change', () => {
      if (box.checked) state.exclude.delete(item.id); else state.exclude.add(item.id);
      refreshSummary();
    });
    return h('li', {}, box, h('label', { for: id, text: label(item) }));
  }));
}

function refreshSummary() {
  const { report } = selectionFor(state.exclude);
  const big = report.estimatedBytes > 1_000_000_000;
  const empty = report.warnings.includes('empty');
  summaryEl.replaceChildren(...[
    h('div', { class: 'two-col' },
      h('div', {}, h('h3', { text: copy.check.included }), countsList(report)),
      h('div', {}, h('h3', { text: copy.check.leftOut }), leftOutList(report))),
    h('p', { class: 'muted', text: copy.check.size(Math.max(1, Math.round(report.estimatedBytes / MB))) }),
    big ? notice(copy.check.tooBig, 'warn') : null].filter(Boolean));
  continueBtn.disabled = big || empty;
  previewBtn.disabled = empty;
}

function folderField() {
  const t = copy.check;
  const input = h('input', { type: 'text', id: 'folder', value: state.folder, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'folder-hint folder-link folder-error folder-live' });
  const link = h('p', { id: 'folder-link', class: 'hint' });
  const error = h('p', { id: 'folder-error', class: 'error', hidden: true });
  const live = h('p', { id: 'folder-live', class: 'hint' });
  const update = () => {
    state.folder = input.value.trim();
    const problem = checkFolder(state.folder);
    link.replaceChildren(t.linkPreview, ' ', h('code', { text: courseLink(state.folder || '…') }));
    error.hidden = !problem;
    error.textContent = problem ? t.folderErrors[problem] : '';
    if (problem) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    const existing = gh.courses.find((c) => c.folder === state.folder);
    live.textContent = existing ? t.replacesLive(existing.title) : '';
  };
  input.addEventListener('input', update);
  update();
  return h('div', { class: 'field' },
    h('label', { for: 'folder', text: t.folder }),
    h('p', { id: 'folder-hint', class: 'hint', text: t.folderHint }),
    input, link, error, live);
}

function passwordField() {
  const t = copy.check;
  const suggestedText = h('code', { class: 'suggested-password', text: state.suggested });
  const own = h('input', { type: 'text', id: 'own-password', value: state.own, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'own-warning' });
  const ownWarning = h('p', { id: 'own-warning', class: 'hint' });
  const noneWarning = notice(t.passwordNoneWarn, 'warn');
  const option = (value, label, extra) => {
    const id = `pw-${value}`;
    const radio = h('input', { type: 'radio', name: 'pw-mode', id, value, checked: state.passwordMode === value });
    radio.addEventListener('change', () => { state.passwordMode = value; sync(); });
    return h('div', { class: 'option' }, radio, h('div', { class: 'option-body' }, h('label', { for: id }, label), extra));
  };
  const again = h('button', { type: 'button', class: 'btn btn-small', text: t.passwordNew, onclick: () => {
    state.suggested = suggestPassword(WORDS);
    suggestedText.textContent = state.suggested;
  } });
  const sync = () => {
    own.disabled = state.passwordMode !== 'own';
    noneWarning.hidden = state.passwordMode !== 'none';
    ownWarning.textContent = state.passwordMode === 'own' && own.value && own.value.trim().length < 12 ? t.passwordShort : '';
  };
  own.addEventListener('input', () => { state.own = own.value; sync(); });
  const fieldset = h('fieldset', { class: 'field' },
    h('legend', { text: t.password }),
    option('suggested', t.passwordSuggested, h('div', { class: 'option-row' }, suggestedText, again)),
    option('own', t.passwordOwn, h('div', {}, h('label', { class: 'visually-hidden', for: 'own-password', text: t.passwordOwnLabel }), own, ownWarning)),
    option('none', t.passwordNone, noneWarning));
  sync();
  return fieldset;
}

function personFields() {
  const t = copy.check;
  const name = h('input', { type: 'text', id: 'person-name', value: state.name, autocomplete: 'name' });
  const email = h('input', { type: 'email', id: 'person-email', value: state.email, autocomplete: 'email' });
  name.addEventListener('input', () => { state.name = name.value; });
  email.addEventListener('input', () => { state.email = email.value; });
  return h('fieldset', { class: 'field' },
    h('legend', { text: t.you }),
    h('p', { class: 'hint', text: t.youHint }),
    h('div', { class: 'two-col' },
      h('div', {}, h('label', { for: 'person-name', class: 'label', text: t.name }), name),
      h('div', {}, h('label', { for: 'person-email', class: 'label', text: t.email }), email)));
}

function openPreview() {
  const built = selectionFor(state.exclude);
  const dialog = document.getElementById('preview');
  const container = h('div', { id: 'preview-app' });
  let viewer = null;
  const close = () => {
    if (viewer) viewer.destroy();
    history.replaceState(null, '', location.pathname + location.search);
    document.title = `${copy.pageTitle} | ${copy.brand}`;
    dialog.close();
    previewBtn.focus();
  };
  dialog.replaceChildren(
    h('div', { class: 'preview-bar' },
      h('p', { id: 'preview-title', text: copy.check.previewTitle }),
      h('button', { type: 'button', class: 'btn btn-small', onclick: close }, icon('close'), copy.check.closePreview)),
    container);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); }, { once: true });
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  dialog.showModal();
  viewer = mountViewer(container, { course: built.course, files: createMemorySource(state.zip, built), now: new Date(), DOMPurify });
  dialog.querySelector('.preview-bar button').focus();
}

async function saveTracker() {
  const rows = trackerRows(state.raw);
  const wb = buildTracker(window.ExcelJS, { courseTitle: state.raw.title, rows, instructions: copy.trackerSheet });
  const buffer = await wb.xlsx.writeBuffer();
  const name = trackerFileName(state.raw.code, state.raw.title);
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  return name;
}

function renderStep2() {
  const t = copy.check;
  const { report } = selectionFor(new Set());
  const kindLabel = (kind) => t.kinds[kind] || kind;
  const empty = report.warnings.includes('empty');
  const formError = h('p', { class: 'notice notice-warn', role: 'alert', hidden: true });

  summaryEl = h('div', { class: 'summary', 'aria-live': 'polite' });
  continueBtn = h('button', { type: 'button', class: 'btn btn-primary', text: copy.next });
  previewBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large' }, icon('eye'), t.preview);
  previewBtn.addEventListener('click', openPreview);
  continueBtn.addEventListener('click', () => {
    if (checkFolder(state.folder)) {
      document.getElementById('folder').focus();
      return;
    }
    if (state.passwordMode === 'own' && !state.own.trim()) {
      formError.textContent = t.passwordEmpty;
      formError.hidden = false;
      document.getElementById('own-password').focus();
      return;
    }
    renderStep3();
  });

  const future = report.future.length ? h('section', { class: 'card sub-card' },
    h('h3', { text: t.futureTitle }),
    h('p', { text: t.futureText }),
    checkboxList(report.future, (f) => t.futureItem(f.title, kindLabel(f.kind), formatDate(f.unlockAt)))) : null;
  const big = report.estimatedBytes > 500_000_000 ? h('section', { class: 'card sub-card' },
    h('h3', { text: t.bigTitle }),
    h('p', { text: t.bigText }),
    checkboxList(report.largest, (f) => `${f.name} (${Math.round(f.size / MB)} MB)`)) : null;

  show(2, [
    h('div', { class: 'card preview-card' },
      h('h2', { text: t.title }),
      h('p', { class: 'course-name', text: state.raw.title }),
      empty ? h('div', {}, h('h3', { text: t.emptyTitle }), notice(t.emptyText, 'warn')) : null,
      h('p', { text: t.previewText }),
      h('p', {}, previewBtn)),
    h('div', { class: 'card' },
      folderField(),
      passwordField(),
      personFields(),
      summaryEl),
    future, big, formError,
    h('div', { class: 'actions step-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => renderStep1() }, icon('left'), copy.back),
      continueBtn),
    h('section', { class: 'card sub-card tracker-only' },
      h('h3', { text: t.trackerOnlyTitle }),
      h('p', { text: t.trackerOnlyText }),
      h('button', { type: 'button', class: 'btn', onclick: () => saveTracker() }, icon('download'), t.trackerOnly)),
  ]);
  refreshSummary();
}

// ---------- Step 3: Make it live ----------

let connectCount = 0;
function connectCard(onConnected) {
  const t = copy.github;
  const n = ++connectCount;
  const key = h('input', { type: 'password', id: `github-key-${n}`, class: 'github-key', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `key-error-${n}` });
  const repoInput = h('input', { type: 'text', id: `repo-name-${n}`, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `repo-hint-${n}` });
  const other = h('details', { class: 'other-name' },
    h('summary', { text: t.otherName }),
    h('div', { class: 'field' },
      h('label', { for: `repo-name-${n}`, text: t.otherNameLabel }),
      h('p', { id: `repo-hint-${n}`, class: 'hint', text: t.otherNameHint }),
      repoInput));
  const rememberBox = h('input', { type: 'checkbox', id: `remember-key-${n}` });
  const error = h('p', { id: `key-error-${n}`, class: 'error', role: 'alert', hidden: true });
  const status = h('p', { class: 'muted', role: 'status' });
  const button = h('button', { type: 'button', class: 'btn btn-primary', text: t.connect });
  button.addEventListener('click', async () => {
    const value = key.value.trim();
    if (!value) { key.focus(); return; }
    // People paste the whole address; keep only the repository name.
    const typed = repoInput.value.trim().replace(/\/+$/, '').split('/').pop();
    button.disabled = true;
    error.hidden = true;
    status.textContent = t.checking;
    try {
      await connect(value, rememberBox.checked, typed);
      onConnected();
    } catch (e) {
      error.textContent = ghMessage(e);
      error.hidden = false;
      if (e.code === 'not-found' || e.code === 'empty') {
        other.open = true;
        repoInput.focus();
      } else {
        key.setAttribute('aria-invalid', 'true');
        key.focus();
      }
    } finally {
      button.disabled = false;
      status.textContent = '';
    }
  });
  const link = (href, text) => h('a', { class: 'btn', href, target: '_blank', rel: 'noopener' }, icon('external'), text);
  return h('section', { class: 'card sub-card connect-card', 'aria-labelledby': `connect-title-${n}` },
    h('h3', { id: `connect-title-${n}`, text: t.connectTitle }),
    h('p', { text: t.connectIntro }),
    h('ol', { class: 'steps' },
      pageRepo ? h('li', {}, h('p', { text: t.connect1 }), link(templateUrl(pageRepo), t.connect1Button)) : null,
      h('li', {}, h('p', { text: t.connect2 }), link(tokenUrl(), t.connect2Button)),
      h('li', {}, h('p', { text: t.connect3 })),
      h('li', {}, h('p', { text: t.connect4 }),
        h('div', { class: 'field' }, h('label', { for: `github-key-${n}`, text: t.keyLabel }), key, error),
        other,
        h('div', { class: 'check' }, rememberBox,
          h('label', { for: `remember-key-${n}` }, t.remember, h('br'), h('span', { class: 'muted', text: t.rememberHint }))),
        button, status)));
}

// Shown after connecting while GitHub Pages is off or publishes from the wrong
// place. Turning it on needs admin rights the key does not have, so the
// faculty member flips the setting and the page checks again.
let pagesCount = 0;
function pagesCard() {
  const t = copy.github;
  const n = ++pagesCount;
  const status = h('p', { class: 'muted', role: 'status' });
  const again = h('button', { type: 'button', class: 'btn btn-primary', text: t.pagesCheck });
  again.addEventListener('click', async () => {
    again.disabled = true;
    status.textContent = t.pagesChecking;
    try {
      gh.pages = await gh.client.pagesSite(gh.branch);
    } catch (e) {
      again.disabled = false;
      status.textContent = ghMessage(e);
      return;
    }
    again.disabled = false;
    if (!pagesReady()) {
      status.textContent = gh.pages ? t.pagesWrong(gh.branch) : t.pagesStillOff;
      return;
    }
    renderPanel();
    if (state.step === 3) renderStep3();
    refreshLinkPreview();
  });
  return h('section', { class: 'card sub-card pages-card', 'aria-labelledby': `pages-title-${n}` },
    h('h3', { id: `pages-title-${n}`, text: t.pagesTitle }),
    h('p', { text: gh.pages ? t.pagesWrong(gh.branch) : t.pagesText }),
    h('ol', { class: 'steps' },
      h('li', {}, h('p', { text: t.pages1 }),
        h('a', { class: 'btn', href: pagesSettingsUrl(gh.target), target: '_blank', rel: 'noopener' }, icon('external'), t.pages1Button)),
      h('li', {}, h('p', { text: t.pages2(gh.branch) })),
      h('li', {}, h('p', { text: t.pages3 }), again, status)));
}

function resultsView(headline, kind, built, trackerName) {
  const t = copy.live;
  const link = courseLink(state.folder);
  const linkBtn = h('button', { type: 'button', class: 'btn btn-small' }, icon('copy'), t.copyLink);
  linkBtn.addEventListener('click', () => copyText(link, linkBtn, t.copied));
  const email = t.email({ title: state.raw.title, link, password: password(), name: state.name.trim() });
  const emailBox = h('textarea', { class: 'email-box', rows: email.split('\n').length + 3, readonly: true, 'aria-label': t.emailTitle });
  emailBox.value = email;
  const emailBtn = h('button', { type: 'button', class: 'btn' }, icon('copy'), t.copyEmail);
  emailBtn.addEventListener('click', () => copyText(email, emailBtn, t.copied));
  const r = built.report;
  return [
    h('section', { class: 'card live-done', 'aria-labelledby': 'done-title' },
      h('h3', { id: 'done-title', tabindex: '-1' }, icon(kind === 'warn' ? 'warn' : 'check'), ` ${headline}`),
      h('p', { class: 'option-row' }, h('a', { class: 'live-link', href: link, target: '_blank', rel: 'noopener', text: link }), linkBtn)),
    trackerName ? notice(t.trackerSaved(trackerName), 'info', 'download') : null,
    trackerName ? h('p', {}, h('button', { type: 'button', class: 'btn btn-small', onclick: () => saveTracker() }, icon('download'), t.trackerAgain)) : null,
    h('section', { class: 'card' },
      h('h3', { text: t.emailTitle }),
      h('p', { class: 'muted', text: t.emailText }),
      emailBox,
      h('p', {}, emailBtn)),
    h('details', { class: 'card report' },
      h('summary', { text: t.reportTitle }),
      h('div', { class: 'two-col' },
        h('div', {}, h('h4', { text: copy.check.included }), countsList(r)),
        h('div', {}, h('h4', { text: copy.check.leftOut }), leftOutList(r))),
      r.tools.length ? [h('p', { text: t.reportTools }), h('ul', {}, r.tools.map((x) => h('li', { text: x })))] : null,
      r.everyone.length ? [h('p', { text: t.reportEveryone }), h('ul', {}, r.everyone.map((x) => h('li', { text: x.title })))] : null,
      r.canvasLinks.length ? [h('p', { text: t.reportCanvas }), h('ul', {}, r.canvasLinks.map((x) => h('li', {}, h('strong', { text: x.itemTitle }), `: ${x.url}`)))] : null),
    h('p', {}, h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, t.another)),
  ];
}

function fallbackSave(results) {
  const t = copy.live;
  const status = h('p', { role: 'status', class: 'muted' });
  const error = h('p', { class: 'notice notice-warn', role: 'alert', hidden: true });
  const saveBtn = h('button', { type: 'button', class: 'btn' }, icon('download'), canWriteFolders ? t.folderButton : t.zipButton);
  saveBtn.addEventListener('click', async () => {
    error.hidden = true;
    let out;
    try {
      if (canWriteFolders) {
        let parent;
        try {
          parent = await window.showDirectoryPicker({ id: 'course-backup', mode: 'readwrite' });
        } catch (e) {
          if (e.name === 'AbortError') return;
          throw e;
        }
        try {
          out = await directoryWriter(parent, state.folder);
        } catch (e) {
          if (e.code !== 'folder-exists') throw e;
          if (!(await confirmDialog(t.replaceAsk(state.folder), t.replace, t.cancel))) return;
          out = await directoryWriter(parent, state.folder, { replace: true });
        }
      } else {
        out = zipWriter(window.zip);
      }
      saveBtn.disabled = true;
      const built = selectionFor(state.exclude);
      await packCourse({ zip: state.zip, built, password: password(), out, onProgress: (d, n) => { status.textContent = t.working(n ? Math.round((d / n) * 100) : 100); } });
      let savedText = t.savedFolder(state.folder);
      if (!canWriteFolders) {
        download(await out.close(), `${state.folder}.zip`);
        savedText = t.savedZip(`${state.folder}.zip`, state.folder);
      }
      const trackerName = await saveTracker();
      status.textContent = '';
      results.replaceChildren(...resultsView(savedText, 'info', built, trackerName).filter(Boolean));
      results.querySelector('h3').focus();
    } catch (e) {
      saveBtn.disabled = false;
      status.textContent = '';
      error.textContent = t.saveFailed(e.message);
      error.hidden = false;
    }
  });
  return h('details', { class: 'card sub-card fallback' },
    h('summary', { text: t.fallbackTitle }),
    h('p', { text: t.fallbackText }),
    saveBtn, status, error);
}

function renderStep3() {
  const t = copy.live;
  const link = courseLink(state.folder);
  const results = h('div', { class: 'results-area' });
  const bar = h('progress', { max: 100, value: 0, hidden: true, 'aria-label': t.progressLabel });
  const status = h('p', { role: 'status', class: 'muted' });
  const error = h('p', { class: 'notice notice-warn', role: 'alert', hidden: true });
  const backBtn = h('button', { type: 'button', class: 'btn', onclick: () => renderStep2() }, icon('left'), copy.back);
  const liveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large' }, icon('upload'), t.button);

  liveBtn.addEventListener('click', async () => {
    error.hidden = true;
    liveBtn.disabled = true;
    backBtn.disabled = true;
    bar.hidden = false;
    bar.value = 0;
    try {
      status.textContent = t.preparing(0);
      const siteFiles = await loadSiteFiles(siteRoot(location.href));
      const built = selectionFor(state.exclude);
      const out = collectWriter();
      await packCourse({
        zip: state.zip, built, password: password(), out,
        onProgress: (d, n) => {
          const pct = n ? Math.round((d / n) * 100) : 100;
          bar.value = Math.round(pct * 0.4);
          status.textContent = t.preparing(pct);
        },
      });
      const files = [...out.files].map(([name, data]) => ({ name, data }));
      const sha = await gh.client.publish({
        folder: state.folder, files, siteFiles, branch: gh.branch, message: `Publish ${state.raw.title}`,
        onProgress: (d, n) => {
          bar.value = 40 + Math.round((d / n) * 50);
          status.textContent = t.uploading(d, n);
        },
      });
      const trackerName = await saveTracker();
      bar.removeAttribute('value');
      status.textContent = t.publishing;
      const result = await gh.client.waitForBuild(sha);
      bar.hidden = true;
      status.textContent = '';
      liveBtn.hidden = true;
      backBtn.hidden = true;
      const fallback = stepEl.querySelector('.fallback');
      if (fallback) fallback.hidden = true;
      const headline = result === 'built' ? t.done : result === 'timeout' ? t.slow : t.buildFailed;
      results.replaceChildren(...resultsView(headline, result === 'built' ? 'info' : 'warn', built, trackerName).filter(Boolean));
      results.querySelector('h3').focus();
      refreshCourses();
    } catch (e) {
      bar.hidden = true;
      status.textContent = '';
      liveBtn.disabled = false;
      backBtn.disabled = false;
      error.textContent = t.failed(e.code ? ghMessage(e) : e.message);
      error.hidden = false;
      if (e.code === 'bad-token') disconnect();
    }
  });

  const summary = h('dl', { class: 'facts-list' },
    h('dt', { text: t.link }), h('dd', {}, h('code', { text: link })),
    h('dt', { text: t.password }), h('dd', { text: password() || t.noPassword }));

  // Until the site is connected and Pages is on, a setup card stands below the
  // summary in place of the Make it live button.
  const ready = gh.client && pagesReady();
  let setup = null;
  if (!gh.client) setup = connectCard(() => renderStep3());
  else if (!ready) setup = pagesCard();

  show(3, [
    h('div', { class: 'card' },
      h('h2', { text: t.title }),
      h('p', { class: 'course-name', text: state.raw.title }),
      summary,
      ready ? h('div', {}, h('div', { class: 'actions' }, backBtn, liveBtn), bar, status, error) : null),
    setup,
    setup ? h('div', { class: 'actions step-actions' }, backBtn) : null,
    results,
    fallbackSave(results),
  ]);
}

// ---------- Start ----------

async function start() {
  renderPanel();
  renderStep1();
  const saved = tokens.load();
  if (saved) {
    try {
      await connect(saved, tokens.remembered(), tokens.repo() || '');
    } catch (error) {
      if (['bad-token', 'no-access', 'not-found', 'empty'].includes(error.code)) tokens.clear();
      gh.error = ghMessage(error);
      renderPanel();
    }
  }
}

start();
