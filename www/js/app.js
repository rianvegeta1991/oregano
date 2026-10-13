// Start, Layout (Seitenleiste / Bottom-Navigation), Router, Theme.

import { h, $, clear } from './util.js';
import { icon, logoSvg } from './icons.js';
import { toast } from './ui.js';
import { init, state, subscribe, patchSettings } from './store.js';
import { startNotifications } from './notify.js';
import { openItemDialog } from './itemdialog.js';
import { openSearch } from './search.js';
import { overviewView } from './overview.js';
import { calendarView } from './calendar.js';
import { boardView } from './board.js';
import { listsView } from './lists.js';
import { settingsView } from './settings.js';
import { topModal } from './ui.js';

const ROUTES = {
  uebersicht: { view: overviewView, icon: 'list', label: 'Übersicht' },
  kalender: { view: calendarView, icon: 'calendar', label: 'Kalender' },
  board: { view: boardView, icon: 'board', label: 'Board' },
  listen: { view: listsView, icon: 'lists', label: 'Listen' },
  einstellungen: { view: settingsView, icon: 'settings', label: 'Einstellungen' },
};
const ORDER = ['uebersicht', 'kalender', 'board', 'listen', 'einstellungen'];

const app = {
  route: null,
  nav(path) { location.hash = '#/' + path; },
};
let current = null;      // { key, inst }

// ------------------------------------------------------------------ Theme
function systemDark() { return matchMedia('(prefers-color-scheme: dark)').matches; }
function applyTheme() {
  const s = state.settings;
  const id = s.followSystem ? (systemDark() ? 'dunkel' : 'hell') : s.theme;
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('oregano-theme', JSON.stringify({ id, follow: s.followSystem, theme: s.theme })); } catch { /* privat */ }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  $('meta[name=theme-color]')?.setAttribute('content', bg || '#2e7d32');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.followSystem) applyTheme(); });

// ------------------------------------------------------------------ Layout
const sidebar = $('#sidebar'), topbar = $('#topbar'), bottomnav = $('#bottomnav'), view = $('#view'), fab = $('#fab');

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const [key, ...rest] = pathPart.split('/');
  const q = Object.fromEntries(new URLSearchParams(query));
  return { key: ROUTES[key] ? key : 'uebersicht', id: rest[0] || '', q };
}

function renderSidebar() {
  const collapsed = state.settings.sidebarCollapsed;
  document.body.classList.toggle('sb-collapsed', collapsed);
  const r = app.route;
  clear(sidebar);
  sidebar.append(
    h('div', { class: 'sb-top' },
      h('a', { class: 'brand', href: '#/uebersicht', 'aria-label': 'Oregano – zur Übersicht' }, logoSvg(34), h('span', { class: 'brand-name' }, 'Oregano')),
      h('button', { class: 'btn icon ghost sb-toggle', type: 'button', 'aria-label': collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen', 'aria-expanded': String(!collapsed),
        onclick: () => patchSettings({ sidebarCollapsed: !collapsed }) }, icon('sidebar'))),
    h('nav', { 'aria-label': 'Hauptnavigation' }, h('ul', { class: 'sb-nav' }, ORDER.map((k) => {
      const t = ROUTES[k];
      return h('li', null,
        h('a', { class: `sb-link ${r?.key === k ? 'active' : ''}`, href: `#/${k}`, title: t.label, 'aria-current': r?.key === k ? 'page' : null }, icon(t.icon), h('span', { class: 'sb-label' }, t.label)),
        k === 'listen' && state.lists.length ? h('ul', { class: 'sb-sub' }, state.lists.map((l) => h('li', null,
          h('a', { class: `sb-link sub ${r?.key === 'listen' && (r.id === l.id || (!r.id && state.settings.lastList === l.id)) ? 'active' : ''}`, href: `#/listen/${l.id}`, title: l.name },
            icon(l.type === 'table' ? 'lists' : 'bulb', { size: 16 }), h('span', { class: 'sb-label' }, l.name))))) : null);
    }))));
}
function renderBottomNav() {
  clear(bottomnav);
  bottomnav.append(h('ul', null, ORDER.map((k) => {
    const t = ROUTES[k];
    return h('li', null, h('a', { class: `bn-link ${app.route?.key === k ? 'active' : ''}`, href: `#/${k}`, 'aria-current': app.route?.key === k ? 'page' : null }, icon(t.icon, { size: 22 }), h('span', null, t.label)));
  })));
}
function renderTopbar() {
  const t = ROUTES[app.route.key];
  clear(topbar);
  topbar.append(
    h('a', { class: 'tb-brand', href: '#/uebersicht', 'aria-label': 'Oregano' }, logoSvg(28)),
    h('h1', { class: 'tb-title' }, t.label),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn search-btn', type: 'button', 'aria-label': 'Suchen', onclick: () => openSearch(app) }, icon('search'), h('span', { class: 'sb-hint' }, 'Suchen …'), h('kbd', null, '/')),
    h('button', { class: 'btn primary new-btn', type: 'button', onclick: () => newItem() }, icon('plus', { size: 18 }), ' Neu'));
  fab.hidden = app.route.key === 'einstellungen';
  fab.setAttribute('aria-label', app.route.key === 'listen' ? 'Neuer Listeneintrag' : 'Neues Element');
  $('.new-btn', topbar).hidden = app.route.key === 'einstellungen';
}

// ------------------------------------------------------------------ Router
function route() {
  const r = parseHash();
  app.route = r;
  const t = ROUTES[r.key];
  const same = current && current.key === r.key && (r.key !== 'listen' || current.id === r.id);
  if (!same) {
    current?.inst?.destroy?.();
    clear(view);
    view.scrollTop = 0;
    current = { key: r.key, id: r.id, inst: t.view.mount(view, { id: r.id, ...r.q }, app) };
    view.focus({ preventScroll: true });
  }
  document.title = `${t.label} – Oregano`;
  renderTopbar(); renderBottomNav(); renderSidebar();
}
addEventListener('hashchange', route);

function newItem() {
  if (current?.inst?.newItem) current.inst.newItem();
  else openItemDialog();
}
fab.addEventListener('click', newItem);

// ------------------------------------------------------------------ Tastenkürzel
addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!topModal()) openSearch(app); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || topModal()) return;
  if (e.key === '/') { e.preventDefault(); openSearch(app); }
  else if (e.key === 'n') { e.preventDefault(); newItem(); }
});

// ------------------------------------------------------------------ Start
async function main() {
  const t0 = performance.now();
  await init();
  applyTheme();
  document.body.classList.add('ready');
  route();
  subscribe((kinds) => {
    if (kinds.has('settings')) { applyTheme(); renderSidebar(); }
    if (kinds.has('lists')) renderSidebar();
    current?.inst?.update?.(kinds);
  });
  startNotifications().catch((e) => console.warn('Benachrichtigungen:', e));
  if (!state.persistent) toast('Dieser Browser speichert nicht dauerhaft. Sichere deine Daten unter Einstellungen → Sicherung.', { persistent: true });
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.() && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker:', e));
  }
  const splash = $('#splash');
  if (splash) {
    const wait = Math.max(0, 450 - (performance.now() - t0));
    setTimeout(() => { splash.classList.add('out'); setTimeout(() => splash.remove(), 400); }, wait);
  }
}
main().catch((e) => {
  console.error(e);
  document.body.append(h('div', { class: 'fatal', role: 'alert' }, h('h1', null, 'Oregano konnte nicht starten'), h('p', null, String(e?.message || e))));
  $('#splash')?.remove();
});
window.oregano = { state, app };
