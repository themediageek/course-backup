// Writes a made-up Canvas export with a real image and a real PDF, for
// trying the site without a real course.
//   node tools/sample-export.mjs <out.imscc>
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as zipLib from '@zip.js/zip.js';
import { sampleFiles } from '../tests/helpers/sample-course.js';

zipLib.configure({ useWebWorkers: false });

function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// A 240 by 120 picture of a sea and sky, as a PNG.
function seaPng(width = 240, height = 120) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0];
    for (let x = 0; x < width; x++) {
      const sea = y > height * 0.55 + Math.sin(x / 14) * 4;
      row.push(...(sea ? [28, 93 + Math.round(y / 4), 140] : [200 - Math.round(y / 2), 225, 245]));
    }
    rows.push(...row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A one-page PDF with a title and two lines of text.
function readingPdf() {
  const text = 'BT /F1 22 Tf 72 720 Td (Reading the Tides) Tj /F1 12 Tf 0 -36 Td (A made-up reading for trying the course backup site.) Tj 0 -18 Td (Spring tides happen near new and full moons.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const pdf = readingPdf();
const files = sampleFiles({
  'web_resources/Uploaded Media/photo (1).jpg': seaPng(),
  "web_resources/O'Connor - Culture.pdf": pdf,
  'web_resources/Copies/Culture copy.pdf': pdf,
});
// The picture is a PNG, so give it the right name everywhere.
for (const name of Object.keys(files)) {
  if (typeof files[name] === 'string') files[name] = files[name].replaceAll('photo%20(1).jpg', 'photo%20(1).png').replaceAll('photo (1).jpg', 'photo (1).png');
}
files['web_resources/Uploaded Media/photo (1).png'] = files['web_resources/Uploaded Media/photo (1).jpg'];
delete files['web_resources/Uploaded Media/photo (1).jpg'];

const writer = new zipLib.ZipWriter(new zipLib.Uint8ArrayWriter());
for (const [name, content] of Object.entries(files)) {
  await writer.add(name, typeof content === 'string' ? new zipLib.TextReader(content) : new zipLib.Uint8ArrayReader(content));
}
const out = process.argv[2] || 'sample-course.imscc';
writeFileSync(out, await writer.close());
console.log(out);
