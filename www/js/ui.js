// Wiederverwendbare Bausteine: Dialog/Bottom-Sheet, Bestätigung, Hinweis-Leiste (Toast),
// Combobox mit Suche, Datums-/Uhrzeitfelder (de-DE, 24 h), Segment-Auswahl.

import { h, $, uid, norm, parseDateInput, parseTimeInput, dateToField, pad } from './util.js';
import { icon } from './icons.js';

// ------------------------------------------------------------------ Dialoge
const stack = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Öffnet einen Dialog (Desktop) bzw. ein Bottom-Sheet (Handy – nur per CSS umgeschaltet).
 *  canClose() darf false liefern (z. B. bei ungespeicherten Änderungen). */
export function openModal({ title, body, footer, onClose, canClose, cls = '', labelledBy }) {
  const root = $('#overlay-root');
  const titleId = 'dlg-' + uid().slice(0, 6);
  const prevFocus = document.activeElement;
  const closeBtn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Schließen', onclick: () => api.close() }, icon('x'));
  const modal = h('div', { class: `modal ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy || titleId, tabindex: '-1' },
    h('div', { class: 'modal-grab', 'aria-hidden': 'true' }),
    h('header', { class: 'modal-head' }, h('h2', { id: titleId }, title || ''), closeBtn),
    h('div', { class: 'modal-body' }, body),
    footer ? h('footer', { class: 'modal-foot' }, footer) : null);
  const scrim = h('div', { class: 'scrim' }, modal);
  let downOnScrim = false;
  scrim.addEventListener('pointerdown', (e) => { downOnScrim = e.target === scrim; });
  scrim.addEventListener('click', (e) => { if (e.target === scrim && downOnScrim) api.close(); });
  root.append(scrim);
  document.documentElement.classList.add('modal-open');
  const api = {
    el: modal, body: modal.querySelector('.modal-body'),
    close(result) {
      if (canClose && canClose() === false) return false;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      scrim.remove();
      if (!stack.length) document.documentElement.classList.remove('modal-open');
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.({ preventScroll: true });
      onClose?.(result);
      return true;
    },
    setTitle(t) { modal.querySelector('h2').textContent = t; },
  };
  stack.push(api);
  requestAnimationFrame(() => {
    const first = modal.querySelector('[autofocus]') || modal.querySelector('.modal-body').querySelector(FOCUSABLE) || closeBtn;
    first.focus({ preventScroll: true });
  });
  return api;
}
export const topModal = () => stack.at(-1) || null;

addEventListener('keydown', (e) => {
  const top = stack.at(-1);
  if (!top) return;
  if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); top.close(); return; }
  if (e.key === 'Tab') {
    const f = [...top.el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f.at(-1);
    if (e.shiftKey && (document.activeElement === first || !top.el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/** Ja/Nein-Rückfrage. Bei `danger` liegt der Fokus auf „Abbrechen“. */
export function confirmDialog({ title, message, confirmText = 'OK', cancelText = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (answered) return; answered = true; m.close(); resolve(v); };
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => done(true) }, confirmText);
    const cancel = h('button', { class: 'btn', type: 'button', autofocus: danger, onclick: () => done(false) }, cancelText);
    const m = openModal({
      title, cls: 'small',
      body: h('p', { class: 'confirm-msg' }, message),
      footer: [cancel, ok],
      onClose: () => { if (!answered) { answered = true; resolve(false); } },
    });
    if (!danger) requestAnimationFrame(() => ok.focus());
  });
}

// ------------------------------------------------------------------ Hinweise (Toast)
/** Kurze Meldung unten; optional mit Aktion (z. B. „Rückgängig“). */
export function toast(message, { actionLabel, onAction, timeout = 6000, persistent = false, extra } = {}) {
  const root = $('#toast-root');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', { class: 'toast-msg' }, message), extra || null);
  const dismiss = () => { clearTimeout(t); el.classList.add('out'); setTimeout(() => el.remove(), 180); };
  if (actionLabel) el.append(h('button', { class: 'btn small ghost-inv', type: 'button', onclick: () => { onAction?.(); dismiss(); } }, actionLabel));
  if (persistent) el.append(h('button', { class: 'btn small icon ghost-inv', type: 'button', 'aria-label': 'Schließen', onclick: dismiss }, icon('x', { size: 16 })));
  root.append(el);
  const t = persistent ? 0 : setTimeout(dismiss, timeout);
  return { dismiss, el };
}

// ------------------------------------------------------------------ Formular-Bausteine
export function field(label, control, { hint, id, cls = '' } = {}) {
  const fid = id || 'f-' + uid().slice(0, 6);
  const ctl = control;
  const target = ctl.matches?.('input,select,textarea') ? ctl : ctl.querySelector?.('input,select,textarea');
  if (target && !target.id) target.id = fid;
  return h('div', { class: `field ${cls}` },
    h('label', { for: target?.id || fid }, label), ctl, hint ? h('div', { class: 'hint' }, hint) : null);
}

/** Radio-Chips (echte Radiobuttons → Tastatur und Screenreader funktionieren von selbst). */
export function segmented({ name, options, value, onChange, label }) {
  const nm = name || 'seg-' + uid().slice(0, 5);
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || null });
  for (const o of options) {
    const input = h('input', { type: 'radio', name: nm, value: o.id, checked: o.id === value });
    input.addEventListener('change', () => onChange?.(o.id));
    wrap.append(h('label', { class: 'seg-opt', dataset: { v: o.id } }, input, h('span', null, o.node || o.label)));
  }
  return {
    el: wrap,
    get: () => (wrap.querySelector('input:checked')?.value ?? ''),
    set(v) { wrap.querySelectorAll('input').forEach((i) => { i.checked = i.value === v; }); },
  };
}

export function autosize(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, window.innerHeight * 0.4) + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

// ------------------------------------------------------------------ Combobox (Suche + Neuanlage im selben Feld)
export function combobox({ value = '', getOptions, placeholder = '', ariaLabel, createLabel = (q) => `„${q}“ neu anlegen`, onChange }) {
  const listId = 'cb-' + uid().slice(0, 6);
  const input = h('input', {
    type: 'text', class: 'cb-input', role: 'combobox', autocomplete: 'off', value, placeholder,
    'aria-label': ariaLabel || null, 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list',
  });
  const clearBtn = h('button', { class: 'btn icon ghost cb-clear', type: 'button', tabindex: '-1', 'aria-label': 'Auswahl entfernen', hidden: !value,
    onclick: () => { input.value = ''; clearBtn.hidden = true; close(); onChange?.(''); input.focus(); } }, icon('x', { size: 16 }));
  const list = h('ul', { class: 'cb-list', role: 'listbox', id: listId, hidden: true });
  const el = h('div', { class: 'combo' }, input, clearBtn, list);
  let items = [], active = -1;

  const render = () => {
    const q = norm(input.value.trim());
    const all = getOptions();
    items = all.filter((o) => !q || norm(o.label).includes(q)).map((o) => ({ ...o, kind: 'opt' }));
    const exact = all.some((o) => norm(o.label) === q);
    if (input.value.trim() && !exact) items.push({ kind: 'new', label: input.value.trim().replace(/\s+/g, ' ') });
    list.replaceChildren(...items.map((o, i) => h('li', {
      role: 'option', id: `${listId}-${i}`, class: `cb-opt ${o.kind === 'new' ? 'new' : ''}`, 'aria-selected': 'false',
      onmousedown: (e) => { e.preventDefault(); choose(i); },
    }, o.kind === 'new' ? icon('plus', { size: 16 }) : (o.color ? h('span', { class: 'dot', style: { background: o.color } }) : null),
    h('span', null, o.kind === 'new' ? createLabel(o.label) : o.label))));
    if (!items.length) list.append(h('li', { class: 'cb-empty', role: 'presentation' }, 'Noch keine Kategorien – einfach lostippen.'));
    setActive(items.length ? 0 : -1);
  };
  const place = () => {
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom, above = r.top;
    const up = below < 180 && above > below;
    Object.assign(list.style, {
      left: r.left + 'px', width: r.width + 'px',
      top: up ? 'auto' : r.bottom + 2 + 'px', bottom: up ? window.innerHeight - r.top + 2 + 'px' : 'auto',
      maxHeight: Math.max(120, Math.min(260, (up ? above : below) - 12)) + 'px',
    });
  };
  const open = () => { render(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); place(); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const setActive = (i) => {
    active = i;
    [...list.querySelectorAll('.cb-opt')].forEach((li, n) => { li.setAttribute('aria-selected', n === i ? 'true' : 'false'); li.classList.toggle('active', n === i); });
    if (i >= 0) { input.setAttribute('aria-activedescendant', `${listId}-${i}`); list.querySelectorAll('.cb-opt')[i]?.scrollIntoView({ block: 'nearest' }); }
  };
  const choose = (i) => {
    const o = items[i]; if (!o) return;
    input.value = o.label; clearBtn.hidden = false; close(); onChange?.(o.label);
  };
  input.addEventListener('focus', open);
  input.addEventListener('click', () => { if (list.hidden) open(); });
  input.addEventListener('input', () => { clearBtn.hidden = !input.value; open(); onChange?.(input.value); });
  input.addEventListener('blur', () => setTimeout(close, 0));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); else setActive(Math.min(items.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
  });
  // Liste hängt im Dialog – beim Scrollen/Größe ändern mitwandern
  addEventListener('resize', () => { if (!list.hidden) place(); });
  el.addEventListener('scroll', () => {}, true);
  document.addEventListener('scroll', () => { if (!list.hidden) place(); }, true);
  return { el, input, get: () => input.value.trim().replace(/\s+/g, ' '), set(v) { input.value = v; clearBtn.hidden = !v; } };
}

// ------------------------------------------------------------------ Datum & Uhrzeit (de-DE, 24 h)
/** Textfeld „TT.MM.JJJJ“ + Kalenderauswahl. get(): '' (leer) | 'YYYY-MM-DD' | null (ungültig). */
export function dateField({ value = '', label, onChange }) {
  const input = h('input', { type: 'text', inputmode: 'numeric', class: 'dtf-input', placeholder: 'TT.MM.JJJJ', autocomplete: 'off',
    'aria-label': label, value: dateToField(value) });
  const native = h('input', { type: 'date', class: 'dtf-native', tabindex: '-1', 'aria-hidden': 'true', value });
  const btn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': `${label}: Kalender öffnen`,
    onclick: () => { const cur = parseDateInput(input.value); native.value = cur || ''; try { native.showPicker(); } catch { native.click(); } } }, icon('calendar', { size: 18 }));
  native.addEventListener('change', () => { input.value = dateToField(native.value); validate(); onChange?.(); });
  const el = h('div', { class: 'dtf' }, input, btn, native);
  const validate = () => {
    const v = parseDateInput(input.value);
    input.classList.toggle('invalid', v === null);
    input.setAttribute('aria-invalid', v === null ? 'true' : 'false');
    return v;
  };
  input.addEventListener('input', () => { validate(); onChange?.(); });
  input.addEventListener('blur', () => { const v = validate(); if (v) input.value = dateToField(v); });
  return {
    el, input, get: () => parseDateInput(input.value),
    set(v) { input.value = dateToField(v); validate(); },
  };
}

const TIMES = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

/** Textfeld „HH:MM“ (immer 24 h). Beim Antippen klappt eine Vorschlagsliste (30-Minuten-Raster) auf;
 *  Tippen filtert sie, eigene Werte wie „9:17“ gehen weiterhin. get(): '' | 'HH:mm' | null (ungültig). */
export function timeField({ value = '', label, onChange }) {
  const listId = 'tf-' + uid().slice(0, 6);
  const input = h('input', { type: 'text', inputmode: 'numeric', class: 'dtf-input time', placeholder: 'HH:MM', autocomplete: 'off',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-label': label, value });
  const list = h('ul', { class: 'cb-list tf-list', role: 'listbox', id: listId, hidden: true });
  const el = h('div', { class: 'dtf tf' }, input, list);
  let shown = [], active = -1;

  const validate = () => { const v = parseTimeInput(input.value); input.classList.toggle('invalid', v === null); input.setAttribute('aria-invalid', v === null ? 'true' : 'false'); return v; };
  const keep = (i) => {
    const li = list.children[i]; if (!li) return;
    if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
  };
  const setActive = (i, center) => {
    active = i;
    [...list.children].forEach((li, n) => { li.classList.toggle('active', n === i); li.setAttribute('aria-selected', String(n === i)); });
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${listId}-${i}`);
      if (center) list.scrollTop = Math.max(0, list.children[i].offsetTop - list.clientHeight / 2 + list.children[i].offsetHeight / 2); else keep(i);
    } else input.removeAttribute('aria-activedescendant');
  };
  const place = () => {
    const r = input.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0, bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;   // Tastatur abziehen
    const below = bottom - r.bottom, above = r.top - top;
    const up = below < 170 && above > below;
    Object.assign(list.style, {
      left: r.left + 'px', width: Math.max(r.width, 110) + 'px',
      top: up ? 'auto' : r.bottom + 2 + 'px', bottom: up ? window.innerHeight - r.top + 2 + 'px' : 'auto',
      maxHeight: Math.max(110, Math.min(240, (up ? above : below) - 10)) + 'px',
    });
  };
  const render = () => {
    const raw = input.value.trim();
    const cur = parseTimeInput(raw);
    // Ein vollständig geschriebener Wert (HH:MM) zeigt die ganze Liste (Auswahl springt an die passende Stelle) – sonst wird gefiltert
    const q = cur && /^\d{2}:\d{2}$/.test(raw) ? '' : raw.replace(/\s/g, '');
    shown = q ? TIMES.filter((t) => t.startsWith(q) || t.replace(/^0/, '').startsWith(q) || t.replace(':', '').startsWith(q)) : TIMES;
    list.replaceChildren(...shown.map((t, i) => h('li', { role: 'option', id: `${listId}-${i}`, class: 'cb-opt tf-opt', 'aria-selected': 'false',
      onmousedown: (e) => e.preventDefault(), onclick: () => choose(t) }, t)));
    if (!shown.length) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    place();
    let idx = 0;
    if (!q) {
      const target = cur ? toMin(cur) : 9 * 60;
      idx = shown.reduce((best, t, i) => (Math.abs(toMin(t) - target) < Math.abs(toMin(shown[best]) - target) ? i : best), 0);
    }
    setActive(idx, !q);
  };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const choose = (t) => { input.value = t; validate(); close(); onChange?.(); input.focus({ preventScroll: true }); };

  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('click', () => { if (list.hidden) render(); });
  input.addEventListener('input', () => { validate(); render(); onChange?.(); });
  input.addEventListener('change', () => { const v = validate(); if (v) input.value = v; onChange?.(); });
  input.addEventListener('blur', () => { const v = validate(); if (v) input.value = v; setTimeout(close, 0); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); else setActive(Math.min(shown.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!list.hidden) setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && !list.hidden && active >= 0) {
      // Ist schon eine eigene, gültige Zeit eingetippt (z. B. 9:17), gilt die – sonst der markierte Vorschlag
      if (parseTimeInput(input.value) && !shown.includes(parseTimeInput(input.value))) { close(); return; }
      e.preventDefault(); choose(shown[active]);
    } else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
  });
  addEventListener('resize', () => { if (!list.hidden) place(); });
  window.visualViewport?.addEventListener('resize', () => { if (!list.hidden) place(); });
  document.addEventListener('scroll', () => { if (!list.hidden) place(); }, true);
  return { el, input, get: () => parseTimeInput(input.value), set(v) { input.value = v || ''; validate(); } };
}

