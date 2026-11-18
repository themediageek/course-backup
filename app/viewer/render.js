// The course viewer's frame (top bar, menu, footer) and its router.
// Routes live in the address after "#", so GitHub Pages never sees them.
import { h } from './dom.js';
import { icon } from './icons.js';
import { copy } from './copy.js';
import {
  homeView, modulesView, itemView, fileView, syllabusView, assignmentsView, pagesView, filesView,
  searchView, notFoundView, outlineList,
} from './views.js';

const THEME_KEY = 'cbs-theme';

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}
function storeTheme(value) {
  try { localStorage.setItem(THEME_KEY, value); } catch { /* private window */ }
}
export function applyStoredTheme() {
  const theme = storedTheme();
  if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
}
function isDark() {
  const set = document.documentElement.getAttribute('data-theme');
  if (set) return set === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function themeButton() {
  const button = h('button', { class: 'icon-btn theme-toggle', type: 'button' });
  const paint = () => {
    const dark = isDark();
    button.replaceChildren(icon(dark ? 'sun' : 'moon'));
    button.setAttribute('aria-label', dark ? copy.themeToLight : copy.themeToDark);
    button.setAttribute('title', dark ? copy.themeToLight : copy.themeToDark);
  };
  button.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    storeTheme(next);
    paint();
  });
  paint();
  return button;
}

function parseRoute(hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  const params = new URLSearchParams(query);
  return { name: parts[0] || 'home', id: parts[1] || null, params };
}

