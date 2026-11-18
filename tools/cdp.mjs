// Drives headless Chrome over the DevTools protocol for local checks:
// screenshots at any width (including phones), dark mode, and running a
// script in the page (for example the axe accessibility scan). Development only.
//
//   node tools/cdp.mjs shot <out.png> <url> [--size 1280x900] [--dark] [--wait ".topbar"] [--full]
//   node tools/cdp.mjs eval <url> <file-with-js> [--size ...] [--dark] [--wait ...]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, value && !value.startsWith('--') ? 2 : 1);
  return value && !value.startsWith('--') ? value : true;
};
const size = opt('size', '1280x900');
const dark = Boolean(opt('dark', false));
const waitFor = opt('wait', '.topbar, .gate, .page-shell');
const full = Boolean(opt('full', false));
const before = opt('before', null);
const downloads = opt('downloads', null);
const [mode, a, b] = args;
const [width, height] = size.split('x').map(Number);

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'cbs-cdp-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start');
}

const ws = await connect();
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  if (downloads) await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  const url = mode === 'shot' ? b : a;
  await send('Page.navigate', { url });
  const started = Date.now();
  while (!(await evaluate(`Boolean(document.querySelector(${JSON.stringify(waitFor)}))`).catch(() => false))) {
    if (Date.now() - started > 90000) throw new Error(`Timed out waiting for ${waitFor}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 600));
  if (before) console.error(JSON.stringify(await evaluate(readFileSync(before, 'utf8'))));
  if (mode === 'shot') {
    const params = { format: 'png' };
    if (full) {
      const metrics = await send('Page.getLayoutMetrics');
      const h = Math.min(6000, Math.ceil(metrics.cssContentSize.height));
      params.clip = { x: 0, y: 0, width, height: h, scale: 1 };
      params.captureBeyondViewport = true;
    }
    const shot = await send('Page.captureScreenshot', params);
    writeFileSync(a, Buffer.from(shot.data, 'base64'));
    console.log(a);
  } else if (mode === 'tab') {
    // Presses Tab a number of times and reports where focus lands and whether it shows.
    const presses = Number(b) || 10;
    for (let i = 0; i < presses; i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      console.log(JSON.stringify(await evaluate(`(() => {
        const el = document.activeElement;
        const shown = el.type === 'file' ? el.nextElementSibling : el;
        const s = getComputedStyle(shown);
        return { el: (el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 40), outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor };
      })()`)));
    }
  } else if (mode === 'eval') {
    console.log(JSON.stringify(await evaluate(readFileSync(b, 'utf8')), null, 2));
  }
} finally {
  ws.close();
  chrome.kill();
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still closing */ } }, 500);
}
