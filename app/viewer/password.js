// The password screen a student sees before a protected course opens.
import { h } from './dom.js';
import { copy } from './copy.js';
import { themeButton } from './render.js';
import { WrongPasswordError } from '../lib/crypto.js';

export function showPasswordScreen(root, { title, onSubmit }) {
  const t = copy.gate;
  const input = h('input', {
    id: 'course-password', type: 'password', name: 'password', autocomplete: 'current-password',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-describedby': 'password-error',
  });
  const error = h('p', { id: 'password-error', class: 'error', hidden: true });
  const toggle = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', text: t.show });
  toggle.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? t.show : t.hide;
    toggle.setAttribute('aria-pressed', String(!showing));
  });
  const rememberBox = h('input', { id: 'remember-device', type: 'checkbox' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', text: t.open });
  const status = h('p', { class: 'muted', role: 'status' });

  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    submit.disabled = false;
    status.textContent = '';
    input.focus();
  };

  const form = h('form', { novalidate: true },
    h('div', { class: 'field' },
      h('label', { for: 'course-password', text: t.label }),
      h('div', { class: 'password-row' }, input, toggle),
      error),
    h('div', { class: 'check' }, rememberBox,
      h('label', { for: 'remember-device' }, t.remember, h('br'), h('span', { class: 'muted', text: t.rememberHint }))),
    submit,
    status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.value.trim()) { fail(t.empty); return; }
    submit.disabled = true;
    error.hidden = true;
    input.removeAttribute('aria-invalid');
    status.textContent = t.opening;
    try {
      await onSubmit(input.value, rememberBox.checked);
    } catch (e) {
      fail(e instanceof WrongPasswordError ? t.wrong : t.failed);
    }
  });

  document.title = title;
  root.classList.remove('app-loading');
  root.replaceChildren(h('main', { class: 'gate' },
    h('div', { class: 'card gate-card' },
      h('div', { class: 'gate-top' },
        h('p', { class: 'gate-kicker', text: t.kicker }), themeButton()),
      h('h1', { text: title }),
      h('p', { text: t.intro }),
      form)));
  input.focus();
}

export function showMessage(root, message) {
  root.classList.remove('app-loading');
  root.replaceChildren(h('main', { class: 'gate' }, h('div', { class: 'card gate-card' }, h('p', { text: message }))));
}
