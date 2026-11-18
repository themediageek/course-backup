// Starts a packed course: reads key.json, asks for the password when the
// course has one, opens the course file, and mounts the viewer.
import DOMPurify from '../../vendor/purify.es.mjs';
import { unlock, unlockTyped, openJson } from '../lib/crypto.js';
import { mountViewer, applyStoredTheme } from './render.js';
import { createRemoteSource } from './remote-source.js';
import { remember, rememberSafely, recall, forget } from './keystore.js';
import { showPasswordScreen, showMessage } from './password.js';
import { copy } from './copy.js';
import { h } from './dom.js';

const app = document.getElementById('app');
const base = new URL('./', location.href).href;
let swContext = null;

applyStoredTheme();

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register('../sw.js', { scope: '../' });
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 4000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    return Boolean(navigator.serviceWorker.controller);
  } catch {
    return false;
  }
}

// The service worker asks for the key when it restarts or when a file link
// opens in a new tab.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'need-course' && event.data.base === base && swContext && event.ports[0]) {
      event.ports[0].postMessage(swContext);
    }
  });
}

function filesForWorker(course) {
  const files = {};
  for (const [id, f] of Object.entries(course.files)) {
    files[id] = { name: f.name, mime: f.mime, size: f.size, pieces: f.pieces, same: f.same || null, opensAt: f.opensAt || null };
  }
  return files;
}

async function openCourse(keyJson, key, swReady, { rememberIt, remembered }) {
  const response = await fetch(keyJson.course, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Course file missing (${response.status})`);
  const course = await openJson(key, new Uint8Array(await response.arrayBuffer()));
  if (rememberIt) await rememberSafely(remember, base, key);
  const sw = await swReady;
  if (sw) {
    swContext = { type: 'course', base, key, files: filesForWorker(course), bundles: course.bundles };
    navigator.serviceWorker.controller.postMessage(swContext);
  }
  const extraMenu = (rememberIt || remembered)
    ? h('p', { class: 'forget-row' }, h('button', { class: 'btn-link', type: 'button', text: copy.gate.forget, onclick: async () => {
      await forget(base);
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'forget', base });
      }
      location.reload();
    } }))
    : null;
  mountViewer(app, { course, files: createRemoteSource({ base, course, key, swReady: sw }), now: new Date(), DOMPurify, extraMenu });
}

async function start() {
  const swReady = registerServiceWorker();
  let keyJson;
  try {
    const response = await fetch('key.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(String(response.status));
    keyJson = await response.json();
  } catch {
    showMessage(app, copy.gate.missing);
    return;
  }
  document.title = keyJson.title;

  if (keyJson.key) {
    await openCourse(keyJson, await unlock(keyJson, null), swReady, {}).catch(() => showMessage(app, copy.gate.failed));
    return;
  }
  const saved = await recall(base);
  if (saved) {
    try {
      await openCourse(keyJson, saved, swReady, { remembered: true });
      return;
    } catch {
      await forget(base);
    }
  }
  showPasswordScreen(app, {
    title: keyJson.title,
    onSubmit: async (password, rememberIt) => {
      const key = await unlockTyped(keyJson, password);
      await openCourse(keyJson, key, swReady, { rememberIt });
    },
  });
}

start();
