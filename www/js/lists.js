// Listen für Kurznotizen: Tabellenlisten (z. B. Einkaufsliste) und Kachellisten (z. B. Ideenliste).

import { h, titleOf, uid, debounce } from './util.js';
import { icon } from './icons.js';
import { makeDraggable } from './dnd.js';
import { openModal, confirmDialog, toast, field, openMenu, autosize } from './ui.js';
import {
  state, TILE_COLORS, getList, entriesOf, getEntry, createEntry, updateEntry, deleteEntries, restoreEntries, reorderEntry,
  createList, updateList, deleteList, moveList, patchSettings, createItem,
} from './store.js';
import { openItemDialog } from './itemdialog.js';

// ------------------------------------------------------------------ FLIP: sanftes Umsortieren
// Vor dem Neuzeichnen die Positionen merken, danach jede Zeile von der alten zur neuen Stelle gleiten lassen.
const captureRects = (container) => new Map([...container.querySelectorAll('[data-flip]')].map((e) => [e.dataset.flip, e.getBoundingClientRect()]));
function playFlip(container, before) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  container.querySelectorAll('[data-flip]').forEach((e) => {
    const old = before.get(e.dataset.flip);
    if (!old) return;
    const now = e.getBoundingClientRect();
    const dx = old.left - now.left, dy = old.top - now.top;
    if (!dx && !dy) return;
    e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

export const listsView = {
  title: 'Listen',
  mount(host, params, app) {
    const root = h('div', { class: 'view lists' });
    host.append(root);
    let listId = params.id && getList(params.id) ? params.id : (getList(state.settings.lastList) ? state.settings.lastList : state.lists[0]?.id);
    let hl = params.hl || null;
    let ro = null;
    let focusAfter = null;

    const tabs = h('div', { class: 'list-tabs', role: 'tablist', 'aria-label': 'Listen' });
    const body = h('div', { class: 'list-body' });
    root.append(tabs, body);

    function renderTabs() {
      tabs.replaceChildren(
        ...state.lists.map((l) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(l.id === listId), tabindex: l.id === listId ? '0' : '-1',
          onclick: () => app.nav(`listen/${l.id}`) }, icon(l.type === 'table' ? 'lists' : 'bulb', { size: 16 }), h('span', null, l.name))),
        h('button', { class: 'tab add', type: 'button', onclick: () => listDialog(), 'aria-label': 'Neue Liste anlegen' }, icon('plus', { size: 16 }), h('span', { class: 'hide-xs' }, 'Neue Liste')),
        h('button', { class: 'tab add', type: 'button', onclick: () => manageDialog(), 'aria-label': 'Listen verwalten' }, icon('edit', { size: 16 }), h('span', { class: 'hide-xs' }, 'Verwalten')));
      tabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const t = [...tabs.querySelectorAll('[role=tab]')]; const i = t.indexOf(document.activeElement); if (i < 0) return;
        t[(i + (e.key === 'ArrowRight' ? 1 : -1) + t.length) % t.length].focus(); e.preventDefault();
      }, { once: true });
    }

    // ================================================================== Tabellenliste
    function renderTable(list) {
      const cols = list.columns;
      const template = `2.6rem ${cols.map((c, i) => (i === 0 ? 'minmax(0,2.2fr)' : 'minmax(0,1fr)')).join(' ')} 2.4rem`;
      const all = entriesOf(list.id);
      const active = all.filter((e) => !e.done).sort((a, b) => a.order - b.order);
      const done = all.filter((e) => e.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      const grid = h('div', { class: 'tl', role: 'table', 'aria-label': list.name, style: { '--tl-cols': template } });
      const head = h('div', { class: 'tl-row tl-head', role: 'row' }, h('span', { role: 'columnheader', 'aria-label': 'Erledigt' }),
        cols.map((c) => h('span', { role: 'columnheader' }, c.name)), h('span', { role: 'columnheader', 'aria-label': 'Aktionen' }));
      grid.append(head);

      const rowEl = (e) => {
        const isNew = !e;
        const row = h('div', { class: `tl-row ${isNew ? 'blank' : ''} ${e?.done ? 'done' : ''} ${hl && e && e.id === hl ? 'hl' : ''}`, role: 'row', dataset: { id: e?.id || '', flip: e?.id || 'blank' } });
        const label = (c) => `${c.name}${isNew ? ' (neue Zeile)' : ''}`;
        const check = h('button', { class: `check-btn ${e?.done ? 'on' : ''}`, type: 'button', disabled: isNew, 'aria-pressed': String(!!e?.done),
          'aria-label': isNew ? 'Erst etwas eintragen' : e.done ? 'Wieder aktivieren' : 'Als erledigt abhaken',
          onclick: () => { const id = row.dataset.id; if (!id) return; focusAfter = { sel: `.tl-row[data-id="${id}"] .check-btn` }; updateEntry(id, { done: !getEntry(id).done }); } }, icon('check', { size: 16 }));
        row.append(check);
        cols.forEach((c, ci) => {
          const inp = h('input', { class: 'tl-input', type: 'text', value: e?.cells?.[c.id] || '', autocomplete: 'off', enterkeyhint: 'next',
            dataset: { col: c.id }, 'aria-label': label(c), placeholder: isNew && ci === 0 ? 'Neuer Eintrag …' : '' });
          inp.addEventListener('input', () => { const id = row.dataset.id; if (id) updateEntry(id, { cells: { [c.id]: inp.value } }, { quiet: true }); });
          inp.addEventListener('keydown', (k) => {
            if (k.key !== 'Enter' || k.isComposing) return;
            k.preventDefault();
            if (!row.dataset.id) {                       // Leerzeile: anlegen, dann in die neue Leerzeile springen
              if (!commitBlank(row)) return;
              grid.querySelector('.tl-row.blank .tl-input')?.focus();     // neue Leerzeile, wieder in die erste Spalte
              return;
            }
            const rows = [...grid.querySelectorAll('.tl-row:not(.tl-head):not(.done)')];
            const nxt = rows[rows.indexOf(row) + 1];
            nxt?.querySelector(`[data-col="${c.id}"]`)?.focus();
          });
          row.append(h('div', { class: 'tl-cell', role: 'cell' }, inp));
        });
        const del = h('button', { class: 'btn icon ghost tl-del', type: 'button', disabled: isNew, 'aria-label': 'Zeile löschen',
          onclick: () => { const id = row.dataset.id; if (!id) return; const gone = deleteEntries([id]); toast('Zeile gelöscht', { actionLabel: 'Rückgängig', onAction: () => restoreEntries(gone) }); } }, icon('trash', { size: 16 }));
        row.append(del);
        if (isNew) {
          row.addEventListener('focusout', (ev) => { if (!row.contains(ev.relatedTarget)) commitBlank(row); });
        }
        return row;
      };

      // Leerzeile in eine echte Zeile verwandeln, ohne neu zu zeichnen (sonst ginge der Fokus verloren)
      function commitBlank(row) {
        if (row.dataset.id) return false;
        const cells = {};
        let any = false;
        row.querySelectorAll('.tl-input').forEach((i) => { cells[i.dataset.col] = i.value; if (i.value.trim()) any = true; });
        if (!any) return false;
        const e = createEntry(list.id, { cells }, { quiet: true });
        row.dataset.id = e.id; row.dataset.flip = e.id;
        row.classList.remove('blank');
        row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        row.querySelector('.check-btn').setAttribute('aria-label', 'Als erledigt abhaken');
        row.querySelectorAll('.tl-input').forEach((i) => { i.placeholder = ''; i.setAttribute('aria-label', i.getAttribute('aria-label').replace(' (neue Zeile)', '')); });
        const blank = rowEl(null);
        row.after(blank);
        return true;
      }

      active.forEach((e) => grid.append(rowEl(e)));
      grid.append(rowEl(null));
      if (done.length) {
        grid.append(h('div', { class: 'tl-divider', dataset: { flip: 'divider' } }, `Erledigt (${done.length})`));
        done.forEach((e) => grid.append(rowEl(e)));
      }
      const clearBtn = h('button', { class: 'btn small', type: 'button', disabled: !done.length, onclick: () => {
        const ids = entriesOf(list.id).filter((e) => e.done).map((e) => e.id);
        if (!ids.length) return;
        const gone = deleteEntries(ids);
        toast(`${gone.length} erledigte Einträge entfernt`, { actionLabel: 'Rückgängig', onAction: () => restoreEntries(gone), timeout: 8000 });
      } }, icon('trash', { size: 16 }), ` Erledigte entfernen${done.length ? ` (${done.length})` : ''}`);
      return h('div', { class: 'tl-wrap' }, h('div', { class: 'list-head' }, h('h2', null, list.name), h('span', { class: 'spacer' }), clearBtn), grid,
        h('p', { class: 'hint' }, 'Enter springt in die nächste Zeile, Tab zur nächsten Spalte.'));
    }

    // ================================================================== Kachelliste (Masonry)
    function renderTiles(list) {
      const entries = entriesOf(list.id).sort((a, b) => a.order - b.order);
      const wrap = h('div', { class: 'masonry' });
      const tileEl = (e) => {
        const el = h('div', { class: `tile ${e.color ? 'c' + e.color : ''} ${hl === e.id ? 'hl' : ''}`, role: 'button', tabindex: '0', dataset: { id: e.id },
          'aria-label': `${e.title || 'Kachel'}. Enter zum Bearbeiten.` },
        h('div', { class: 'tile-head' }, e.title ? h('h3', null, e.title) : h('span'),
          h('button', { class: 'btn icon ghost tile-menu', type: 'button', 'aria-label': 'Kachel-Menü', onpointerdown: (ev) => ev.stopPropagation(), onclick: (ev) => { ev.stopPropagation(); tileMenu(ev.currentTarget, e); } }, icon('more', { size: 18 }))),
        e.text ? h('p', { class: 'tile-text' }, e.text) : null);
        el.addEventListener('click', () => tileDialog(list, e));
        el.addEventListener('keydown', (k) => { if (k.target === el && (k.key === 'Enter' || k.key === ' ')) { k.preventDefault(); tileDialog(list, e); } });
        return el;
      };
      entries.forEach((e) => wrap.append(tileEl(e)));
      if (!entries.length) wrap.append(h('div', { class: 'empty', style: { position: 'static' } }, icon('bulb', { size: 40 }), h('h3', null, 'Noch keine Ideen'), h('p', null, 'Tippe auf „+“, um die erste Kachel anzulegen.')));

      let order = entries.map((e) => e.id);
      const layout = (ids = order) => {
        const tiles = ids.map((id) => wrap.querySelector(`.tile[data-id="${id}"]`)).filter(Boolean);
        if (!tiles.length) { wrap.style.height = ''; return; }
        const W = wrap.clientWidth; if (!W) return;
        const gap = 12, minW = W < 520 ? 150 : 230;
        const n = Math.max(1, Math.floor((W + gap) / (minW + gap)));
        const colW = (W - gap * (n - 1)) / n;
        const hs = Array(n).fill(0);
        tiles.forEach((t) => {
          t.style.width = colW + 'px';
          const c = hs.indexOf(Math.min(...hs));
          t.style.transform = `translate(${c * (colW + gap)}px, ${hs[c]}px)`;
          hs[c] += t.offsetHeight + gap;
        });
        wrap.style.height = Math.max(...hs) - gap + 'px';
      };
      ro?.disconnect();
      ro = new ResizeObserver(() => layout());
      ro.observe(wrap);
      requestAnimationFrame(() => { wrap.classList.add('ready'); layout(); });

      // Reihenfolge per Drag & Drop (live umsortiert)
      wrap.querySelectorAll('.tile').forEach((el) => {
        let moved = false;
        makeDraggable(el, {
          canStart: (ev) => !ev.target.closest('.tile-menu'),
          scrollers: () => [host.closest('#view') || host],
          onStart() { el.classList.add('drag-src'); order = [...wrap.querySelectorAll('.tile')].map((t) => t.dataset.id); moved = false; },
          onMove(ctx) {
            const under = document.elementsFromPoint(ctx.x, ctx.y).find((n) => n.classList?.contains('tile') && n !== el);
            const id = el.dataset.id;
            if (under) {
              const from = order.indexOf(id), to = order.indexOf(under.dataset.id);
              if (from !== to) { order.splice(from, 1); order.splice(to, 0, id); moved = true; layout(order); }
            } else {
              const r = wrap.getBoundingClientRect();
              if (ctx.y > r.bottom - 4 && order.at(-1) !== id) { order = order.filter((x) => x !== id).concat(id); moved = true; layout(order); }
            }
          },
          onEnd(ctx, cancelled) {
            el.classList.remove('drag-src');
            if (cancelled || !moved) { order = entries.map((e) => e.id); layout(order); return; }
            const idx = order.indexOf(el.dataset.id);
            reorderEntry(el.dataset.id, order[idx + 1] || null, list.id);
          },
        });
      });
      return h('div', { class: 'tiles-wrap' }, h('div', { class: 'list-head' }, h('h2', null, list.name), h('span', { class: 'spacer' }),
        h('span', { class: 'hint' }, 'Zum Umsortieren Kachel ziehen (Handy: gedrückt halten).')), wrap);
    }

    function tileMenu(anchor, e) {
      const list = getList(e.listId);
      openMenu(anchor, [
        { label: 'Bearbeiten', icon: 'edit', onClick: () => tileDialog(list, e) },
        { label: 'In ToDo umwandeln', icon: 'convert', onClick: () => convertToTodo(e) },
        { label: 'Löschen', icon: 'trash', danger: true, onClick: () => { const gone = deleteEntries([e.id]); toast('Kachel gelöscht', { actionLabel: 'Rückgängig', onAction: () => restoreEntries(gone) }); } },
      ]);
    }
    function convertToTodo(e) {
      const text = [e.title, e.text].filter(Boolean).join('\n') || 'Idee';
      const snap = structuredClone(e);
      const item = createItem({ text, status: 'backlog' });
      deleteEntries([e.id]);
      toast('In ein ToDo umgewandelt', { actionLabel: 'Rückgängig', onAction: () => { restoreEntries([snap]); import('./store.js').then((s) => s.deleteItem(item.id)); } });
      openItemDialog({ id: item.id });
    }

    function tileDialog(list, entry) {
      const title = h('input', { class: 'input', type: 'text', value: entry?.title || '', placeholder: 'Titel', autofocus: true });
      const text = h('textarea', { class: 'input', rows: 5, placeholder: 'Freitext …', value: entry?.text || '' });
      autosize(text);
      let color = entry?.color || '';
      const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Farbe' }, TILE_COLORS.map((c) => {
        const inp = h('input', { type: 'radio', name: 'tilecolor', value: c.id, checked: c.id === color, 'aria-label': c.label });
        inp.addEventListener('change', () => { color = c.id; });
        return h('label', { class: `sw ${c.id ? 'c' + c.id : 'c0'}`, title: c.label }, inp, h('span', { class: 'sw-dot' }, c.id === '' ? icon('x', { size: 14 }) : null));
      }));
      const err = h('div', { class: 'form-error', role: 'alert' });
      const save = () => {
        if (!title.value.trim() && !text.value.trim()) { err.textContent = 'Bitte Titel oder Text eingeben.'; title.focus(); return; }
        if (entry) updateEntry(entry.id, { title: title.value.trim(), text: text.value.replace(/\s+$/, ''), color });
        else createEntry(list.id, { title: title.value.trim(), text: text.value.replace(/\s+$/, ''), color });
        m.close();
      };
      const m = openModal({
        title: entry ? 'Kachel bearbeiten' : 'Neue Kachel', cls: 'small',
        body: h('form', { class: 'item-form', onsubmit: (ev) => { ev.preventDefault(); save(); } }, field('Titel', title), field('Text', text), h('fieldset', { class: 'field' }, h('legend', null, 'Farbe'), sw), err),
        footer: [entry ? h('button', { class: 'btn danger-ghost', type: 'button', onclick: () => { m.close(); const gone = deleteEntries([entry.id]); toast('Kachel gelöscht', { actionLabel: 'Rückgängig', onAction: () => restoreEntries(gone) }); } }, icon('trash', { size: 18 }), ' Löschen') : null,
          h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen'),
          h('button', { class: 'btn primary', type: 'button', onclick: save }, entry ? 'Speichern' : 'Anlegen')],
      });
      text.addEventListener('keydown', (k) => { if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { k.preventDefault(); save(); } });
    }

    // ================================================================== Liste anlegen / verwalten
    function listDialog() {
      const name = h('input', { class: 'input', type: 'text', placeholder: 'z. B. Reisepackliste', autofocus: true });
      let type = 'table';
      const cols = h('input', { class: 'input', type: 'text', value: 'Artikel, Menge, Notiz' });
      const colField = field('Spalten (mit Komma trennen)', cols, { hint: 'Du kannst Spalten später in „Verwalten“ ändern.' });
      const radios = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Listentyp' }, [['table', 'Tabelle (Zeilen mit Spalten)'], ['tiles', 'Kacheln (Galerie)']].map(([v, l]) => {
        const i = h('input', { type: 'radio', name: 'ltype', value: v, checked: v === type });
        i.addEventListener('change', () => { type = v; colField.hidden = v !== 'table'; });
        return h('label', { class: 'seg-opt' }, i, h('span', null, l));
      }));
      const err = h('div', { class: 'form-error', role: 'alert' });
      const save = () => {
        if (!name.value.trim()) { err.textContent = 'Bitte einen Namen eingeben.'; name.focus(); return; }
        const l = createList({ name: name.value, type, columns: cols.value.split(',') });
        m.close(); app.nav(`listen/${l.id}`);
      };
      const m = openModal({
        title: 'Neue Liste', cls: 'small',
        body: h('form', { class: 'item-form', onsubmit: (ev) => { ev.preventDefault(); save(); } }, field('Name', name), h('fieldset', { class: 'field' }, h('legend', null, 'Typ'), radios), colField, err),
        footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Anlegen')],
      });
    }

    function manageDialog() {
      const body = h('div', { class: 'manage' });
      const m = openModal({ title: 'Listen verwalten', body, footer: [h('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, 'Fertig')] });
      const draw = () => {
        body.replaceChildren(...state.lists.map((l, i) => {
          const name = h('input', { class: 'input', type: 'text', value: l.name, 'aria-label': `Name der Liste ${l.name}` });
          name.addEventListener('change', () => { if (name.value.trim()) updateList(l.id, { name: name.value }); else name.value = l.name; });
          const cols = l.type === 'table' ? h('input', { class: 'input', type: 'text', value: l.columns.map((c) => c.name).join(', '), 'aria-label': `Spalten der Liste ${l.name}` }) : null;
          cols?.addEventListener('change', () => updateList(l.id, { columns: cols.value.split(',') }));
          return h('div', { class: 'manage-row' },
            h('div', { class: 'manage-main' }, h('div', { class: 'manage-name' }, icon(l.type === 'table' ? 'lists' : 'bulb', { size: 16 }), name),
              cols ? h('div', { class: 'manage-cols' }, h('span', { class: 'hint' }, 'Spalten:'), cols) : h('span', { class: 'hint' }, 'Kachelliste')),
            h('div', { class: 'manage-btns' },
              h('button', { class: 'btn icon ghost', type: 'button', disabled: i === 0, 'aria-label': `${l.name} nach oben`, onclick: () => { moveList(l.id, -1); draw(); } }, icon('up', { size: 16 })),
              h('button', { class: 'btn icon ghost', type: 'button', disabled: i === state.lists.length - 1, 'aria-label': `${l.name} nach unten`, onclick: () => { moveList(l.id, 1); draw(); } }, icon('down', { size: 16 })),
              h('button', { class: 'btn icon ghost danger-ghost', type: 'button', 'aria-label': `${l.name} löschen`, onclick: async () => {
                const n = entriesOf(l.id).length;
                const ok = await confirmDialog({ title: `„${l.name}“ löschen?`, message: `Die Liste und ${n === 1 ? 'ihr 1 Eintrag' : `ihre ${n} Einträge`} werden endgültig gelöscht.`, confirmText: 'Löschen', danger: true });
                if (ok) { deleteList(l.id); draw(); if (listId === l.id) app.nav('listen'); }
              } }, icon('trash', { size: 16 }))));
        }), state.lists.length ? null : h('p', { class: 'hint' }, 'Es gibt keine Listen. Lege mit „Neue Liste“ eine an.'));
      };
      draw();
    }

    // ================================================================== Render
    function render() {
      ro?.disconnect();
      if (!getList(listId)) listId = state.lists[0]?.id;
      renderTabs();
      const list = getList(listId);
      if (!list) {
        body.replaceChildren(h('div', { class: 'empty' }, icon('lists', { size: 40 }), h('h3', null, 'Keine Listen'), h('p', null, 'Lege deine erste Liste an.'),
          h('button', { class: 'btn primary', type: 'button', onclick: listDialog }, 'Neue Liste')));
        return;
      }
      if (state.settings.lastList !== list.id) patchSettings({ lastList: list.id });
      const sc = host.closest('#view');
      const y = sc?.scrollTop || 0;
      const before = body.dataset.list === list.id && list.type === 'table' ? captureRects(body) : null;
      body.replaceChildren(list.type === 'table' ? renderTable(list) : renderTiles(list));
      body.dataset.list = list.id;
      if (before) playFlip(body, before);
      if (sc) sc.scrollTop = y;
      if (focusAfter) { body.querySelector(focusAfter.sel)?.focus({ preventScroll: true }); focusAfter = null; }
      if (hl) {
        const el = body.querySelector(`[data-id="${hl}"]`);
        el?.scrollIntoView({ block: 'center' });
        setTimeout(() => { hl = null; body.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl')); }, 2400);
      }
    }
    render();
    return {
      update(kinds) {
        if (kinds.has('lists') || kinds.has('entries')) render();
      },
      newItem() {
        const list = getList(listId);
        if (!list) return listDialog();
        if (list.type === 'tiles') tileDialog(list, null);
        else { const inp = body.querySelector('.tl-row.blank .tl-input'); inp?.focus(); inp?.scrollIntoView({ block: 'center' }); }
      },
      destroy() { ro?.disconnect(); },
    };
  },
};
