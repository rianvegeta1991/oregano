// Kleine Helfer: DOM-Bau, Datum (de-DE, Montag als Wochenbeginn, 24 h), IDs.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Baut ein Element. Kinder: Strings, Nodes, Arrays (verschachtelt), null/false werden übersprungen.
 *  Texte gehen immer über Textknoten – nie als HTML (kein XSS). `html` ist nur für statische Icons. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendKids(el, kids);
  return el;
}
function appendKids(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) appendKids(el, k);
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
// replaceChildren/append machen aus null/false/undefined sonst den Text „null“ – hier wie in h() überspringen
for (const name of ['replaceChildren', 'append']) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...nodes) {
    return orig.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false));
  };
}
export const clear =(el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  f.cancel = () => clearTimeout(t);
  return f;
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- Datum
// Datumswerte werden als lokale Strings gespeichert: 'YYYY-MM-DD' (ganztägig) oder 'YYYY-MM-DDTHH:mm'.
// So gibt es keine Zeitzonen-Verschiebung, egal wo das Backup wieder eingelesen wird.

export const pad = (n) => String(n).padStart(2, '0');
export const MIN = 60000, HOUR = 3600000, DAY = 86400000;

export const hasTime = (s) => !!s && s.length > 10;
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeKey = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toLocal = (d, withTime) => withTime ? `${dayKey(d)}T${timeKey(d)}` : dayKey(d);

export function parseLocal(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
}
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMonths = (d, n) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last), d.getHours(), d.getMinutes());
};
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** Tage zwischen zwei Kalendertagen (DST-sicher). */
export const dayDiff = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
/** Montag der Woche. */
export function startOfWeek(d) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}
/** ISO-8601-Kalenderwoche. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / DAY + 1) / 7);
}

const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MON_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const MON_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const wdShort = (d) => WD_SHORT[d.getDay()];
export const wdLong = (d) => WD_LONG[d.getDay()];
export const monShort = (d) => MON_SHORT[d.getMonth()];
export const monLong = (d) => MON_LONG[d.getMonth()];

/** 13.10.2026 */
export const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
/** 13.10. */
export const fmtDM = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
/** Di., 13.10.2026 */
export const fmtDateWd = (d) => `${wdShort(d)}, ${fmtDate(d)}`;
/** 14:30 – immer 24 Stunden */
export const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

/** Kompakte Anzeige eines gespeicherten Strings: „Di. 13.10." bzw. „Di. 13.10. 14:30". */
export function fmtStored(s, { year = false } = {}) {
  const d = parseLocal(s);
  if (!d) return '';
  const base = `${wdShort(d)} ${year ? fmtDate(d) : fmtDM(d)}`;
  return hasTime(s) ? `${base} ${fmtTime(d)}` : base;
}
/** „Heute“, „Morgen“, „Gestern“ oder Datum. */
export function relDay(d, now = new Date()) {
  const n = dayDiff(now, d);
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n === -1) return 'Gestern';
  return `${wdShort(d)} ${fmtDM(d)}`;
}
export function fmtDuration(min) {
  if (min < 60) return `${min} Min.`;
  if (min < 1440) {
    const h2 = Math.floor(min / 60), m = min % 60;
    return m ? `${h2} Std. ${m} Min.` : `${h2} Std.`;
  }
  const d = Math.floor(min / 1440);
  return d === 1 ? '1 Tag' : `${d} Tage`;
}

/** Tolerantes Parsen von Eingaben. Gibt 'YYYY-MM-DD' zurück, '' (leer) oder null (ungültig). */
export function parseDateInput(text, now = new Date()) {
  const s = (text || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'heute') return dayKey(now);
  if (s === 'morgen') return dayKey(addDays(now, 1));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[./\-\s](\d{1,2})(?:[./\-\s](\d{2}|\d{4})?)?\.?$/.exec(s);
    if (m) {
      d = +m[1]; mo = +m[2];
      y = m[3] ? +m[3] : now.getFullYear();
      if (m[3] && m[3].length === 2) y += 2000;
    } else if ((m = /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(s))) {
      d = +m[1]; mo = +m[2]; y = +m[3]; if (m[3].length === 2) y += 2000;
    } else return null;
  }
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dayKey(dt);
}
/** 'YYYY-MM-DD' → 'TT.MM.JJJJ' */
export function dateToField(key) {
  const d = parseLocal(key);
  return d ? fmtDate(d) : '';
}
/** '9' → '09:00', '930' → '09:30', '9.30'/'9:30' → '09:30'. '' leer, null ungültig. */
export function parseTimeInput(text) {
  const s = (text || '').trim().replace(/\s*uhr$/i, '');
  if (!s) return '';
  let m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  let hh, mm;
  if (m) { hh = +m[1]; mm = +m[2]; }
  else if ((m = /^(\d{1,2})$/.exec(s))) { hh = +m[1]; mm = 0; }
  else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) { hh = +m[1]; mm = +m[2]; }
  else return null;
  if (hh > 23 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

// ---------------------------------------------------------------- Text
/** Erste Zeile als Kurztitel. */
export function titleOf(text) {
  const t = (text || '').trim();
  const nl = t.indexOf('\n');
  return (nl === -1 ? t : t.slice(0, nl)).trim() || '(ohne Text)';
}
export const norm = (s) => (s || '').toLocaleLowerCase('de-DE').normalize('NFD').replace(/[̀-ͯ]/g, '');
