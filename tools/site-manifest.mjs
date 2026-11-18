// Writes site-files.json: the files that make up a course site. The publish
// page copies these into a faculty member's repository so their site code
// matches the page they publish from. Run after changing site files:
//   node tools/site-manifest.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// Only these top-level files and folders make up the site. Everything else
// (published courses, tests, tools, README) stays out, so a course published
// into this repository is never copied into other people's sites. A new
// top-level site folder must be added here and to RESERVED in publish/naming.js.
const SITE = /^(\.nojekyll|LICENSE|index\.html|sw\.js|(app|help|pack|publish|vendor)\/.+)$/;

export function siteFiles() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  return tracked.filter((path) => SITE.test(path)).sort();
}

if (process.argv[1] && process.argv[1].endsWith('site-manifest.mjs')) {
  const files = siteFiles();
  writeFileSync(join(root, 'site-files.json'), `${JSON.stringify({ files }, null, 2)}\n`);
  console.log(`site-files.json: ${files.length} files`);
}