/** Kleines Aktionsmenü an einem Anker (⋯-Knopf). items: [{label, icon, onClick, danger}] */
export function openMenu(anchor, items) {
  document.querySelector('.popmenu')?.remove();
  const menu = h('div', { class: 'popmenu', role: 'menu' }, items.map((it) => h('button', {
    class: `popmenu-item ${it.danger ? 'danger' : ''}`, type: 'button', role: 'menuitem',
    onclick: () => { close(); it.onClick(); },
  }, it.icon ? icon(it.icon, { size: 18 }) : null, it.label)));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = clampN(r.right - mw, 8, window.innerWidth - mw - 8) + 'px';
  menu.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); anchor.focus?.({ preventScroll: true }); };
  const away = (e) => { if (!menu.contains(e.target)) { e.stopPropagation(); close(); } };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const b = [...menu.querySelectorAll('button')]; const i = b.indexOf(document.activeElement);
      b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus();
    }
  };
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); }, 0);
  menu.querySelector('button')?.focus();
  return { close };
}
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

/** Prioritäts-/Status-Auswahl o. Ä. als einfaches <select>. */
export function select({ options, value, ariaLabel, onChange, id }) {
  const s = h('select', { class: 'select', 'aria-label': ariaLabel || null, id: id || null },
    options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.label)));
  s.addEventListener('change', () => onChange?.(s.value));
  return s;
}
