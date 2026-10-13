// Der EINE Bearbeitungsdialog für Elemente – derselbe in Übersicht, Kalender, Board und Suche.
// Auf dem Desktop ein Dialog, auf dem Handy ein Bottom-Sheet (nur CSS).

import { h, parseLocal, hasTime, fmtDateTime, fmtDate, dayKey, addDays, startOfWeek, titleOf, MIN } from './util.js';
import { openModal, confirmDialog, toast, field, segmented, autosize, combobox, dateField, timeField, select } from './ui.js';
import { icon, prioIcon } from './icons.js';
import {
  state, STATUSES, PRIOS, getItem, createItem, updateItem, deleteItem, restoreItem, getCategory, ensureCategory,
} from './store.js';
import { OFFSETS, MAX_REMINDERS, newReminder, reminderTime, offsetLabel } from './reminders.js';
import { ensureNotifyPermission } from './notify.js';

const KIND_OPTS = [
  { id: 'start', label: 'Relativ zum Start' },
  { id: 'end', label: 'Relativ zum Ende' },
  { id: 'abs', label: 'Zu festem Zeitpunkt' },
];

/** @param {{id?:string, defaults?:object, onSaved?:(item)=>void}} opts */
export function openItemDialog({ id, defaults = {}, onSaved } = {}) {
  const existing = id ? getItem(id) : null;
  if (id && !existing) return null;
  const src = existing || { text: '', start: null, end: null, reminders: [], priority: null, categoryId: null, status: 'backlog', ...defaults };
  const split = (s) => (s ? [s.slice(0, 10), hasTime(s) ? s.slice(11, 16) : ''] : ['', '']);
  const [sd, st] = split(src.start), [ed, et] = split(src.end);
  const reminders = (src.reminders || []).map((r) => ({ ...r }));
  const errors = h('div', { class: 'form-error', role: 'alert', 'aria-live': 'assertive' });

  // --- Beschreibung
  const text = h('textarea', { class: 'input', rows: 3, placeholder: 'Was ist zu tun? (Erste Zeile = Titel)', value: src.text, 'aria-required': 'true' });
  autosize(text);

  // --- Status, Priorität, Kategorie
  const status = select({ options: STATUSES, value: src.status });
  const prio = segmented({
    name: 'prio', label: 'Priorität', value: src.priority || '',
    options: [{ id: '', label: 'Keine' }, ...PRIOS.map((p) => ({ id: p.id, label: p.label, node: h('span', { class: `prio-opt prio-${p.id}` }, prioIcon(p.level), ' ', p.label) }))],
  });
  const cat = combobox({
    value: getCategory(src.categoryId)?.name || '', ariaLabel: 'Kategorie', placeholder: 'Kategorie wählen oder neu eintippen',
    getOptions: () => state.categories.map((c) => ({ id: c.id, label: c.name, color: c.color })),
  });

  // --- Datum & Uhrzeit
  const onDt = () => { errors.textContent = ''; refreshReminders(); };
  const sDate = dateField({ value: sd, label: 'Startdatum', onChange: onDt });
  const sTime = timeField({ value: st, label: 'Startuhrzeit', onChange: onDt });
  const eDate = dateField({ value: ed, label: 'Enddatum', onChange: onDt });
  const eTime = timeField({ value: et, label: 'Enduhrzeit', onChange: onDt });
  const quick = (target) => h('div', { class: 'quick' },
    ...[['Heute', 0], ['Morgen', 1], ['Nächste Woche', 7]].map(([l, n]) =>
      h('button', { type: 'button', class: 'chip-btn', onclick: () => { target.set(dayKey(addDays(new Date(), n))); onDt(); } }, l)),
    h('button', { type: 'button', class: 'chip-btn', onclick: () => { target.set(''); onDt(); } }, 'Leeren'));

  // --- Erinnerungen
  const remBox = h('div', { class: 'rem-list' });
  const addBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    if (reminders.length >= MAX_REMINDERS) return;
    reminders.push(newReminder(currentDraftItem(), state.settings.defaultSound));
    renderReminders();
    ensureNotifyPermission();   // freundlich nachfragen, aber den Dialog nicht blockieren
  } }, icon('plus', { size: 16 }), ' Erinnerung hinzufügen');
  const remPreview = new Map();
  function currentDraftItem() {
    const s = sDate.get(), e = eDate.get();
    return { start: s ? (sTime.get() ? `${s}T${sTime.get()}` : s) : null, end: e ? (eTime.get() ? `${e}T${eTime.get()}` : e) : null };
  }
  function refreshReminders() {
    const it = currentDraftItem();
    for (const r of reminders) {
      const el = remPreview.get(r.id); if (!el) continue;
      const t = reminderTime(it, collectReminder(r), state.settings.defaultTime);
      el.textContent = t ? `Löst aus: ${fmtDateTime(t)}` : (r.kind === 'abs' ? 'Bitte Datum und Uhrzeit eintragen.' : `Dafür fehlt das ${r.kind === 'start' ? 'Startdatum' : 'Enddatum'}.`);
      el.classList.toggle('warn', !t);
    }
    addBtn.hidden = reminders.length >= MAX_REMINDERS;
  }
  const abs = new Map(); // reminder-id -> {date,time}
  function collectReminder(r) {
    if (r.kind !== 'abs') return r;
    const a = abs.get(r.id);
    const d = a?.date.get();
    return { ...r, at: d ? (a.time.get() ? `${d}T${a.time.get()}` : d) : '' };
  }
  function renderReminders() {
    remBox.replaceChildren();
    remPreview.clear();
    reminders.forEach((r, idx) => {
      const kind = select({ options: KIND_OPTS, value: r.kind, ariaLabel: `Erinnerung ${idx + 1}: Bezug`, onChange: (v) => {
        Object.assign(r, collectReminder(r)); r.kind = v;
        if (v === 'abs' && !r.at) { const s = currentDraftItem().start || currentDraftItem().end; r.at = s ? (hasTime(s) ? s : `${s}T${state.settings.defaultTime}`) : ''; }
        renderReminders();
      } });
      const sound = h('input', { type: 'checkbox', checked: r.sound, onchange: (e) => { r.sound = e.target.checked; } });
      const preview = h('div', { class: 'rem-prev' });
      remPreview.set(r.id, preview);
      let when;
      if (r.kind === 'abs') {
        const [d, t] = r.at ? [r.at.slice(0, 10), hasTime(r.at) ? r.at.slice(11, 16) : ''] : ['', ''];
        const date = dateField({ value: d, label: `Erinnerung ${idx + 1}: Datum`, onChange: refreshReminders });
        const time = timeField({ value: t, label: `Erinnerung ${idx + 1}: Uhrzeit`, onChange: refreshReminders });
        abs.set(r.id, { date, time });
        when = h('div', { class: 'dt-pair' }, date.el, time.el);
      } else {
        const opts = OFFSETS.map((o) => ({ id: String(o.min), label: o.label }));
        if (!OFFSETS.some((o) => o.min === r.offset)) opts.push({ id: String(r.offset), label: offsetLabel(r.offset) });
        when = select({ options: opts, value: String(r.offset), ariaLabel: `Erinnerung ${idx + 1}: Vorlauf`, onChange: (v) => { r.offset = +v; refreshReminders(); } });
      }
      remBox.append(h('div', { class: 'rem' },
        h('div', { class: 'rem-row' }, kind, when,
          h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': `Erinnerung ${idx + 1} entfernen`, onclick: () => { reminders.splice(idx, 1); renderReminders(); } }, icon('trash', { size: 18 }))),
        h('div', { class: 'rem-row meta' },
          h('label', { class: 'check' }, sound, h('span', null, 'Mit kurzem Klingelton')), preview)));
    });
    refreshReminders();
  }
  renderReminders();

  // --- Zusammenbau
  const body = h('form', { class: 'item-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
    field('Beschreibung', text),
    h('div', { class: 'grid2' }, field('Status', status), field('Kategorie', cat.el)),
    h('fieldset', { class: 'field' }, h('legend', null, 'Priorität'), prio.el),
    h('fieldset', { class: 'field' }, h('legend', null, 'Start'), h('div', { class: 'dt-pair' }, sDate.el, sTime.el), quick(sDate)),
    h('fieldset', { class: 'field' }, h('legend', null, 'Ende'), h('div', { class: 'dt-pair' }, eDate.el, eTime.el), quick(eDate),
      h('div', { class: 'hint' }, 'Ohne Uhrzeit ist der Termin ganztägig.')),
    h('fieldset', { class: 'field' }, h('legend', null, `Erinnerungen (max. ${MAX_REMINDERS})`), remBox, addBtn),
    existing ? h('p', { class: 'meta-line' },
      `Erstellt ${fmtDateTime(new Date(existing.createdAt))} · Geändert ${fmtDateTime(new Date(existing.updatedAt))}`,
      existing.doneAt ? ` · Erledigt ${fmtDateTime(new Date(existing.doneAt))}` : '') : null,
    errors);

  const snapshot = () => JSON.stringify([text.value, status.value, prio.get(), cat.get(), sDate.input.value, sTime.input.value,
    eDate.input.value, eTime.input.value, reminders.map((r) => collectReminder(r))]);
  const initial = snapshot();
  let saved = false;

  const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => save() }, existing ? 'Speichern' : 'Anlegen');
  const cancelBtn = h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Abbrechen');
  const delBtn = existing ? h('button', { class: 'btn danger-ghost', type: 'button', onclick: () => remove() }, icon('trash', { size: 18 }), ' Löschen') : null;

  const m = openModal({
    title: existing ? 'Element bearbeiten' : 'Neues Element', cls: 'item-dialog', body,
    footer: [delBtn, h('span', { class: 'spacer' }), cancelBtn, saveBtn],
    canClose: () => {
      if (saved || snapshot() === initial) return true;
      confirmDialog({ title: 'Änderungen verwerfen?', message: 'Deine Eingaben sind noch nicht gespeichert.', confirmText: 'Verwerfen', cancelText: 'Weiter bearbeiten', danger: true })
        .then((ok) => { if (ok) { saved = true; m.close(); } });
      return false;
    },
  });
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });

  function fail(msg, focusEl) { errors.textContent = msg; focusEl?.focus(); return false; }

  function save() {
    errors.textContent = '';
    const t = text.value.trim();
    if (!t) return fail('Bitte einen Beschreibungstext eingeben.', text);
    const s = sDate.get(), e = eDate.get();
    if (s === null) return fail('Das Startdatum ist ungültig – Beispiel: 13.10.2026.', sDate.input);
    if (e === null) return fail('Das Enddatum ist ungültig – Beispiel: 13.10.2026.', eDate.input);
    const stm = sTime.get(), etm = eTime.get();
    if (stm === null) return fail('Die Startuhrzeit ist ungültig – Beispiel: 14:30.', sTime.input);
    if (etm === null) return fail('Die Enduhrzeit ist ungültig – Beispiel: 14:30.', eTime.input);
    if (stm && !s) return fail('Für die Startuhrzeit fehlt das Startdatum.', sDate.input);
    if (etm && !e) return fail('Für die Enduhrzeit fehlt das Enddatum.', eDate.input);
    const start = s ? (stm ? `${s}T${stm}` : s) : null;
    const end = e ? (etm ? `${e}T${etm}` : e) : null;
    if (start && end) {
      const a = parseLocal(hasTime(start) ? start : start + 'T00:00');
      const b = parseLocal(hasTime(end) ? end : end + 'T23:59');
      if (b < a) return fail('Das Ende darf nicht vor dem Start liegen.', eDate.input);
    }
    const rems = [];
    for (const [i, r0] of reminders.entries()) {
      const r = collectReminder(r0);
      if (r.kind === 'abs') {
        const a = abs.get(r.id);
        if (a.date.get() === null || a.time.get() === null) return fail(`Erinnerung ${i + 1}: Datum oder Uhrzeit ist ungültig.`, a.date.input);
        if (!r.at) return fail(`Erinnerung ${i + 1}: Bitte ein Datum eintragen.`, a.date.input);
      } else if (!reminderTime({ start, end }, r, state.settings.defaultTime)) {
        return fail(`Erinnerung ${i + 1}: ${r.kind === 'start' ? 'Es fehlt das Startdatum.' : 'Es fehlt das Enddatum.'}`, (r.kind === 'start' ? sDate : eDate).input);
      }
      rems.push({ id: r.id, kind: r.kind, at: r.kind === 'abs' ? r.at : '', offset: r.kind === 'abs' ? 0 : r.offset, sound: !!r.sound });
    }
    const catName = cat.get();
    const data = {
      text: text.value.replace(/\s+$/, ''), start, end, reminders: rems,
      priority: prio.get() || null, status: status.value, categoryId: catName ? ensureCategory(catName) : null,
    };
    const item = existing ? updateItem(existing.id, data) : createItem(data);
    if (rems.length) ensureNotifyPermission();
    saved = true;
    m.close();
    onSaved?.(item);
    return true;
  }

  function remove() {
    const snap = structuredClone(getItem(existing.id));
    saved = true;
    m.close();
    deleteItem(existing.id);
    toast(`„${titleOf(snap.text).slice(0, 40)}“ gelöscht`, { actionLabel: 'Rückgängig', onAction: () => restoreItem(snap) });
  }
  return m;
}
