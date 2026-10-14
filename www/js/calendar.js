// Kalender: Tag, Woche, Monat. Mehrtägiges als Balken, Zeitraster für Termine mit Uhrzeit.
// Verschieben per Drag & Drop (Monat: um Tage; Tag/Woche: Zeit und Tag, Ende unten ziehbar),
// Klick auf freie Fläche legt ein Element an, Seitenleiste „Ohne Termin“ lässt sich in den Kalender ziehen.

import {
  h, parseLocal, hasTime, startOfDay, addDays, addMonths, startOfWeek, isoWeek, dayDiff, dayKey, toLocal, sameDay,
  fmtTime, fmtDM, fmtDate, wdShort, wdLong, monLong, monShort, titleOf, pad, MIN, clamp,
} from './util.js';
import { icon, prioIcon } from './icons.js';
import { makeDraggable } from './dnd.js';
import { openModal, segmented } from './ui.js';
import { debounce } from './util.js';
import { state, patchSettings, updateItem, getCategory, PRIO_LEVEL } from './store.js';
import { openItemDialog } from './itemdialog.js';

const BASE_HH = 52;                  // Stundenhöhe im Zeitraster bei Zoom 1 (px)
const BASE_COL = 96;                 // Mindestbreite einer Wochenspalte bei Zoom 1 (px)
const Z_MIN = 0.32, Z_MAX = 2.4;
let HH = BASE_HH;                    // aktuelle Stundenhöhe (folgt dem Zoom)
const SNAP = 15;                     // Minuten
const isNarrow = () => window.innerWidth < 760;

let cursor = startOfDay(new Date()); // bleibt beim Ansichtswechsel erhalten

// ------------------------------------------------------------------ Zeitspannen
/** Normalisiert ein Element zu einer Anzeige-Spanne. Ohne Ende: 1 Std. (Termin) bzw. ganzer Tag. Nur Ende: 30 Min. davor. */
function spanOf(it) {
  const s = it.start, e = it.end;
  if (!s && !e) return null;
  let a, b, allDay;
  if (s && e) {
    allDay = !hasTime(s) && !hasTime(e);
    a = parseLocal(s).getTime();
    b = hasTime(e) ? parseLocal(e).getTime() : addDays(parseLocal(e), 1).getTime();
  } else if (s) {
    allDay = !hasTime(s);
    a = parseLocal(s).getTime();
    b = allDay ? addDays(parseLocal(s), 1).getTime() : a + 60 * MIN;
  } else {
    allDay = !hasTime(e);
    b = allDay ? addDays(parseLocal(e), 1).getTime() : parseLocal(e).getTime();
    a = allDay ? parseLocal(e).getTime() : b - 30 * MIN;
  }
  if (b <= a) b = a + (allDay ? 86400000 : SNAP * MIN);
  const firstDay = startOfDay(new Date(a));
  const lastDay = startOfDay(new Date(b - 1));
  const multi = dayDiff(firstDay, lastDay) > 0;
  return { it, a, b, allDay, firstDay, lastDay, multi, banner: allDay || multi, kind: s && e ? 'both' : s ? 'start' : 'end' };
}
const allSpans = () => state.items
  .filter((i) => state.settings.showDone || i.status !== 'done')
  .map(spanOf).filter(Boolean)
  .sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a));

/** Verschiebt die Felder eines Elements: Tage und Minuten in Wanduhr-Rechnung (sommerzeitfest). */
function shiftItem(it, days, minutes = 0) {
  const sh = (s) => {
    if (!s) return null;
    const d = parseLocal(s);
    return toLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes() + (hasTime(s) ? minutes : 0)), hasTime(s));
  };
  updateItem(it.id, { start: sh(it.start), end: sh(it.end) });
}

// ------------------------------------------------------------------ Balken-Layout (Monat und Ganztags-Band)
/** Verteilt Spannen auf Spuren innerhalb von n Tagen ab `first`. */
function layoutBars(spans, first, n) {
  const last = addDays(first, n - 1);
  const rows = [];
  const bars = [];
  for (const sp of spans) {
    if (sp.lastDay < first || sp.firstDay > last) continue;
    const c0 = Math.max(0, dayDiff(first, sp.firstDay)), c1 = Math.min(n - 1, dayDiff(first, sp.lastDay));
    let lane = rows.findIndex((end) => end < c0);
    if (lane < 0) { lane = rows.length; rows.push(-1); }
    rows[lane] = c1;
    bars.push({ sp, c0, c1, lane, contL: sp.firstDay < first, contR: sp.lastDay > last });
  }
  return { bars, lanes: rows.length };
}

