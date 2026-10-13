// ToDo-Übersicht: Schnelleingabe, Filter, Sortierung.

import { h, parseLocal, startOfDay, addDays, startOfWeek, dayDiff, titleOf, hasTime, fmtStored, relDay, fmtTime } from './util.js';
import { icon, prioIcon } from './icons.js';
import { select } from './ui.js';
import {
  state, STATUSES, STATUS_LABEL, PRIOS, PRIO_LABEL, PRIO_LEVEL, patchSettings, createItem, toggleDone, getCategory, dueOf, isOverdue,
} from './store.js';
import { hasActiveReminders } from './reminders.js';
import { openItemDialog } from './itemdialog.js';

export const DUE_OPTS = [
  { id: '', label: 'Alle Fälligkeiten' }, { id: 'overdue', label: 'Überfällig' }, { id: 'today', label: 'Heute' },
  { id: 'week', label: 'Diese Woche' }, { id: 'next7', label: 'Nächste 7 Tage' }, { id: 'nodate', label: 'Ohne Datum' },
];

/** Gemeinsame Kennzeichen einer Karte/Zeile (auch vom Board genutzt). */
export function dateChipText(i) {
  if (i.start && i.end) return `${fmtStored(i.start)} – ${fmtStored(i.end)}`;
  if (i.end) return `Fällig ${fmtStored(i.end)}`;
  if (i.start) return `Ab ${fmtStored(i.start)}`;
  return '';
}
export function dueChipText(i) {
  const due = dueOf(i);
  if (!due) return '';
  const d = parseLocal(due);
  const day = relDay(d);
  return hasTime(due) ? `${day} ${fmtTime(d)}` : day;
}

export function matchesFilter(i, f, now = new Date()) {
  if (f.status === 'open' ? i.status === 'done' : f.status && f.status !== 'all' && i.status !== f.status) return false;
  if (f.cat === '_none' ? i.categoryId : f.cat && i.categoryId !== f.cat) return false;
  if (f.prio === 'none' ? i.priority : f.prio && i.priority !== f.prio) return false;
  if (f.due) {
    const due = dueOf(i);
    if (f.due === 'nodate') return !due;
    if (!due) return false;
    const n = dayDiff(now, parseLocal(due));
    if (f.due === 'overdue') return isOverdue(i, now);
    if (f.due === 'today') return n === 0;
    if (f.due === 'next7') return n >= 0 && n <= 7;
    if (f.due === 'week') return dayDiff(startOfWeek(now), parseLocal(due)) >= 0 && dayDiff(startOfWeek(now), parseLocal(due)) <= 6;
  }
  return true;
}

export function sortItems(list, sort, dir) {
  const s = dir === 'desc' ? -1 : 1;
  const dueMs = (i) => { const d = dueOf(i); return d ? parseLocal(d).getTime() : null; };
  return [...list].sort((a, b) => {
    let r = 0;
    if (sort === 'prio') {
      r = (PRIO_LEVEL[b.priority] || 0) - (PRIO_LEVEL[a.priority] || 0);   // „aufsteigend“ = wichtigste zuerst
      if (!r) { const x = dueMs(a), y = dueMs(b); r = x == null ? (y == null ? 0 : 1) : y == null ? -1 : x - y; return r || a.order - b.order; }
      return r * s;
    }
    if (sort === 'created') return (a.createdAt - b.createdAt) * s;
    const x = dueMs(a), y = dueMs(b);                                   // Datum: Einträge ohne Datum immer ans Ende
    if (x == null && y == null) return a.order - b.order;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * s || a.order - b.order;
  });
}

/** Kleine Zeile mit Kennzeichen (Priorität, Kategorie, Termin, Glocke, Status). */
export function itemMeta(i, { showStatus = true, showCat = true } = {}) {
  const cat = getCategory(i.categoryId);
  const od = isOverdue(i);
  const chips = [];
  if (i.priority) chips.push(h('span', { class: `chip prio-chip prio-${i.priority}`, title: `Priorität ${PRIO_LABEL[i.priority]}` }, prioIcon(PRIO_LEVEL[i.priority], { size: 14 }), PRIO_LABEL[i.priority]));
  if (showCat && cat) chips.push(h('span', { class: 'chip cat-chip' }, h('span', { class: 'dot', style: { background: cat.color } }), cat.name));
  const dt = dateChipText(i);
  if (dt) chips.push(h('span', { class: `chip date-chip ${od ? 'overdue' : ''}` }, icon(od ? 'alert' : 'clock', { size: 14 }), od ? 'Überfällig · ' : '', dt));
  if (hasActiveReminders(i, state.settings.defaultTime)) chips.push(h('span', { class: 'chip bell-chip', title: 'Erinnerung aktiv' }, icon('bell', { size: 14 }), h('span', { class: 'sr-only' }, 'Erinnerung aktiv')));
  if (showStatus && i.status !== 'todo') chips.push(h('span', { class: `chip status-chip st-${i.status}` }, STATUS_LABEL[i.status]));
  return h('div', { class: 'meta' }, chips);
}

