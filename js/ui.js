// Icons, toasts, drawers and dialogs.
import { $, esc } from './util.js';

const P = {
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  xls: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8.5 12.5l5 5M13.5 12.5l-5 5"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  undo: '<path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="M8 5L4 9l4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  hyd: '<path d="M4 9h9a3 3 0 0 1 0 6H4zM13 12h7M17 9v6"/><path d="M7 6v3M7 15v3"/>'
};

export const icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

export const brand = (lg = false) => `
  <div class="brand${lg ? ' lg' : ''}"><img src="assets/yuken-logo.svg" alt="Yuken"><div class="ltd">India Limited<i></i></div></div>`;

// ---------- toast ----------
export function toast(msg, kind = 'ok', ms = 2600) {
  let wrap = $('.toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toasts'; wrap.setAttribute('role', 'status'); document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = icon(kind === 'ok' ? 'check' : 'alert') + `<span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, ms);
}

// ---------- drawer ----------
export function drawer({ title, body, foot = '', onMount }) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('aside'); el.className = 'drawer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<header class="drawer-head"><h2>${title}</h2><button class="btn ghost icon" data-x aria-label="Close">${icon('x')}</button></header>
    <div class="drawer-body">${body}</div>${foot ? `<footer class="drawer-foot">${foot}</footer>` : ''}`;
  document.body.append(scrim, el);
  const prev = document.activeElement;
  const close = () => {
    el.classList.add('closing'); scrim.style.opacity = 0; scrim.style.transition = 'opacity .2s';
    setTimeout(() => { el.remove(); scrim.remove(); prev?.focus?.(); }, 210);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.onclick = close; el.querySelector('[data-x]').onclick = close;
  setTimeout(() => (el.querySelector('input:not([type=hidden]),select,textarea') || el.querySelector('[data-x]')).focus(), 60);
  onMount?.(el, close);
  return { el, close };
}

// ---------- confirm ----------
export function confirmBox({ title, text, ok = 'Confirm', danger = false, input = null }) {
  return new Promise(resolve => {
    const scrim = document.createElement('div'); scrim.className = 'scrim top';
    const el = document.createElement('div'); el.className = 'dialog'; el.setAttribute('role', 'alertdialog');
    el.innerHTML = `<h2>${esc(title)}</h2><p>${text}</p>
      ${input ? `<div class="field" style="margin-bottom:18px"><input class="input" type="${input.type || 'text'}" placeholder="${esc(input.placeholder || '')}" value="${esc(input.value || '')}"></div>` : ''}
      <div class="row"><button class="btn ghost" data-c>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-o>${esc(ok)}</button></div>`;
    document.body.append(scrim, el);
    const inp = el.querySelector('input');
    (inp || el.querySelector('[data-o]')).focus();
    const done = v => { el.remove(); scrim.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter' && inp) done(inp.value); };
    document.addEventListener('keydown', key);
    el.querySelector('[data-c]').onclick = () => done(false);
    el.querySelector('[data-o]').onclick = () => done(inp ? inp.value : true);
    scrim.onclick = () => done(false);
  });
}

// ---------- form dialog ----------
// Resolves with the form values when onSubmit returns true, or false on cancel.
export function formDialog({ title, text = '', body, ok = 'Save', onSubmit }) {
  return new Promise(resolve => {
    const scrim = document.createElement('div'); scrim.className = 'scrim top';
    const el = document.createElement('div'); el.className = 'dialog'; el.setAttribute('role', 'dialog');
    el.innerHTML = `<h2>${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}<form novalidate>${body}<div class="form-err" hidden></div></form>
      <div class="row"><button class="btn ghost" data-c>Cancel</button><button class="btn primary" data-o>${esc(ok)}</button></div>`;
    document.body.append(scrim, el);
    const form = el.querySelector('form');
    setTimeout(() => form.querySelector('input')?.focus(), 50);
    const done = v => { el.remove(); scrim.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const submit = async () => {
      const btn = el.querySelector('[data-o]'); btn.classList.add('busy');
      const err = form.querySelector('.form-err'); err.hidden = true;
      try { const r = await onSubmit(Object.fromEntries(new FormData(form).entries()), form); if (r) return done(r); }
      catch (e) { err.textContent = e.message; err.hidden = false; }
      btn.classList.remove('busy');
    };
    const key = e => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', key);
    form.onsubmit = e => { e.preventDefault(); submit(); };
    form.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    el.querySelector('[data-c]').onclick = () => done(false);
    el.querySelector('[data-o]').onclick = submit;
    scrim.onclick = () => done(false);
  });
}

// ---------- form helpers ----------
export function field({ name, label, type = 'text', value = '', hint = '', opt = false, attrs = '', cls = '', options = null, span = false }) {
  const id = 'f_' + name;
  const control = options
    ? `<select class="input" id="${id}" name="${name}" ${attrs}>${options.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`
    : type === 'textarea'
      ? `<textarea class="input" id="${id}" name="${name}" ${attrs}>${esc(value)}</textarea>`
      : `<input class="input ${cls}" id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;
  return `<div class="field${span ? ' span' : ''}" data-field="${name}"><label for="${id}">${esc(label)}${opt ? ' <small>Optional</small>' : ''}</label>${control}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}<div class="msg"></div></div>`;
}

export function setErrors(root, errors) {
  let first = null;
  root.querySelectorAll('[data-field]').forEach(f => {
    const m = errors[f.dataset.field] || '';
    f.classList.toggle('err', !!m);
    f.querySelector('.msg').textContent = m;
    if (m && !first) first = f;
  });
  first?.querySelector('input,select,textarea')?.focus();
  return !first;
}

export const formData = form => Object.fromEntries(new FormData(form).entries());
