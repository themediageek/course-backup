// Matching the file paths that Canvas writes into course HTML
// ($IMS-CC-FILEBASE$/Uploaded%20Media/photo.jpg?canvas_download=1)
// to the files stored in the export's web_resources/ folder.

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Builds a function that turns a path written after $IMS-CC-FILEBASE$/
// into a file id, or null when no file in the export matches.
export function makeFileResolver(files) {
  const exact = new Map();
  const loose = new Map();
  for (const [id, file] of Object.entries(files)) {
    const rel = file.path.replace(/^web_resources\//, '').normalize('NFC');
    exact.set(rel, id);
    loose.set(rel.toLowerCase(), id);
  }
  return function resolve(written) {
    if (!written) return null;
    let raw = written.replace(/^\/+/, '');
    raw = raw.split('?')[0].split('#')[0];
    raw = raw.replace(/&amp;/g, '&');
    const candidates = [safeDecode(raw), safeDecode(raw.replace(/\+/g, ' ')), raw];
    for (const c of candidates) {
      const key = c.normalize('NFC');
      if (exact.has(key)) return exact.get(key);
    }
    for (const c of candidates) {
      const key = c.normalize('NFC').toLowerCase();
      if (loose.has(key)) return loose.get(key);
    }
    return null;
  };
}

// Every path written after $IMS-CC-FILEBASE$/ in a piece of text.
// Canvas sometimes writes plain spaces in these paths, so a path runs to the
// closing quote (or escaped quote, or line end), not to the first space.
export function fileBaseRefs(text) {
  const out = [];
  for (const m of text.matchAll(/\$IMS-CC-FILEBASE\$\/(.*?)(?=["'<>\n]|&quot;|&#39;|&#x27;|$)/g)) {
    let ref = m[1].trim();
    // An unquoted CSS url(...) leaves its closing parenthesis on the path.
    const opens = (ref.match(/\(/g) || []).length;
    const closes = (ref.match(/\)/g) || []).length;
    if (closes > opens && ref.endsWith(')')) ref = ref.slice(0, -1).trim();
    if (ref) out.push(ref);
  }
  return out;
}
