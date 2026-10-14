// Zentraler Zustand. Alle Ansichten lesen von hier und schreiben nur über diese Funktionen –
// dadurch ist jede Änderung sofort in Kalender, Board, Übersicht und Suche sichtbar.
// Persistiert wird über die Repository-Schicht (db.js), gebündelt in einer kleinen Schreib-Warteschlange.

import { openRepo } from './db.js';
import { uid, parseLocal, startOfDay, hasTime, titleOf, debounce } from './util.js';

export const STATUSES = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Zu erledigen' },
  { id: 'doing', label: 'In Arbeit' },
  { id: 'done', label: 'Erledigt' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
export const PRIOS = [
  { id: 'low', label: 'Niedrig', level: 1 },
  { id: 'med', label: 'Mittel', level: 2 },
  { id: 'high', label: 'Hoch', level: 3 },
];
export const PRIO_LABEL = Object.fromEntries(PRIOS.map((p) => [p.id, p.label]));
export const PRIO_LEVEL = Object.fromEntries(PRIOS.map((p) => [p.id, p.level]));

export const CAT_COLORS = ['#2e7d32', '#1565c0', '#c62828', '#ef6c00', '#6a1b9a', '#00838f', '#ad1457', '#5d4037', '#546e7a', '#9e9d24'];
export const TILE_COLORS = [
  { id: '', label: 'Keine' }, { id: '1', label: 'Gelb' }, { id: '2', label: 'Grün' }, { id: '3', label: 'Blau' },
  { id: '4', label: 'Rosa' }, { id: '5', label: 'Lila' }, { id: '6', label: 'Orange' }, { id: '7', label: 'Türkis' },
];

export const THEMES = [
  { id: 'hell', name: 'Hell', group: 'Schlicht' },
  { id: 'dunkel', name: 'Dunkel', group: 'Schlicht' },
  { id: 'beige', name: 'Beige', group: 'Schlicht' },
  { id: 'pastell', name: 'Pastellblau', group: 'Schlicht' },
  { id: 'cyberpunk', name: 'Cyberpunk', group: 'Stylisch' },
  { id: 'bauhaus', name: 'Bauhaus', group: 'Stylisch' },
];

export const DEFAULT_SETTINGS = {
  theme: 'hell',
  followSystem: false,
  sidebarCollapsed: false,
  defaultTime: '09:00',      // Uhrzeit für Erinnerungen an ganztägige Termine
  defaultSound: true,        // neue Erinnerungen mit Klingelton
  weekNumbers: true,
  showDone: true,            // Erledigtes im Kalender zeigen (ausgegraut)
  calView: 'month',
  calSidebar: true,
  calZoom: 1,               // Zoom des Zeitrasters (Tag/Woche)
  boardZoom: 1,             // Zoom des Boards
  overview: { cat: '', prio: '', status: 'open', due: '', sort: 'end', dir: 'asc' },
  collapsedLanes: {},
  lastList: '',
};

export const state = {
  ready: false,
  persistent: true,
  items: [],
  categories: [],
  lists: [],
  entries: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  snoozes: [],   // [{ key, itemId, at (ms), sound }]
  fired: {},     // { key: ms } – ausgelöste Erinnerungen (Web, verhindert Doppelungen)
};

let repo = null;

// ------------------------------------------------------------------ Änderungs-Meldung
const listeners = new Set();
let pendingKinds = new Set();
let emitQueued = false;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(...kinds) {
  kinds.forEach((k) => pendingKinds.add(k));
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    const k = pendingKinds; pendingKinds = new Set();
    listeners.forEach((fn) => { try { fn(k); } catch (e) { console.error(e); } });
  });
}

