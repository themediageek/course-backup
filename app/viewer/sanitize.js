// Cleans course HTML before it is shown, then turns the site's internal link
// forms (cbs-file:, cbs-item:, ...) into working links or plain notes.
// Every course on a site shares one web address, so no course HTML may run
// scripts.
import { copy } from './copy.js';
import { isCanvasLink } from '../lib/links.js';
import { inlineType } from '../lib/mime.js';
import { formatDate, isOpen } from '../lib/dates.js';

// The opening date of a file that has not opened yet, or null.
function notOpenUntil(file, now) {
  return file && file.opensAt && !isOpen(file.opensAt, now) ? file.opensAt : null;
}

const URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|cbs-[a-z]+):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;
const MEDIA_SRC = 'img[src], source[src], video[src], audio[src], iframe[src], embed[src], track[src]';

export function cleanHtml(html, DOMPurify) {
  const fragment = DOMPurify.sanitize(html || '', {
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'target', 'scrolling'],
    ALLOWED_URI_REGEXP: URI,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
  });
  // Only https iframes (and Canvas's own, which become notes later) stay.
  for (const frame of [...fragment.querySelectorAll('iframe')]) {
    const src = (frame.getAttribute('src') || '').trim();
    if (!/^https:\/\//i.test(src) && !(src.startsWith('/') && !src.startsWith('//'))) frame.remove();
  }
  return fragment;
}

function note(doc, text, reason) {
  const span = doc.createElement('span');
  span.className = 'missing-note';
  span.textContent = text ? `${text} ` : '';
  const why = doc.createElement('span');
  why.className = 'missing-why';
  why.textContent = `(${reason})`;
  span.appendChild(why);
  return span;
}

function blockNote(doc, reason) {
  const p = doc.createElement('p');
  p.className = 'missing-note missing-block';
  p.textContent = reason;
  return p;
}

function hiddenText(doc, text) {
  const span = doc.createElement('span');
  span.className = 'visually-hidden';
  span.textContent = ` ${text}`;
  return span;
}

function resolveAnchor(a, ctx) {
  const { course, files, doc } = ctx;
  const href = (a.getAttribute('href') || '').trim();
  const text = a.textContent.trim();
  const swap = (reason) => a.replaceWith(note(doc, text, reason));
  let m = /^cbs-([a-z]+):(.*)$/.exec(href);
  if (m) {
    const [, kind, id] = m;
    a.removeAttribute('target');
    if (kind === 'item') {
      if (course.items[id]) a.setAttribute('href', `#/item/${id}`);
      else swap(copy.missing.item);
    } else if (kind === 'modules') {
      a.setAttribute('href', id ? `#/modules/${id}` : '#/modules');
    } else if (kind === 'route') {
      if (course.nav[id]) a.setAttribute('href', `#/${id}`);
      else swap(copy.missing.item);
    } else if (kind === 'file') {
      const file = course.files[id];
      if (!file) { swap(copy.missing.file); return; }
      const opens = notOpenUntil(file, ctx.now);
      if (opens) { swap(copy.opens(formatDate(opens, ctx.now))); return; }
      const url = files.url(id);
      if (url) {
        a.setAttribute('href', url);
        if (inlineType(file.mime)) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        }
      } else {
        a.setAttribute('href', `#/file/${id}`);
      }
    } else if (kind === 'missing') {
      swap(copy.missing[id] || copy.missing.item);
    } else {
      swap(copy.missing.item);
    }
    return;
  }
  if (isCanvasLink(href)) {
    if (href.startsWith('/')) { swap(copy.missing.canvas); return; }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    const label = doc.createElement('span');
    label.className = 'canvas-label';
    label.textContent = ` ${copy.canvasLabel}`;
    a.after(label);
    return;
  }
  if (/^https?:\/\//i.test(href)) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.appendChild(hiddenText(doc, copy.newTab));
  }
}

function resolveMedia(el, ctx) {
  const { course, files, doc } = ctx;
  const src = (el.getAttribute('src') || '').trim();
  const tag = el.tagName.toLowerCase();
  let m = /^cbs-([a-z]+):(.*)$/.exec(src);
  if (m) {
    const [, kind, id] = m;
    const file = kind === 'file' ? course.files[id] : null;
    const opens = notOpenUntil(file, ctx.now);
    if (!file || opens) {
      if (tag === 'source' || tag === 'track') el.remove();
      else el.replaceWith(note(doc, el.getAttribute('alt') || '', opens ? copy.opens(formatDate(opens, ctx.now)) : copy.missing.file));
      return;
    }
    const url = files.url(id);
    if (url) el.setAttribute('src', url);
    else {
      el.removeAttribute('src');
      el.setAttribute('data-cbs-file', id);
    }
    return;
  }
  if (src.startsWith('/') && !src.startsWith('//')) {
    if (tag === 'img') el.replaceWith(note(doc, el.getAttribute('alt') || '', copy.missing.file));
    else if (tag === 'source' || tag === 'track') el.remove();
    else el.replaceWith(blockNote(doc, copy.missing.media));
  }
}

export function resolveLinks(fragment, { course, files, now = new Date(), document: doc = globalThis.document }) {
  const ctx = { course, files, doc, now };
  for (const a of [...fragment.querySelectorAll('a[href]')]) resolveAnchor(a, ctx);
  for (const el of [...fragment.querySelectorAll(MEDIA_SRC)]) resolveMedia(el, ctx);
  for (const video of [...fragment.querySelectorAll('video[poster]')]) {
    const m = /^cbs-file:(.*)$/.exec(video.getAttribute('poster'));
    if (m) {
      const url = files.url(m[1]);
      if (url) video.setAttribute('poster', url);
      else video.removeAttribute('poster');
    }
  }
  for (const el of [...fragment.querySelectorAll('[style*="cbs-"]')]) {
    const style = el.getAttribute('style').replace(/url\(\s*(['"]?)cbs-file:([^'")]+)\1\s*\)/g, (u, q, id) => {
      const url = course.files[id] && !notOpenUntil(course.files[id], now) && files.url(id);
      return url ? `url(${q}${url}${q})` : 'none';
    }).replace(/url\(\s*(['"]?)cbs-[a-z]+:[^'")]*\1\s*\)/g, 'none');
    el.setAttribute('style', style);
  }
  // Videos that only had Canvas sources left get a note instead of a blank player.
  for (const media of [...fragment.querySelectorAll('video, audio')]) {
    if (!media.getAttribute('src') && !media.getAttribute('data-cbs-file') && !media.querySelector('source')) {
      media.replaceWith(blockNote(doc, copy.missing.media));
    }
  }
  return fragment;
}