// ------------------------------------------------------------------ Ansicht
export const calendarView = {
  title: 'Kalender',
  mount(host) {
    let view = state.settings.calView || 'month';
    let nowTimer = 0;
    const root = h('div', { class: 'view calendar' });
    host.append(root);
    const scroller = () => host.closest('#view') || host;

    // ---- Kopfleiste
    const titleEl = h('h2', { class: 'cal-title', 'aria-live': 'polite' });
    const viewSeg = segmented({ name: 'calview', label: 'Ansicht', value: view, options: [{ id: 'day', label: 'Tag' }, { id: 'week', label: 'Woche' }, { id: 'month', label: 'Monat' }],
      onChange: (v) => { view = v; patchSettings({ calView: v }); render(); } });
    // --- Zoom (Tag/Woche): +/−, Anpassen, Zwei-Finger-Geste, Strg+Mausrad
    let zoom = clamp(+state.settings.calZoom || 1, Z_MIN, Z_MAX);
    const zbtn = (label, ico, fn) => h('button', { class: 'btn icon', type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(ico, { size: 18 }));
    const zoomGroup = h('div', { class: 'zoom-group', role: 'group', 'aria-label': 'Zoom' },
      zbtn('Verkleinern', 'minus', () => zoomBy(1 / 1.25)), zbtn('Vergrößern', 'plus', () => zoomBy(1.25)), zbtn('Ganze Woche anpassen', 'fit', () => zoomFit()));
    const colMinFor = (z) => (view === 'week' ? Math.max(30, Math.round(BASE_COL * z)) : 0);
    function applyZoomVars(wrap) {
      HH = Math.max(18, BASE_HH * zoom);
      const cm = colMinFor(zoom);
      wrap.style.setProperty('--hh', HH + 'px');
      wrap.style.setProperty('--colmin', cm + 'px');
      wrap.style.setProperty('--zf', String(clamp(zoom, 0.62, 1)));
      wrap.dataset.narrow = view === 'week' && cm < 66 ? '1' : '';
    }
    /** Setzt den Zoom live (nur CSS-Variablen) und hält den Punkt unter dem Finger/Cursor an Ort und Stelle. */
    function setZoom(z, fx, fy, persist = false) {
      z = clamp(z, Z_MIN, Z_MAX);
      const tg = main.querySelector('.tg');
      if (!tg) { zoom = z; return; }
      const rect = tg.getBoundingClientRect();
      const oldH = HH, oldC = colMinFor(zoom);
      const T = tg.querySelector('.tg-top').offsetHeight, G = tg.querySelector('.tg-gutter').offsetWidth;
      const cx = (fx ?? rect.left + rect.width / 2) - rect.left, cy = (fy ?? rect.top + rect.height / 2) - rect.top;
      zoom = z;
      applyZoomVars(tg);
      const ry = HH / oldH, rx = oldC ? colMinFor(zoom) / oldC : 1;
      tg.scrollTop = (tg.scrollTop + cy - T) * ry + T - cy;
      if (view === 'week') tg.scrollLeft = (tg.scrollLeft + cx - G) * rx + G - cx;
      if (persist) saveZoom();
    }
    const saveZoom = debounce(() => patchSettings({ calZoom: Math.round(zoom * 100) / 100 }), 250);
    const zoomBy = (f) => { setZoom(zoom * f, undefined, undefined, true); };
    function zoomFit() {
      const tg = main.querySelector('.tg'); if (!tg) return;
      if (view === 'week') {
        const avail = tg.clientWidth - tg.querySelector('.tg-gutter').offsetWidth;
        setZoom(avail / 7 / BASE_COL, undefined, undefined, true);
        tg.scrollLeft = 0;
      } else {                                        // Tag: ganze 24 Stunden untereinander
        const avail = tg.clientHeight - tg.querySelector('.tg-top').offsetHeight;
        setZoom(avail / 24 / BASE_HH, undefined, undefined, true);
        tg.scrollTop = 0;
      }
    }
    const unschedBtn = h('button', { class: 'btn', type: 'button', onclick: () => (isNarrow() ? openUnscheduledSheet() : patchSettings({ calSidebar: !state.settings.calSidebar })) });
    const bar = h('div', { class: 'cal-bar' },
      h('div', { class: 'cal-nav' },
        h('button', { class: 'btn', type: 'button', onclick: () => { cursor = startOfDay(new Date()); render(); } }, 'Heute'),
        h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Zurück', onclick: () => step(-1) }, icon('chevL')),
        h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Vor', onclick: () => step(1) }, icon('chevR')),
        titleEl),
      h('div', { class: 'cal-tools' }, zoomGroup, viewSeg.el, unschedBtn));
    const main = h('div', { class: 'cal-main' });
    const side = h('aside', { class: 'cal-side', 'aria-label': 'Ohne Termin' });
    root.append(bar, h('div', { class: 'cal-layout' }, main, side));

    let pinch = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    main.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2 && e.target.closest('.tg')) pinch = { d0: dist(e.touches[0], e.touches[1]), z0: zoom };
      else if (e.touches.length > 2) pinch = null;
    }, { passive: true });
    main.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const [a, b] = e.touches;
      setZoom(pinch.z0 * dist(a, b) / pinch.d0, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    }, { passive: false });
    const endPinch = (e) => { if (pinch && e.touches.length < 2) { pinch = null; saveZoom(); } };
    main.addEventListener('touchend', endPinch, { passive: true });
    main.addEventListener('touchcancel', endPinch, { passive: true });
    main.addEventListener('wheel', (e) => {            // Strg + Mausrad bzw. Trackpad-Pinch am Desktop
      if (!e.ctrlKey || !e.target.closest('.tg')) return;
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY, true);
    }, { passive: false });


    function step(dir) {
      cursor = view === 'month' ? addMonths(cursor, dir) : addDays(cursor, dir * (view === 'week' ? 7 : 1));
      cursor = startOfDay(cursor);
      render();
    }
    function setTitle() {
      if (view === 'month') titleEl.textContent = `${monLong(cursor)} ${cursor.getFullYear()}`;
      else if (view === 'day') titleEl.textContent = `${wdLong(cursor)}, ${cursor.getDate()}. ${monLong(cursor)} ${cursor.getFullYear()}`;
      else {
        const a = startOfWeek(cursor), b = addDays(a, 6);
        const rng = a.getMonth() === b.getMonth() ? `${a.getDate()}.–${b.getDate()}. ${monShort(b)} ${b.getFullYear()}`
          : `${a.getDate()}. ${monShort(a)} – ${b.getDate()}. ${monShort(b)} ${b.getFullYear()}`;
        titleEl.textContent = `KW ${isoWeek(cursor)} · ${rng}`;
      }
    }

    // ---- Chips
    const timeLabel = (sp) => (sp.allDay || sp.multi ? '' : fmtTime(new Date(sp.a)));
    function catStyle(it) { const c = getCategory(it.categoryId); return c ? { '--cat': c.color } : null; }
    function bar_(b, { hidden } = {}) {
      const { sp } = b, it = sp.it;
      const pre = !sp.multi && !sp.allDay ? timeLabel(sp) + ' ' : '';
      const el = h('button', {
        type: 'button', class: `bar ${it.status === 'done' ? 'done' : ''} ${b.contL ? 'cont-l' : ''} ${b.contR ? 'cont-r' : ''} ${it.priority ? 'p-' + it.priority : ''}`,
        style: { gridColumn: `${b.c0 + 1} / ${b.c1 + 2}`, gridRow: String(b.lane + 1), ...catStyle(it) }, dataset: { id: it.id },
        title: titleOf(it.text),
      }, it.priority ? prioIcon(PRIO_LEVEL[it.priority], { size: 12 }) : null, pre ? h('span', { class: 'bar-time' }, pre) : null, h('span', { class: 'bar-title' }, titleOf(it.text)));
      el.addEventListener('click', () => openItemDialog({ id: it.id }));
      return el;
    }

    // ================================================================== Monat
    function renderMonth() {
      const first = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const weeks = Math.ceil((dayDiff(first, lastOfMonth) + 1) / 7);
      const spans = allSpans();
      const today = startOfDay(new Date());
      const maxLanes = isNarrow() ? 2 : 4;
      const wk = state.settings.weekNumbers;
      const head = h('div', { class: `mhead ${wk ? 'wk' : ''}` }, wk ? h('span', { class: 'kw-h' }, 'KW') : null,
        ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('span', null, d)));
      const grid = h('div', { class: 'mgrid', style: { '--weeks': weeks } });
      for (let w = 0; w < weeks; w++) {
        const ws = addDays(first, w * 7);
        const { bars, lanes } = layoutBars(spans, ws, 7);
        const shown = Math.min(lanes, maxLanes);
        const hiddenPerDay = Array(7).fill(0);
        for (const b of bars) if (b.lane >= maxLanes) for (let c = b.c0; c <= b.c1; c++) hiddenPerDay[c]++;
        const days = h('div', { class: 'mdays' }, Array.from({ length: 7 }, (_, c) => {
          const d = addDays(ws, c);
          const out = d.getMonth() !== cursor.getMonth();
          return h('div', { class: `mday ${out ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''} ${c >= 5 ? 'weekend' : ''}`, dataset: { date: dayKey(d) },
            onclick: (e) => { if (e.target.closest('.mnum')) return; openItemDialog({ defaults: { start: dayKey(d) } }); } },
          h('button', { class: 'mnum', type: 'button', 'aria-label': `${wdLong(d)}, ${fmtDate(d)} – Tagesansicht`, onclick: () => { cursor = d; view = 'day'; viewSeg.set('day'); patchSettings({ calView: 'day' }); render(); } },
            d.getDate() === 1 ? `${d.getDate()}. ${monShort(d)}` : d.getDate()));
        }));
        const barsEl = h('div', { class: 'mbars', style: { gridTemplateRows: `repeat(${shown + (hiddenPerDay.some(Boolean) ? 1 : 0)}, var(--bar-h))` } },
          bars.filter((b) => b.lane < maxLanes).map((b) => bar_(b)),
          hiddenPerDay.map((n, c) => n ? h('button', { class: 'more', type: 'button', style: { gridColumn: String(c + 1), gridRow: String(shown + 1) },
            onclick: () => { cursor = addDays(ws, c); view = 'day'; viewSeg.set('day'); patchSettings({ calView: 'day' }); render(); } }, `+${n} weitere`) : null));
        grid.append(h('div', { class: `mrow ${wk ? 'wk' : ''}`, style: { '--rows': shown + (hiddenPerDay.some(Boolean) ? 1 : 0) } },
          wk ? h('button', { class: 'kw', type: 'button', 'aria-label': `Kalenderwoche ${isoWeek(ws)} – Wochenansicht`, onclick: () => { cursor = ws; view = 'week'; viewSeg.set('week'); patchSettings({ calView: 'week' }); render(); } }, isoWeek(ws)) : null,
          h('div', { class: 'mcells' }, days, barsEl)));
      }
      main.replaceChildren(h('div', { class: 'month' }, head, grid));
      // Balken verschieben (um ganze Tage)
      main.querySelectorAll('.bar').forEach((el) => {
        const it = state.items.find((i) => i.id === el.dataset.id);
        let grab = null, target = null;
        const dayAt = (x, y) => document.elementsFromPoint(x, y).find((e) => e.classList?.contains('mday')) || null;
        makeDraggable(el, {
          scrollers: () => [scroller()],
          onStart(ctx) { grab = dayAt(ctx.startX, ctx.startY); el.classList.add('drag-src'); if (!grab) return false; },
          onMove(ctx) {
            const t = dayAt(ctx.x, ctx.y);
            main.querySelectorAll('.mday.drop-over').forEach((c) => c !== t && c.classList.remove('drop-over'));
            target = t; t?.classList.add('drop-over');
          },
          onEnd(ctx, cancelled) {
            el.classList.remove('drag-src');
            main.querySelectorAll('.mday.drop-over').forEach((c) => c.classList.remove('drop-over'));
            if (cancelled || !target || !grab) return;
            const n = dayDiff(parseLocal(grab.dataset.date), parseLocal(target.dataset.date));
            if (n) shiftItem(it, n);
          },
        });
      });
    }

    // ================================================================== Tag / Woche
    function renderGrid() {
      const n = view === 'week' ? 7 : 1;
      const first = view === 'week' ? startOfWeek(cursor) : cursor;
      const days = Array.from({ length: n }, (_, i) => addDays(first, i));
      const today = startOfDay(new Date());
      const spans = allSpans();
      const banners = spans.filter((s) => s.banner);
      const timed = spans.filter((s) => !s.banner);
      const { bars, lanes } = layoutBars(banners, first, n);
      const cols = `var(--gutter) repeat(${n}, minmax(var(--colmin), 1fr))`;
      const wrap = h('div', { class: 'tg', style: { '--cols': cols, '--minw': 'calc(var(--gutter) + ' + n + ' * var(--colmin))' } });
      applyZoomVars(wrap);

      const head = h('div', { class: 'tg-row tg-headrow' }, h('div', { class: 'tg-gutter kw-cell' }, view === 'week' && state.settings.weekNumbers ? `KW ${isoWeek(first)}` : ''),
        days.map((d) => h('div', { class: `tg-dayhead ${sameDay(d, today) ? 'today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}` },
          h('button', { type: 'button', class: 'dh-btn', 'aria-label': `${wdLong(d)}, ${fmtDate(d)}${view === 'week' ? ' – Tagesansicht' : ''}`,
            onclick: () => { if (view !== 'week') return; cursor = d; view = 'day'; viewSeg.set('day'); patchSettings({ calView: 'day' }); render(); } },
          h('span', { class: 'dh-wd' }, wdShort(d)), h('span', { class: 'dh-num' }, d.getDate())))));

      const adRows = Math.max(1, lanes);
      const allday = h('div', { class: 'tg-row tg-alldayrow' }, h('div', { class: 'tg-gutter' }, 'ganz-tägig'),
        h('div', { class: 'ad-area', style: { gridColumn: `2 / span ${n}` } },
          h('div', { class: 'ad-cells', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } }, days.map((d) => h('div', { class: `ad-cell ${sameDay(d, today) ? 'today' : ''}`, dataset: { date: dayKey(d) },
            onclick: () => openItemDialog({ defaults: { start: dayKey(d) } }) }))),
          h('div', { class: 'ad-bars', style: { gridTemplateColumns: `repeat(${n}, 1fr)`, gridTemplateRows: `repeat(${adRows}, var(--bar-h))` } }, bars.map((b) => bar_(b)))));

      const gutter = h('div', { class: 'tg-gutter hours' }, Array.from({ length: 24 }, (_, hr) => h('div', { class: 'hr', style: { top: `calc(${hr} * var(--hh))` } }, hr ? `${pad(hr)}:00` : '')));
      const colEls = days.map((d, ci) => {
        const dayStart = d.getTime(), dayEnd = addDays(d, 1).getTime();
        const evs = timed.filter((s) => s.a < dayEnd && s.b > dayStart).map((s) => ({ ...s, ca: Math.max(s.a, dayStart), cb: Math.min(s.b, dayEnd) }));
        // Überlappungen in Spalten verteilen (je zusammenhängender Gruppe)
        let cluster = [], clusterEnd = 0, colEnds = [];
        const flush = () => { cluster.forEach((e) => { e.cols = colEnds.length; }); cluster = []; colEnds = []; };
        for (const e of evs) {
          if (e.ca >= clusterEnd) { flush(); clusterEnd = 0; }
          let c = colEnds.findIndex((end) => end <= e.ca);
          if (c < 0) { c = colEnds.length; colEnds.push(0); }
          colEnds[c] = e.cb; e.col = c; cluster.push(e); clusterEnd = Math.max(clusterEnd, e.cb);
        }
        flush();
        const col = h('div', { class: `tg-col ${sameDay(d, today) ? 'today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}`, dataset: { date: dayKey(d) } },
          evs.map((e) => evEl(e, d)));
        col.addEventListener('click', (ev) => {
          if (ev.target !== col) return;
          const y = ev.clientY - col.getBoundingClientRect().top;
          const min = clamp(Math.floor(y / HH * 60 / 30) * 30, 0, 1410);
          const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min), e = new Date(s.getTime() + 60 * MIN);
          openItemDialog({ defaults: { start: toLocal(s, true), end: sameDay(s, e) ? toLocal(e, true) : null } });
        });
        return col;
      });
      const body = h('div', { class: 'tg-row tg-body' }, gutter, colEls);
      wrap.append(h('div', { class: 'tg-top' }, head, allday), body);
      main.replaceChildren(wrap);
      attachNowLine(wrap, days);
      wrap.addEventListener('scroll', () => {}, { passive: true });
      return wrap;
    }

    function evEl(e, day) {
      const it = e.it;
      const topH = (e.ca - day.getTime()) / MIN / 60;               // Stunden ab Mitternacht – die Pixel macht CSS (--hh), so zoomt es ohne Neuaufbau
      const durH = (e.cb - e.ca) / MIN / 60;
      const hgt = Math.max(22, durH * HH - 1);
      const w = 100 / e.cols;
      const startT = fmtTime(new Date(e.a)), endT = e.kind === 'start' ? '' : fmtTime(new Date(e.b));
      const el = h('div', {
        class: `ev ${it.status === 'done' ? 'done' : ''} ${it.priority ? 'p-' + it.priority : ''} ${hgt < 36 ? 'tiny' : ''}`, role: 'button', tabindex: '0', dataset: { id: it.id },
        style: { top: `calc(${topH} * var(--hh))`, height: `max(22px, calc(${durH} * var(--hh) - 1px))`, left: `calc(${e.col * w}% + 1px)`, width: `calc(${w}% - 3px)`, ...catStyle(it) },
        'aria-label': `${titleOf(it.text)}, ${startT}${endT ? ' bis ' + endT : ''}`,
      }, h('div', { class: 'ev-time' }, it.priority ? prioIcon(PRIO_LEVEL[it.priority], { size: 12 }) : null, endT ? `${startT}–${endT}` : startT),
      h('div', { class: 'ev-title' }, titleOf(it.text)),
      h('span', { class: 'rz', 'aria-hidden': 'true', title: 'Dauer ändern' }));
      el.addEventListener('click', () => openItemDialog({ id: it.id }));
      el.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); openItemDialog({ id: it.id }); } });
      dragEvent(el, e, day);
      resizeEvent(el.querySelector('.rz'), el, e, day);
      return el;
    }

    // ---- Verschieben im Zeitraster
    const colsOf = () => [...main.querySelectorAll('.tg-col')];
    const adCells = () => [...main.querySelectorAll('.ad-cell')];
    function hitGrid(x, y, offsetY) {
      const ad = main.querySelector('.ad-area');
      if (ad) {
        const r = ad.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) {
          const c = adCells().find((e) => { const b = e.getBoundingClientRect(); return x >= b.left && x < b.right; });
          if (c) return { type: 'allday', el: c, date: c.dataset.date };
        }
      }
      const col = colsOf().find((e) => { const b = e.getBoundingClientRect(); return x >= b.left && x < b.right; });
      const body = main.querySelector('.tg-body');
      if (!col || !body) return null;
      const br = body.getBoundingClientRect();
      if (y < br.top) return null;
      const cr = col.getBoundingClientRect();
      const min = Math.round(((y - offsetY) - cr.top) / HH * 60 / SNAP) * SNAP;
      return { type: 'time', el: col, date: col.dataset.date, minutes: min };
    }
    let preview = null;
    const clearPreview = () => { preview?.remove(); preview = null; main.querySelectorAll('.drop-over').forEach((e) => e.classList.remove('drop-over')); };
    function showPreview(t, durMin, label) {
      main.querySelectorAll('.drop-over').forEach((e) => e !== t?.el && e.classList.remove('drop-over'));
      if (!t) { preview?.remove(); return; }
      if (t.type === 'allday') { preview?.remove(); t.el.classList.add('drop-over'); return; }
      const minutes = clamp(t.minutes, 0, 1440 - Math.min(durMin, 1440));
      preview ||= h('div', { class: 'ev-preview' });
      if (preview.parentNode !== t.el) t.el.append(preview);
      preview.style.top = `calc(${minutes / 60} * var(--hh))`;
      preview.style.height = `max(22px, calc(${durMin / 60} * var(--hh)))`;
      preview.textContent = label(minutes);
      t.minutes = minutes;
    }
    const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

    function dragEvent(el, e, day) {
      const it = e.it;
      const durMin = Math.round((e.cb - e.ca) / MIN);
      let target = null;
      makeDraggable(el, {
        canStart: (ev) => !ev.target.closest('.rz'),
        scrollers: () => [main.querySelector('.tg')].filter(Boolean),
        onStart() { el.classList.add('drag-src'); },
        onMove(ctx) { target = hitGrid(ctx.x, ctx.y, ctx.offsetY); showPreview(target, durMin, (m) => `${hm(m)}–${hm(Math.min(1440, m + durMin) % 1440 || 0)}`); },
        onEnd(ctx, cancelled) {
          el.classList.remove('drag-src');
          const t = target; clearPreview(); target = null;
          if (cancelled || !t) return;
          const days = dayDiff(day, parseLocal(t.date));
          if (t.type === 'allday') {
            updateItem(it.id, it.start || !it.end ? { start: t.date, end: null } : { start: null, end: t.date });
            return;
          }
          const oldMin = new Date(e.a).getHours() * 60 + new Date(e.a).getMinutes();
          shiftItem(it, days, t.minutes - oldMin);
        },
      });
    }
    function resizeEvent(handle, el, e, day) {
      const it = e.it;
      let endMin = null;
      const startMin = Math.round((e.ca - day.getTime()) / MIN);
      makeDraggable(handle, {
        ghost: false, touchDelay: 60, threshold: 3,
        scrollers: () => [main.querySelector('.tg')].filter(Boolean),
        onStart() { el.classList.add('resizing'); },
        onMove(ctx) {
          const col = el.parentElement.getBoundingClientRect();
          endMin = clamp(Math.round((ctx.y - col.top) / HH * 60 / SNAP) * SNAP, startMin + SNAP, 1440);
          el.style.height = Math.max(22, (endMin - startMin) / 60 * HH - 1) + 'px';
          el.querySelector('.ev-time').textContent = `${hm(startMin)}–${hm(endMin === 1440 ? 1439 : endMin)}`;
        },
        onEnd(ctx, cancelled) {
          el.classList.remove('resizing');
          if (cancelled || endMin == null) { render(); return; }
          const endStr = `${dayKey(day)}T${endMin === 1440 ? '23:59' : hm(endMin)}`;
          updateItem(it.id, { end: endStr, start: it.start || (e.kind === 'end' ? null : it.start) });
          endMin = null;
        },
      });
    }

    function attachNowLine(wrap, days) {
      clearInterval(nowTimer);
      const draw = () => {
        wrap.querySelectorAll('.now-line').forEach((n) => n.remove());
        const now = new Date();
        const idx = days.findIndex((d) => sameDay(d, now));
        if (idx < 0) return;
        const col = wrap.querySelectorAll('.tg-col')[idx];
        col?.append(h('div', { class: 'now-line', style: { top: `calc(${(now.getHours() * 60 + now.getMinutes()) / 60} * var(--hh))` } }));
      };
      draw();
      nowTimer = setInterval(draw, 60000);
    }

    // ================================================================== Seitenleiste „Ohne Termin“
    const unscheduled = () => state.items.filter((i) => !i.start && !i.end && i.status !== 'done')
      .sort((a, b) => (PRIO_LEVEL[b.priority] || 0) - (PRIO_LEVEL[a.priority] || 0) || a.order - b.order);

    function renderSide() {
      const list = unscheduled();
      const show = state.settings.calSidebar && !isNarrow();
      side.hidden = !show;
      unschedBtn.replaceChildren(icon('inbox', { size: 18 }), h('span', { class: 'hide-xs' }, ` Ohne Termin`), h('span', { class: 'badge' }, list.length));
      unschedBtn.setAttribute('aria-expanded', String(show));
      if (!show) return;
      side.replaceChildren(
        h('h3', null, 'Ohne Termin'),
        h('p', { class: 'hint' }, 'In den Kalender ziehen, um einen Termin zu setzen.'),
        list.length ? h('ul', { class: 'unsched' }, list.map((it) => {
          const li = h('li', { class: `unsched-item ${it.priority ? 'p-' + it.priority : ''}`, tabindex: '0', role: 'button', dataset: { id: it.id }, style: catStyle(it) },
            it.priority ? prioIcon(PRIO_LEVEL[it.priority], { size: 13 }) : null, h('span', null, titleOf(it.text)));
          li.addEventListener('click', () => openItemDialog({ id: it.id }));
          li.addEventListener('keydown', (k) => { if (k.key === 'Enter') openItemDialog({ id: it.id }); });
          dragUnscheduled(li, it);
          return li;
        })) : h('p', { class: 'empty-small' }, 'Alles hat einen Termin. 🎉'));
    }
    function dragUnscheduled(li, it) {
      let target = null;
      makeDraggable(li, {
        scrollers: () => [main.querySelector('.tg'), scroller()].filter(Boolean),
        onStart() { li.classList.add('drag-src'); },
        onMove(ctx) {
          if (view === 'month') {
            const t = document.elementsFromPoint(ctx.x, ctx.y).find((e) => e.classList?.contains('mday')) || null;
            main.querySelectorAll('.mday.drop-over').forEach((c) => c !== t && c.classList.remove('drop-over'));
            t?.classList.add('drop-over'); target = t ? { type: 'allday', date: t.dataset.date } : null;
          } else {
            target = hitGrid(ctx.x, ctx.y, 0);
            showPreview(target, 60, (m) => `${hm(m)}–${hm(Math.min(1439, m + 60))}`);
          }
        },
        onEnd(ctx, cancelled) {
          li.classList.remove('drag-src');
          const t = target; target = null;
          clearPreview(); main.querySelectorAll('.mday.drop-over').forEach((c) => c.classList.remove('drop-over'));
          if (cancelled || !t) return;
          if (t.type === 'allday') updateItem(it.id, { start: t.date });
          else {
            const s = parseLocal(t.date); s.setMinutes(t.minutes);
            const e = new Date(s.getTime() + 60 * MIN);
            updateItem(it.id, { start: toLocal(s, true), end: sameDay(s, e) ? toLocal(e, true) : null });
          }
        },
      });
    }
    function openUnscheduledSheet() {
      const list = unscheduled();
      const m = openModal({
        title: `Ohne Termin (${list.length})`, cls: 'small',
        body: list.length ? h('ul', { class: 'unsched sheet' }, list.map((it) => h('li', null, h('button', { class: 'unsched-item', type: 'button', style: catStyle(it),
          onclick: () => { m.close(); openItemDialog({ id: it.id }); } }, it.priority ? prioIcon(PRIO_LEVEL[it.priority], { size: 13 }) : null, h('span', null, titleOf(it.text))))))
          : h('p', { class: 'empty-small' }, 'Alles hat einen Termin. 🎉'),
        footer: h('span', { class: 'hint' }, 'Tippe ein Element an und lege Start oder Ende fest.'),
      });
    }

    // ================================================================== Render
    function render() {
      const sc = main.querySelector('.tg');
      const keepTop = sc ? sc.scrollTop : null;
      const keepLeft = sc ? sc.scrollLeft : null;
      const keepView = scroller().scrollTop;
      setTitle();
      root.dataset.view = view;
      viewSeg.set(view);
      zoomGroup.hidden = view === 'month';
      zoom = clamp(+state.settings.calZoom || zoom, Z_MIN, Z_MAX);
      if (view === 'month') { clearInterval(nowTimer); renderMonth(); } else renderGrid();
      renderSide();
      if (view !== 'month') {
        const g = main.querySelector('.tg');
        if (g) {
          if (keepTop != null) { g.scrollTop = keepTop; g.scrollLeft = keepLeft || 0; }
          else {
            const now = new Date();
            const showsToday = sameDay(cursor, now) || (view === 'week' && dayDiff(startOfWeek(cursor), now) >= 0 && dayDiff(startOfWeek(cursor), now) < 7);
            const hr = showsToday ? Math.max(0, now.getHours() - 1) : 7;
            g.scrollTop = hr * HH;
          }
        }
      } else scroller().scrollTop = keepView;
    }
    render();
    const onResize = () => render();
    window.addEventListener('resize', onResize);
    return {
      update(kinds) { if (kinds.has('items') || kinds.has('categories') || kinds.has('settings')) render(); },
      newItem() { openItemDialog({ defaults: { start: dayKey(cursor) } }); },
      destroy() { clearInterval(nowTimer); window.removeEventListener('resize', onResize); },
    };
  },
};