// ------------------------------------------------------------------ Schreib-Warteschlange
const queue = new Map(); // "store:id" -> { op, store, id, obj }
let flushing = Promise.resolve();
function put(store, obj) { queue.set(`${store}:${obj.id ?? obj.key}`, { op: 'put', store, obj }); scheduleFlush(); }
function del(store, id) { queue.set(`${store}:${id}`, { op: 'del', store, id }); scheduleFlush(); }
const scheduleFlush = debounce(() => flush(), 120);
export function flush() {
  scheduleFlush.cancel();
  const ops = [...queue.values()];
  queue.clear();
  if (!ops.length || !repo) return flushing;
  flushing = flushing.then(async () => {
    const byStore = {};
    for (const o of ops) (byStore[o.store] ||= { put: [], del: [] })[o.op].push(o.op === 'put' ? o.obj : o.id);
    for (const [s, g] of Object.entries(byStore)) {
      try {
        await repo.putMany(s, g.put);
        await repo.deleteMany(s, g.del);
      } catch (e) { console.error('Speichern fehlgeschlagen', e); }
    }
  });
  return flushing;
}
addEventListener('pagehide', () => flush());
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// ------------------------------------------------------------------ Start
export async function init() {
  repo = await openRepo();
  state.persistent = repo.persistent;
  await load();
  if (!state.persistent) { /* App zeigt Hinweis */ }
  await seedIfNeeded();
  state.ready = true;
}
async function load() {
  const [items, categories, lists, entries, meta] = await Promise.all(
    ['items', 'categories', 'lists', 'entries', 'meta'].map((s) => repo.all(s)));
  state.items = items;
  state.categories = categories.sort((a, b) => a.order - b.order);
  state.lists = lists.sort((a, b) => a.order - b.order);
  state.entries = entries;
  const m = Object.fromEntries(meta.map((x) => [x.key, x.value]));
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(m.settings || {}) };
  state.settings.overview = { ...DEFAULT_SETTINGS.overview, ...(state.settings.overview || {}) };
  state.snoozes = m.snoozes || [];
  state.fired = m.fired || {};
  state._seeded = !!m.seeded;
}
async function seedIfNeeded() {
  if (state._seeded) return;
  const now = Date.now();
  const einkauf = {
    id: uid(), name: 'Einkaufsliste', type: 'table', order: 1,
    columns: [{ id: 'c1', name: 'Artikel' }, { id: 'c2', name: 'Menge' }, { id: 'c3', name: 'Notiz' }],
  };
  const ideen = { id: uid(), name: 'Ideenliste', type: 'tiles', order: 2, columns: [] };
  state.lists.push(einkauf, ideen);
  put('lists', einkauf); put('lists', ideen);
  const willkommen = normalizeItem({
    id: uid(), status: 'backlog', createdAt: now, updatedAt: now,
    text: 'Willkommen bei Oregano 🌿\nTipp: Ziehe diese Karte im Board auf „Erledigt“ – oder lösche sie einfach.',
    priority: 'low',
  });
  state.items.push(willkommen);
  put('items', willkommen);
  put('meta', { key: 'seeded', value: true });
  state._seeded = true;
  await flush();
}

// ------------------------------------------------------------------ Einstellungen & Hilfsdaten
export function patchSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  put('meta', { key: 'settings', value: state.settings });
  emit('settings');
}
export function setSnoozes(list) { state.snoozes = list; put('meta', { key: 'snoozes', value: list }); }
export function setFired(map) { state.fired = map; put('meta', { key: 'fired', value: map }); }

// ------------------------------------------------------------------ Elemente
let lastOrder = 0;
const nextOrder = () => (lastOrder = Math.max(Date.now(), lastOrder + 1));

function normalizeItem(i) {
  const n = {
    id: i.id || uid(),
    text: String(i.text ?? ''),
    start: i.start || null,
    end: i.end || null,
    reminders: (i.reminders || []).slice(0, 2).map((r) => ({
      id: r.id || uid(), kind: r.kind || 'abs', at: r.at || '', offset: r.offset ?? 15, sound: !!r.sound,
    })),
    priority: ['low', 'med', 'high'].includes(i.priority) ? i.priority : null,
    categoryId: i.categoryId || null,
    status: STATUS_LABEL[i.status] ? i.status : 'backlog',
    createdAt: i.createdAt || Date.now(),
    updatedAt: i.updatedAt || Date.now(),
    doneAt: i.status === 'done' ? (i.doneAt || Date.now()) : null,
    order: i.order ?? nextOrder(),
  };
  if (n.start && n.end && parseLocal(n.end) < parseLocal(n.start)) n.end = n.start;
  return n;
}
export const getItem = (id) => state.items.find((i) => i.id === id) || null;

export function createItem(data = {}) {
  const now = Date.now();
  const item = normalizeItem({ ...data, id: undefined, createdAt: now, updatedAt: now, order: data.order ?? nextOrder() });
  state.items.push(item);
  put('items', item);
  emit('items');
  return item;
}
export function updateItem(id, patch) {
  const i = getItem(id);
  if (!i) return null;
  const wasDone = i.status === 'done';
  const merged = normalizeItem({ ...i, ...patch, id: i.id, createdAt: i.createdAt, updatedAt: Date.now(),
    doneAt: patch.status && patch.status !== 'done' ? null : (patch.status === 'done' && !wasDone ? Date.now() : i.doneAt) });
  Object.assign(i, merged);
  put('items', i);
  emit('items');
  return i;
}
export function deleteItem(id) {
  const i = getItem(id);
  if (!i) return null;
  state.items = state.items.filter((x) => x.id !== id);
  state.snoozes = state.snoozes.filter((s) => s.itemId !== id);
  del('items', id);
  emit('items');
  return i;
}
export function restoreItem(item) {
  if (getItem(item.id)) return;
  state.items.push(item);
  put('items', item);
  emit('items');
}
export function toggleDone(id) {
  const i = getItem(id);
  if (!i) return;
  updateItem(id, { status: i.status === 'done' ? 'todo' : 'done' });
}
/** Board: Status/Kategorie ändern und an eine Stelle sortieren (beforeId = vor dieser Karte, sonst ans Ende). */
export function moveItem(id, { status, categoryId, beforeId, siblings }) {
  const i = getItem(id);
  if (!i) return;
  let order = i.order;
  if (siblings) {
    const list = siblings.filter((s) => s.id !== id).sort((a, b) => a.order - b.order);
    const idx = beforeId ? list.findIndex((s) => s.id === beforeId) : list.length;
    const prev = idx > 0 ? list[idx - 1].order : null;
    const next = idx >= 0 && idx < list.length ? list[idx].order : null;
    if (prev == null && next == null) order = nextOrder();
    else if (prev == null) order = next - 1000;
    else if (next == null) order = prev + 1000;
    else order = (prev + next) / 2;
  }
  const patch = { order };
  if (status !== undefined) patch.status = status;
  if (categoryId !== undefined) patch.categoryId = categoryId;
  updateItem(id, patch);
}

