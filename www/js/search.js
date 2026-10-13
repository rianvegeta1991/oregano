// Globale Suche über Elemente und Listeneinträge (Tastenkürzel: / oder Strg+K).

import { h, norm, titleOf, debounce } from './util.js';
import { icon } from './icons.js';
import { openModal } from './ui.js';
import { state, STATUS_LABEL, getCategory, getList } from './store.js';
import { openItemDialog } from './itemdialog.js';

function mark(text, q) {
  if (!q) return text;
  const n = norm(text), i = n.indexOf(q);
  if (i < 0 || n.length !== text.length) return text;     // Normalisierung hat die Länge verändert → lieber ohne Hervorhebung
  return [text.slice(0, i), h('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length)];
}
const snippet = (text, q, max = 90) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = norm(flat).indexOf(q);
  if (i < 0 || flat.length <= max) return flat.slice(0, max) + (flat.length > max ? '…' : '');
  const a = Math.max(0, i - 25);
  return (a ? '…' : '') + flat.slice(a, a + max) + '…';
};

export function openSearch(app) {
  const input = h('input', { class: 'input search-input', type: 'search', placeholder: 'Elemente und Listeneinträge durchsuchen …', 'aria-label': 'Suche', autofocus: true, autocomplete: 'off' });
  const results = h('div', { class: 'search-results', role: 'listbox', 'aria-label': 'Treffer' });
  const status = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  let flat = [], active = -1;

  const run = () => {
    const q = norm(input.value.trim());
    results.replaceChildren();
    flat = [];
    if (!q) { results.append(h('p', { class: 'hint pad' }, 'Tippe, um zu suchen – gesucht wird in Texten, Kategorien, Tabellenzellen und Kacheln.')); status.textContent = ''; return; }
    const items = state.items.filter((i) => norm(i.text).includes(q) || norm(getCategory(i.categoryId)?.name || '').includes(q))
      .sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.updatedAt - a.updatedAt).slice(0, 30);
    const ents = state.entries.filter((e) => {
      const l = getList(e.listId); if (!l) return false;
      const hay = [e.title, e.text, ...Object.values(e.cells || {})].join(' ');
      return norm(hay).includes(q);
    }).slice(0, 30);
    const sec = (label, rows) => rows.length && results.append(h('h3', { class: 'search-sec' }, label), ...rows);
    sec('Elemente', items.map((i) => {
      const cat = getCategory(i.categoryId);
      const rest = i.text.trim().split('\n').slice(1).join(' ');
      return row(icon('list', { size: 18 }), mark(titleOf(i.text), q), [cat?.name, STATUS_LABEL[i.status], rest && snippet(rest, q)].filter(Boolean).join(' · '),
        () => { m.close(); openItemDialog({ id: i.id }); }, i.status === 'done');
    }));
    sec('Listeneinträge', ents.map((e) => {
      const l = getList(e.listId);
      const main = e.title || Object.values(e.cells || {}).find(Boolean) || '(leer)';
      const more = [...Object.values(e.cells || {}).filter(Boolean).slice(e.title ? 0 : 1), e.text].filter(Boolean).join(' · ');
      return row(icon(l.type === 'table' ? 'lists' : 'bulb', { size: 18 }), mark(main, q), `${l.name}${more ? ' · ' + snippet(more, q) : ''}`,
        () => { m.close(); app.nav(`listen/${l.id}?hl=${e.id}`); }, e.done);
    }));
    if (!flat.length) results.append(h('p', { class: 'hint pad' }, `Nichts gefunden für „${input.value.trim()}“.`));
    status.textContent = `${flat.length} Treffer`;
    setActive(flat.length ? 0 : -1);
  };
  function row(ico, title, sub, go, dim) {
    const el = h('button', { class: `sr-row ${dim ? 'dim' : ''}`, type: 'button', role: 'option', onclick: go }, ico,
      h('span', { class: 'sr-text' }, h('span', { class: 'sr-title' }, title), sub ? h('span', { class: 'sr-sub' }, sub) : null));
    flat.push({ el, go });
    return el;
  }
  function setActive(i) {
    active = i;
    flat.forEach((r, n) => { r.el.classList.toggle('active', n === i); r.el.setAttribute('aria-selected', String(n === i)); });
    flat[i]?.el.scrollIntoView({ block: 'nearest' });
  }
  input.addEventListener('input', debounce(run, 80));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(flat.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); flat[active].go(); }
  });
  const m = openModal({ title: 'Suche', cls: 'search-dialog', body: h('div', null, input, status, results) });
  run();
  return m;
}
