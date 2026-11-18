// Checks the color tokens in app/styles.css against WCAG 2.2 AA contrast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start !== -1, `styles.css has a "${selector} {" block`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) tokens[m[1]] = m[2];
  return tokens;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent', 'accent-soft'], ['on-accent', 'accent'],
  ['warn-text', 'warn-bg'], ['danger', 'surface'], ['danger', 'bg'],
];
const UI = [['focus', 'bg'], ['focus', 'surface'], ['control-border', 'surface'], ['control-border', 'bg']];

for (const [mode, selector] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']]) {
  test(`${mode} mode colors meet WCAG AA`, () => {
    const t = block(selector);
    for (const [fg, bg] of TEXT) {
      assert.ok(t[fg] && t[bg], `${mode} defines --${fg} and --${bg}`);
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${mode}: --${fg} on --${bg} is ${r.toFixed(2)}:1, needs 4.5`);
    }
    for (const [fg, bg] of UI) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 3, `${mode}: --${fg} on --${bg} is ${r.toFixed(2)}:1, needs 3`);
    }
  });
}

test('the system dark mode uses the same tokens as the dark toggle', () => {
  const dark = block(':root[data-theme="dark"]');
  const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const system = {};
  for (const m of media.slice(0, media.indexOf('}')).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) system[m[1]] = m[2];
  assert.deepEqual(system, dark);
});