// ------------------------------------------------------------------ Kategorien
export const getCategory = (id) => state.categories.find((c) => c.id === id) || null;
export function findCategoryByName(name) {
  const n = name.trim().toLocaleLowerCase('de-DE');
  return state.categories.find((c) => c.name.toLocaleLowerCase('de-DE') === n) || null;
}
/** „Beim ersten Verwenden automatisch speichern“: legt die Kategorie an, falls es sie noch nicht gibt. */
export function ensureCategory(name) {
  name = (name || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const hit = findCategoryByName(name);
  if (hit) return hit.id;
  const cat = {
    id: uid(), name,
    color: CAT_COLORS[state.categories.length % CAT_COLORS.length],
    order: (state.categories.at(-1)?.order ?? 0) + 1,
  };
  state.categories.push(cat);
  put('categories', cat);
  emit('categories');
  return cat.id;
}
export function updateCategory(id, patch) {
  const c = getCategory(id);
  if (!c) return;
  if (patch.name !== undefined) {
    const nm = patch.name.trim();
    const dup = findCategoryByName(nm);
    if (!nm || (dup && dup.id !== id)) return false;
    c.name = nm;
  }
  if (patch.color) c.color = patch.color;
  put('categories', c);
  emit('categories');
  return true;
}
export function deleteCategory(id) {
  state.categories = state.categories.filter((c) => c.id !== id);
  del('categories', id);
  for (const i of state.items) if (i.categoryId === id) { i.categoryId = null; i.updatedAt = Date.now(); put('items', i); }
  const cl = { ...state.settings.collapsedLanes }; delete cl[id];
  patchSettings({ collapsedLanes: cl });
  emit('categories', 'items');
}
export function moveCategory(id, dir) {
  const arr = state.categories;
  const idx = arr.findIndex((c) => c.id === id);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= arr.length) return;
  [arr[idx], arr[to]] = [arr[to], arr[idx]];
  arr.forEach((c, n) => { if (c.order !== n + 1) { c.order = n + 1; put('categories', c); } });
  emit('categories');
}

// ------------------------------------------------------------------ Listen
export const getList = (id) => state.lists.find((l) => l.id === id) || null;
export function createList({ name, type, columns }) {
  const l = {
    id: uid(), name: name.trim() || 'Neue Liste', type, order: (state.lists.at(-1)?.order ?? 0) + 1,
    columns: type === 'table' ? mkColumns(columns) : [],
  };
  state.lists.push(l); put('lists', l); emit('lists');
  return l;
}
const mkColumns = (names, existing = []) => {
  const list = (names?.length ? names : ['Eintrag']).map((n) => String(n).trim()).filter(Boolean);
  return (list.length ? list : ['Eintrag']).map((name, i) => ({ id: existing[i]?.id || 'c' + uid().slice(0, 6), name }));
};
export function updateList(id, patch) {
  const l = getList(id);
  if (!l) return;
  if (patch.name !== undefined) l.name = patch.name.trim() || l.name;
  if (patch.columns && l.type === 'table') {
    const cols = mkColumns(patch.columns, l.columns);
    const keep = new Set(cols.map((c) => c.id));
    l.columns = cols;
    for (const e of state.entries) {
      if (e.listId !== id) continue;
      for (const k of Object.keys(e.cells || {})) if (!keep.has(k)) delete e.cells[k];
      put('entries', e);
    }
  }
  put('lists', l); emit('lists', 'entries');
}
export function deleteList(id) {
  state.lists = state.lists.filter((l) => l.id !== id);
  del('lists', id);
  for (const e of state.entries.filter((x) => x.listId === id)) del('entries', e.id);
  state.entries = state.entries.filter((e) => e.listId !== id);
  emit('lists', 'entries');
}
export function moveList(id, dir) {
  const arr = state.lists;
  const idx = arr.findIndex((l) => l.id === id);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= arr.length) return;
  [arr[idx], arr[to]] = [arr[to], arr[idx]];
  arr.forEach((l, n) => { if (l.order !== n + 1) { l.order = n + 1; put('lists', l); } });
  emit('lists');
}

