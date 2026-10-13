// Kanban-Board: Spalten = Status, Swimlanes = Kategorien (+ „Ohne Kategorie“).
// Karte ziehen: zwischen Spalten ändert den Status, zwischen Swimlanes die Kategorie.
// Tastatur: Karte fokussieren, Alt + Pfeile verschiebt (←/→ Status, ↑/↓ Swimlane).

import { h, titleOf } from './util.js';
import { icon, prioIcon } from './icons.js';
import { makeDraggable } from './dnd.js';
import {
  state, STATUSES, PRIO_LABEL, PRIO_LEVEL, patchSettings, moveItem, moveCategory, getCategory,
} from './store.js';
import { openItemDialog } from './itemdialog.js';
import { dueChipText } from './overview.js';
import { isOverdue } from './store.js';
import { hasActiveReminders } from './reminders.js';

const NONE = '_none';

export const boardView = {
  title: 'Board',
  mount(host) {
    let focusAfter = null;
    const root = h('div', { class: 'view board' });
    host.append(root);
    const scrollerEl = () => host.closest('#view') || host;

    const lanes = () => [
      ...state.categories.map((c) => ({ id: c.id, name: c.name, color: c.color, cat: c })),
      { id: NONE, name: 'Ohne Kategorie', color: null, cat: null },
    ];
    const itemsIn = (laneId, status) => state.items
      .filter((i) => (i.categoryId || NONE) === laneId && i.status === status)
      .sort((a, b) => a.order - b.order);

    function card(i) {
      const od = isOverdue(i);
      const due = dueChipText(i);
      const el = h('div', { class: `card ${i.status === 'done' ? 'done' : ''} ${i.priority ? 'p-' + i.priority : ''}`, tabindex: '0', role: 'button',
        dataset: { id: i.id }, 'aria-label': `${titleOf(i.text)}${i.priority ? ', Priorität ' + PRIO_LABEL[i.priority] : ''}${due ? ', ' + due : ''}. Enter zum Bearbeiten, Alt plus Pfeiltasten zum Verschieben.` },
        h('div', { class: 'card-title' }, titleOf(i.text)),
        h('div', { class: 'card-meta' },
          i.priority ? h('span', { class: `chip prio-chip prio-${i.priority}`, title: `Priorität ${PRIO_LABEL[i.priority]}` }, prioIcon(PRIO_LEVEL[i.priority], { size: 14 }), h('span', { class: 'hide-xs' }, PRIO_LABEL[i.priority])) : null,
          due ? h('span', { class: `chip date-chip ${od ? 'overdue' : ''}` }, icon(od ? 'alert' : 'clock', { size: 13 }), due) : null,
          hasActiveReminders(i, state.settings.defaultTime) ? h('span', { class: 'chip bell-chip', title: 'Erinnerung aktiv' }, icon('bell', { size: 13 }), h('span', { class: 'sr-only' }, 'Erinnerung aktiv')) : null));
      el.addEventListener('click', () => openItemDialog({ id: i.id }));
      el.addEventListener('keydown', (e) => {
        if (e.target !== el) return;
        if (e.altKey && e.key.startsWith('Arrow')) {
          e.preventDefault();
          const si = STATUSES.findIndex((s) => s.id === i.status);
          const L = lanes(); const li = L.findIndex((l) => l.id === (i.categoryId || NONE));
          if (e.key === 'ArrowLeft' && si > 0) moveItem(i.id, { status: STATUSES[si - 1].id });
          else if (e.key === 'ArrowRight' && si < STATUSES.length - 1) moveItem(i.id, { status: STATUSES[si + 1].id });
          else if (e.key === 'ArrowUp' && li > 0) moveItem(i.id, { categoryId: L[li - 1].cat ? L[li - 1].id : null });
          else if (e.key === 'ArrowDown' && li < L.length - 1) moveItem(i.id, { categoryId: L[li + 1].cat ? L[li + 1].id : null });
          else return;
          focusAfter = i.id;
        } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItemDialog({ id: i.id }); }
      });
      attachDnD(el, i);
      return el;
    }

    // --- Ziehen & Ablegen
    let indicator = null, current = null;
    const clearIndicator = () => { indicator?.remove(); indicator = null; root.querySelectorAll('.cell.drop-over').forEach((c) => c.classList.remove('drop-over')); current = null; };
    function targetAt(x, y, dragEl) {
      const el = document.elementFromPoint(x, y);
      const cell = el?.closest?.('.cell');
      if (!cell || !root.contains(cell)) return null;
      const box = cell.querySelector('.cell-cards');
      let before = null;
      for (const c of box.querySelectorAll('.card')) {
        if (c === dragEl) continue;
        const r = c.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = c; break; }
      }
      return { cell, box, before };
    }
    function attachDnD(el, item) {
      makeDraggable(el, {
        scrollers: () => [scrollerEl(), root.querySelector('.board-scroll'), ...root.querySelectorAll('.lane-cells')].filter(Boolean),
        onStart() { el.classList.add('drag-src'); },
        onMove(ctx) {
          const t = targetAt(ctx.x, ctx.y, el);
          root.querySelectorAll('.cell.drop-over').forEach((c) => { if (!t || c !== t.cell) c.classList.remove('drop-over'); });
          current = t;
          if (!t) { indicator?.remove(); return; }
          t.cell.classList.add('drop-over');
          indicator ||= h('div', { class: 'drop-ind' });
          if (t.before) t.box.insertBefore(indicator, t.before); else t.box.append(indicator);
        },
        onEnd(ctx, cancelled) {
          el.classList.remove('drag-src');
          const t = current;
          clearIndicator();
          if (cancelled || !t) return;
          const status = t.cell.dataset.status, lane = t.cell.dataset.lane;
          const siblings = itemsIn(lane, status);
          focusAfter = item.id;
          moveItem(item.id, { status, categoryId: lane === NONE ? null : lane, beforeId: t.before?.dataset.id || null, siblings });
        },
      });
    }

    function laneEl(lane, idx, L) {
      const collapsed = !!state.settings.collapsedLanes[lane.id];
      const total = state.items.filter((i) => (i.categoryId || NONE) === lane.id).length;
      const open = state.items.filter((i) => (i.categoryId || NONE) === lane.id && i.status !== 'done').length;
      const toggle = () => patchSettings({ collapsedLanes: { ...state.settings.collapsedLanes, [lane.id]: !collapsed } });
      const head = h('div', { class: 'lane-head', style: lane.color ? { '--lane': lane.color } : null },
        h('button', { class: 'lane-toggle', type: 'button', 'aria-expanded': String(!collapsed), 'aria-label': `Swimlane ${lane.name} ${collapsed ? 'ausklappen' : 'einklappen'}`, onclick: toggle },
          icon(collapsed ? 'chevR' : 'chevD', { size: 18 }),
          lane.color ? h('span', { class: 'dot', style: { background: lane.color } }) : icon('inbox', { size: 16 }),
          h('span', { class: 'lane-name' }, lane.name),
          h('span', { class: 'lane-count' }, `${open} offen · ${total}`)),
        lane.cat ? h('span', { class: 'lane-move' },
          h('button', { class: 'btn icon ghost', type: 'button', disabled: idx === 0, 'aria-label': `${lane.name} nach oben`, onclick: () => moveCategory(lane.id, -1) }, icon('up', { size: 16 })),
          h('button', { class: 'btn icon ghost', type: 'button', disabled: idx >= L.length - 2, 'aria-label': `${lane.name} nach unten`, onclick: () => moveCategory(lane.id, 1) }, icon('down', { size: 16 }))) : null);
      const cells = h('div', { class: 'lane-cells', hidden: collapsed, dataset: { lane: lane.id } },
        STATUSES.map((s) => {
          const its = itemsIn(lane.id, s.id);
          return h('section', { class: `cell st-${s.id}`, dataset: { status: s.id, lane: lane.id }, 'aria-label': `${lane.name} – ${s.label}` },
            h('div', { class: 'cell-head' }, h('span', null, s.label), h('span', { class: 'badge' }, its.length)),
            h('div', { class: 'cell-cards' }, its.map(card)),
            h('button', { class: 'cell-add', type: 'button', 'aria-label': `Neues Element: ${lane.name}, ${s.label}`,
              onclick: () => openItemDialog({ defaults: { status: s.id, categoryId: lane.cat ? lane.id : null } }) }, icon('plus', { size: 16 }), h('span', null, 'Neu')));
        }));
      return h('div', { class: `lane ${collapsed ? 'collapsed' : ''}`, dataset: { lane: lane.id } }, head, cells);
    }

    function render() {
      const sc = scrollerEl();
      const keep = {
        y: sc.scrollTop, bx: root.querySelector('.board-scroll')?.scrollLeft || 0, by: root.querySelector('.board-scroll')?.scrollTop || 0,
        lanes: Object.fromEntries([...root.querySelectorAll('.lane-cells')].map((e) => [e.dataset.lane, e.scrollLeft])),
      };
      const L = lanes();
      root.replaceChildren(
        h('div', { class: 'board-scroll' },
          h('div', { class: 'board-grid' },
            h('div', { class: 'board-cols', 'aria-hidden': 'true' }, STATUSES.map((s) => h('div', { class: `col-title st-${s.id}` }, s.label,
              h('span', { class: 'badge' }, state.items.filter((i) => i.status === s.id).length)))),
            L.map((l, i) => laneEl(l, i, L)))),
        state.categories.length ? null : h('p', { class: 'board-hint' }, 'Tipp: Kategorien entstehen automatisch, sobald du einem Element eine gibst – jede wird hier zu einer eigenen Swimlane.'));
      const bs = root.querySelector('.board-scroll');
      bs.scrollLeft = keep.bx; bs.scrollTop = keep.by; sc.scrollTop = keep.y;
      root.querySelectorAll('.lane-cells').forEach((e) => { e.scrollLeft = keep.lanes[e.dataset.lane] || 0; });
      if (focusAfter) { root.querySelector(`.card[data-id="${focusAfter}"]`)?.focus({ preventScroll: true }); focusAfter = null; }
    }
    render();
    return {
      update(kinds) { if (kinds.has('items') || kinds.has('categories') || kinds.has('settings')) render(); },
      newItem() { openItemDialog({ defaults: { status: 'backlog' } }); },
    };
  },
};
