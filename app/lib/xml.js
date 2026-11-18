// Small helpers for reading Canvas export XML in the browser and in Node.
// Elements are matched by local name, so namespaced tags such as
// <lomimscc:title> and Canvas's default-namespace tags both match.

export function parseXml(text) {
  const doc = new globalThis.DOMParser().parseFromString(text, 'text/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`XML could not be read: ${error.textContent.slice(0, 200)}`);
  return doc;
}

function localName(el) {
  const name = el.localName || el.nodeName || '';
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

export function kids(el, name) {
  if (!el) return [];
  const out = [];
  for (const child of el.childNodes || []) {
    if (child.nodeType === 1 && localName(child) === name) out.push(child);
  }
  return out;
}

export function kid(el, name) {
  if (!el) return null;
  for (const child of el.childNodes || []) {
    if (child.nodeType === 1 && localName(child) === name) return child;
  }
  return null;
}

export function txt(el, name) {
  const found = kid(el, name);
  if (!found) return null;
  const value = found.textContent.trim();
  return value === '' ? null : value;
}

// Every descendant with this local name, in document order.
export function all(el, name) {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1) continue;
      if (localName(child) === name) out.push(child);
      walk(child);
    }
  };
  if (el) walk(el);
  return out;
}