// ------------------------------------------------------------------ Listeneinträge
export const entriesOf = (listId) => state.entries.filter((e) => e.listId === listId);
export const getEntry = (id) => state.entries.find((e) => e.id === id) || null;
export function createEntry(listId, data = {}, { quiet = false } = {}) {
  const e = {
    id: uid(), listId, order: data.order ?? nextOrder(), done: false, doneAt: null,
    cells: data.cells || {}, title: data.title || '', text: data.text || '', color: data.color || '',
    createdAt: Date.now(),
  };
  state.entries.push(e); put('entries', e);
  if (!quiet) emit('entries');
  return e;
}
export function updateEntry(id, patch, { quiet = false } = {}) {
  const e = getEntry(id);
  if (!e) return;
  if (patch.done !== undefined && patch.done !== e.done) e.doneAt = patch.done ? Date.now() : null;
  const { cells, ...rest } = patch;
  Object.assign(e, rest);
  if (cells) e.cells = { ...e.cells, ...cells };
  put('entries', e);
  if (!quiet) emit('entries');
}
export function deleteEntries(ids) {
  const set = new Set(ids);
  const removed = state.entries.filter((e) => set.has(e.id));
  state.entries = state.entries.filter((e) => !set.has(e.id));
  for (const e of removed) del('entries', e.id);
  emit('entries');
  return removed;
}
export function restoreEntries(list) {
  for (const e of list) { if (!getEntry(e.id)) { state.entries.push(e); put('entries', e); } }
  emit('entries');
}
/** Kachel an andere Position (vor `beforeId`, sonst ans Ende). */
export function reorderEntry(id, beforeId, listId) {
  const siblings = entriesOf(listId).filter((e) => e.id !== id).sort((a, b) => a.order - b.order);
  const idx = beforeId ? siblings.findIndex((s) => s.id === beforeId) : siblings.length;
  const prev = idx > 0 ? siblings[idx - 1].order : null;
  const next = idx < siblings.length ? siblings[idx].order : null;
  const order = prev == null && next == null ? nextOrder() : prev == null ? next - 1000 : next == null ? prev + 1000 : (prev + next) / 2;
  updateEntry(id, { order });
}

// ------------------------------------------------------------------ Abgeleitetes
export const dueOf = (i) => i.end || i.start || null;
export function isOverdue(i, now = new Date()) {
  if (i.status === 'done') return false;
  const due = dueOf(i);
  if (!due) return false;
  const d = parseLocal(due);
  return hasTime(due) ? d < now : startOfDay(d) < startOfDay(now);
}

// ------------------------------------------------------------------ Backup
export function exportData() {
  return {
    app: 'oregano', schema: 1, exportedAt: new Date().toISOString(),
    data: {
      items: state.items, categories: state.categories, lists: state.lists, entries: state.entries,
      settings: state.settings,
    },
  };
}
export function validateBackup(obj) {
  if (!obj || obj.app !== 'oregano' || !obj.data) return 'Das ist keine Oregano-Sicherung.';
  const d = obj.data;
  for (const k of ['items', 'categories', 'lists', 'entries']) {
    if (!Array.isArray(d[k])) return `In der Datei fehlt der Bereich „${k}“.`;
  }
  return null;
}
export function backupSummary(obj) {
  const d = obj.data;
  return `${d.items.length} Elemente, ${d.categories.length} Kategorien, ${d.lists.length} Listen, ${d.entries.length} Listeneinträge`;
}
export async function importData(obj) {
  const err = validateBackup(obj);
  if (err) throw new Error(err);
  const d = obj.data;
  await flush();
  await repo.clear();
  queue.clear();
  const items = d.items.map(normalizeItem);
  await repo.putMany('items', items);
  await repo.putMany('categories', d.categories.filter((c) => c && c.id));
  await repo.putMany('lists', d.lists.filter((l) => l && l.id));
  await repo.putMany('entries', d.entries.filter((e) => e && e.id));
  await repo.put('meta', { key: 'settings', value: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } });
  await repo.put('meta', { key: 'seeded', value: true });
  await load();
  emit('items', 'categories', 'lists', 'entries', 'settings');
}
export async function resetAll() {
  await flush();
  await repo.clear();
  queue.clear();
  await load();
  state.items = []; state.categories = []; state.lists = []; state.entries = [];
  state._seeded = false;
  await seedIfNeeded();
  emit('items', 'categories', 'lists', 'entries', 'settings');
}
export { titleOf };
