// File types by extension, and which types the browser may open itself.

const TYPES = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', aac: 'audio/aac',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', html: 'text/html', htm: 'text/html',
  json: 'application/json', xml: 'application/xml', rtf: 'application/rtf', zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip',
};

export function mimeFor(name) {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return TYPES[name.slice(dot + 1).toLowerCase()] || 'application/octet-stream';
}

// SVG and HTML can carry scripts, so they always download instead of opening.
export function inlineType(mime) {
  if (mime === 'image/svg+xml') return false;
  return mime === 'application/pdf' || mime === 'text/plain' ||
    mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
}