export const overviewView = {
  title: 'Übersicht',
  mount(host) {
    let list;
    const f = () => state.settings.overview;
    const setF = (patch) => { patchSettings({ overview: { ...f(), ...patch } }); };

    const quick = h('input', { class: 'input quick-input', type: 'text', placeholder: 'Neues ToDo eintippen und Enter drücken …', 'aria-label': 'Neues ToDo' });
    const addNow = () => {
      const t = quick.value.trim();
      if (!t) return;
      const fl = f();
      createItem({
        text: t,
        status: fl.status && !['all', 'open', ''].includes(fl.status) ? fl.status : 'backlog',
        categoryId: fl.cat && fl.cat !== '_none' ? fl.cat : null,
        priority: fl.prio && !['none', ''].includes(fl.prio) ? fl.prio : null,
      });
      quick.value = '';
      quick.focus();
    };
    quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNow(); } });
    const quickForm = h('div', { class: 'quick-add' }, quick, h('button', { class: 'btn primary', type: 'button', onclick: addNow }, icon('plus', { size: 18 }), h('span', { class: 'hide-sm' }, ' Hinzufügen')));

    const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter und Sortierung' });
    const count = h('div', { class: 'count', 'aria-live': 'polite' });
    const listWrap = h('div', { class: 'todo-wrap' });
    host.append(h('div', { class: 'view overview' }, quickForm, filters, count, listWrap));

    function renderFilters() {
      const fl = f();
      const catOpts = [{ id: '', label: 'Alle Kategorien' }, { id: '_none', label: 'Ohne Kategorie' }, ...state.categories.map((c) => ({ id: c.id, label: c.name }))];
      const dirBtn = h('button', { class: 'btn icon', type: 'button', title: fl.dir === 'desc' ? 'Absteigend' : 'Aufsteigend',
        'aria-label': `Sortierrichtung: ${fl.dir === 'desc' ? 'absteigend' : 'aufsteigend'} – umschalten`, onclick: () => setF({ dir: fl.dir === 'desc' ? 'asc' : 'desc' }) }, icon(fl.dir === 'desc' ? 'down' : 'up', { size: 18 }));
      const isDefault = !fl.cat && !fl.prio && fl.status === 'open' && !fl.due;
      const act = filters.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
      queueMicrotask(() => { if (act) filters.querySelector(`[aria-label="${act}"]`)?.focus(); });
      filters.replaceChildren(
        select({ options: catOpts, value: fl.cat, ariaLabel: 'Kategorie filtern', onChange: (v) => setF({ cat: v }) }),
        select({ options: [{ id: 'open', label: 'Offene' }, { id: 'all', label: 'Alle Status' }, ...STATUSES], value: fl.status, ariaLabel: 'Status filtern', onChange: (v) => setF({ status: v }) }),
        select({ options: [{ id: '', label: 'Alle Prioritäten' }, ...PRIOS, { id: 'none', label: 'Ohne Priorität' }], value: fl.prio, ariaLabel: 'Priorität filtern', onChange: (v) => setF({ prio: v }) }),
        select({ options: DUE_OPTS, value: fl.due, ariaLabel: 'Fälligkeit filtern', onChange: (v) => setF({ due: v }) }),
        h('span', { class: 'sort-group' },
          select({ options: [{ id: 'end', label: 'Sortiert nach Fälligkeit' }, { id: 'prio', label: 'Sortiert nach Priorität' }, { id: 'created', label: 'Sortiert nach Erstellung' }], value: fl.sort, ariaLabel: 'Sortierung', onChange: (v) => setF({ sort: v }) }),
          dirBtn),
        isDefault ? null : h('button', { class: 'btn small ghost', type: 'button', onclick: () => setF({ cat: '', prio: '', status: 'open', due: '' }) }, 'Zurücksetzen'));
    }

    function row(i) {
      const done = i.status === 'done';
      const check = h('button', { class: `check-btn ${done ? 'on' : ''}`, type: 'button', 'aria-pressed': String(done),
        'aria-label': done ? `„${titleOf(i.text)}“ wieder öffnen` : `„${titleOf(i.text)}“ als erledigt markieren`, onclick: () => toggleDone(i.id) }, icon('check', { size: 16 }));
      const cat = getCategory(i.categoryId);
      return h('li', { class: `todo-row ${done ? 'done' : ''} ${i.priority ? 'p-' + i.priority : ''}`, style: cat ? { '--cat': cat.color } : null },
        check,
        h('button', { class: 'row-main', type: 'button', onclick: () => openItemDialog({ id: i.id }) },
          h('span', { class: 'title' }, titleOf(i.text)), itemMeta(i)));
    }

    function render() {
      renderFilters();
      const fl = f();
      const all = state.items.filter((i) => matchesFilter(i, fl));
      const items = sortItems(all, fl.sort, fl.dir);
      count.textContent = items.length === 1 ? '1 Element' : `${items.length} Elemente`;
      if (!items.length) {
        listWrap.replaceChildren(h('div', { class: 'empty' }, icon('inbox', { size: 40 }),
          h('h3', null, state.items.length ? 'Nichts gefunden' : 'Noch keine ToDos'),
          h('p', null, state.items.length ? 'Passe die Filter an oder lege oben ein neues ToDo an.' : 'Tippe oben etwas ein und drücke Enter – alles Weitere kannst du später ergänzen.')));
        return;
      }
      listWrap.replaceChildren(h('ul', { class: 'todo-list' }, items.map(row)));
    }
    render();
    return {
      update(kinds) { if (kinds.has('items') || kinds.has('categories') || kinds.has('settings')) { const sy = document.querySelector('#view')?.scrollTop; render(); if (sy != null) document.querySelector('#view').scrollTop = sy; } },
      newItem() { openItemDialog(); },
    };
  },
};