export function mountViewer(root, { course, files, now = new Date(), DOMPurify, extraMenu = null }) {
  applyStoredTheme();
  const ctx = { course, files, now, DOMPurify, index: null };
  const blobUrls = new Map();
  let lastRoute = '#/';
  let firstRender = true;

  const navItems = [
    ['home', '#/', 'home'],
    ['modules', '#/modules', 'modules'],
    course.nav.syllabus ? ['syllabus', '#/syllabus', 'syllabus'] : null,
    course.nav.assignments ? ['assignments', '#/assignments', 'assignments'] : null,
    course.nav.pages ? ['pages', '#/pages', 'pages'] : null,
    course.nav.files ? ['files', '#/files', 'files'] : null,
  ].filter(Boolean);

  const searchInput = h('input', { type: 'search', id: 'course-search', name: 'q', autocomplete: 'off', placeholder: copy.searchButton });
  const searchForm = h('form', { class: 'search', role: 'search', onsubmit: (e) => {
    e.preventDefault();
    location.hash = `#/search?q=${encodeURIComponent(searchInput.value.trim())}`;
  } },
  h('label', { class: 'visually-hidden', for: 'course-search', text: copy.searchLabel }),
  searchInput,
  h('button', { type: 'submit', 'aria-label': copy.searchButton, title: copy.searchButton }, icon('search')));

  const sidebar = h('nav', { class: 'sidebar', id: 'course-menu', 'aria-label': copy.menu },
    h('ul', { class: 'nav-links' }, navItems.map(([key, href, iconName]) =>
      h('li', {}, h('a', { href, 'data-nav': key }, icon(iconName), copy.nav[key])))),
    course.modules.length ? h('h2', { class: 'outline-heading', text: copy.nav.modules }) : null,
    outlineList(ctx),
    extraMenu);

  const menuButton = h('button', { class: 'icon-btn menu-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'course-menu' },
    icon('menu'), h('span', { text: copy.menuButton }));
  const setMenu = (open) => {
    sidebar.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.replaceChildren(icon(open ? 'close' : 'menu'), h('span', { text: open ? copy.closeMenu : copy.menuButton }));
  };
  menuButton.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));

  const subParts = [];
  const person = course.instructor || {};
  if (course.code && course.code !== course.title) subParts.push(course.code);
  if (person.name) subParts.push(copy.instructor(person.name));
  if (person.email) subParts.push(h('a', { href: `mailto:${person.email}`, text: person.email }));
  const sub = subParts.flatMap((part, i) => (i ? [' · ', part] : [part]));

  const main = h('main', { id: 'main', tabindex: '-1' });
  const shell = [
    h('a', { class: 'skip-link', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, copy.skip),
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' },
      menuButton,
      h('div', { class: 'course-id' },
        h('a', { class: 'course-title', href: '#/', text: course.title }),
        sub.length ? h('div', { class: 'course-sub' }, sub) : null),
      searchForm,
      themeButton())),
    h('div', { class: 'layout' }, sidebar, main),
    h('footer', { class: 'site-footer' }, h('p', { text: copy.footer })),
  ];
  root.classList.remove('app-loading');
  root.replaceChildren(...shell);

  function hydrate(container) {
    for (const el of container.querySelectorAll('[data-cbs-file]')) {
      const id = el.getAttribute('data-cbs-file');
      const set = (url) => { el.setAttribute('src', url); el.removeAttribute('data-cbs-file'); };
      if (blobUrls.has(id)) { set(blobUrls.get(id)); continue; }
      files.blob(id).then((blob) => {
        const url = URL.createObjectURL(blob);
        blobUrls.set(id, url);
        set(url);
      }).catch(() => {});
    }
  }

  function markCurrent(route) {
    for (const a of sidebar.querySelectorAll('[data-nav]')) {
      const key = a.getAttribute('data-nav');
      const current = key === route.name || (key === 'home' && route.name === 'home');
      if (current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    let currentModule = null;
    for (const a of sidebar.querySelectorAll('.outline a[data-ref]')) {
      const current = (route.name === 'item' || route.name === 'file') && a.getAttribute('data-ref') === route.id;
      if (current) {
        a.setAttribute('aria-current', 'page');
        currentModule = a.closest('details');
      } else a.removeAttribute('aria-current');
    }
    if (currentModule) currentModule.open = true;
    if (route.name === 'modules' && route.id) {
      const d = sidebar.querySelector(`details[data-module="${CSS.escape(route.id)}"]`);
      if (d) d.open = true;
    }
  }

  function render() {
    const route = parseRoute(location.hash);
    let view;
    switch (route.name) {
      case 'home': view = homeView(ctx); break;
      case 'modules': view = modulesView(ctx, route.id); break;
      case 'item': view = itemView(ctx, route.id); break;
      case 'file': view = fileView(ctx, route.id); break;
      case 'syllabus': view = course.nav.syllabus ? syllabusView(ctx) : notFoundView(); break;
      case 'assignments': view = course.nav.assignments ? assignmentsView(ctx) : notFoundView(); break;
      case 'pages': view = course.nav.pages ? pagesView(ctx) : notFoundView(); break;
      case 'files': view = course.nav.files ? filesView(ctx) : notFoundView(); break;
      case 'search':
        view = searchView(ctx, route.params.get('q') || '');
        searchInput.value = route.params.get('q') || '';
        break;
      default: view = notFoundView();
    }
    main.replaceChildren(view.node);
    hydrate(main);
    document.title = `${view.title} | ${course.title}`;
    markCurrent(route);
    setMenu(false);
    const focusTarget = view.focusId ? main.querySelector(`#${CSS.escape(view.focusId)}`) : main.querySelector('h1');
    if (view.focusId && focusTarget) {
      focusTarget.closest('section').scrollIntoView({ block: 'start' });
      focusTarget.focus({ preventScroll: true });
    } else if (!firstRender) {
      window.scrollTo(0, 0);
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
    firstRender = false;
    lastRoute = location.hash || '#/';
  }

  function onHash() {
    const hash = location.hash;
    // A link inside course content to a spot on the same page.
    if (hash && hash !== '#' && !hash.startsWith('#/')) {
      const target = main.querySelector(`[id="${CSS.escape(hash.slice(1))}"], [name="${CSS.escape(hash.slice(1))}"]`);
      history.replaceState(null, '', lastRoute);
      if (target) target.scrollIntoView({ block: 'start' });
      return;
    }
    render();
  }

  window.addEventListener('hashchange', onHash);
  render();
  return {
    destroy() {
      window.removeEventListener('hashchange', onHash);
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    },
  };
}
