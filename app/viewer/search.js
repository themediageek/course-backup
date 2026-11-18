// Search across the course text, done in the browser after the course opens.
import { isOpen } from '../lib/dates.js';

const fold = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function plainText(html) {
  if (!html) return '';
  const doc = new globalThis.DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  return (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
}

// Content that has not opened yet stays out of the index, so search cannot show it early.
export function buildIndex(course, now = new Date()) {
  const entries = [];
  const notOpen = (x) => x.opensAt && !isOpen(x.opensAt, now);
  for (const [id, item] of Object.entries(course.items)) {
    if (notOpen(item)) continue;
    const text = plainText(item.html);
    entries.push({ id, kind: 'item', type: item.type, title: item.title, text, foldedTitle: fold(item.title), foldedText: fold(text) });
  }
  for (const [id, file] of Object.entries(course.files)) {
    if (file.hidden || notOpen(file)) continue;
    entries.push({ id, kind: 'file', type: 'file', title: file.name, text: '', foldedTitle: fold(file.name), foldedText: '' });
  }
  return entries;
}

function snippet(entry, words) {
  if (!entry.text) return '';
  const at = Math.min(...words.map((w) => {
    const i = entry.foldedText.indexOf(w);
    return i === -1 ? Infinity : i;
  }));
  if (!Number.isFinite(at)) return entry.text.slice(0, 140);
  let start = Math.max(0, at - 50);
  let end = Math.min(entry.text.length, at + 100);
  // Cut at spaces so no word is split.
  if (start > 0) start = entry.text.indexOf(' ', start) + 1 || start;
  if (end < entry.text.length) end = entry.text.lastIndexOf(' ', end) > at ? entry.text.lastIndexOf(' ', end) : end;
  return `${start > 0 ? '…' : ''}${entry.text.slice(start, end).trim()}${end < entry.text.length ? '…' : ''}`;
}

export function search(index, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const results = [];
  index.forEach((entry, position) => {
    const haystack = `${entry.foldedTitle} ${entry.foldedText}`;
    if (!words.every((w) => haystack.includes(w))) return;
    const inTitle = words.filter((w) => entry.foldedTitle.includes(w)).length;
    results.push({ entry, inTitle, position });
  });
  results.sort((a, b) => b.inTitle - a.inTitle ||
    (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === 'item' ? -1 : 1) || a.position - b.position);
  return results.map(({ entry }) => ({ id: entry.id, kind: entry.kind, type: entry.type, title: entry.title, snippet: snippet(entry, words) }));
}
