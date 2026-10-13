// Erinnerungen: Datenform und Berechnung des Auslösezeitpunkts (ohne Benachrichtigungs-Technik).
//
// Erinnerung = { id, kind: 'abs' | 'start' | 'end', at: 'YYYY-MM-DDTHH:mm' (nur bei 'abs'),
//                offset: Minuten VOR Start/Ende (nur bei 'start'/'end'), sound: boolean }

import { parseLocal, hasTime, MIN, fmtDateTime, uid } from './util.js';

export const MAX_REMINDERS = 2;

export const OFFSETS = [
  { min: 0, label: 'Zum Zeitpunkt' },
  { min: 5, label: '5 Min. vorher' },
  { min: 10, label: '10 Min. vorher' },
  { min: 15, label: '15 Min. vorher' },
  { min: 30, label: '30 Min. vorher' },
  { min: 60, label: '1 Std. vorher' },
  { min: 120, label: '2 Std. vorher' },
  { min: 1440, label: '1 Tag vorher' },
  { min: 2880, label: '2 Tage vorher' },
  { min: 10080, label: '1 Woche vorher' },
];

export function newReminder(item, sound = true) {
  const kind = item?.start ? 'start' : item?.end ? 'end' : 'abs';
  return { id: uid(), kind, at: '', offset: 15, sound };
}

/** Zeitpunkt als Date – oder null, wenn die Bezugsgröße fehlt. Ganztägige Termine
 *  zählen ab `defaultTime` (Einstellung, Standard 09:00). */
export function reminderTime(item, r, defaultTime = '09:00') {
  if (!r) return null;
  if (r.kind === 'abs') {
    if (!r.at) return null;
    const s = hasTime(r.at) ? r.at : `${r.at}T${defaultTime}`;
    return parseLocal(s);
  }
  const ref = r.kind === 'start' ? item.start : item.end;
  if (!ref) return null;
  const s = hasTime(ref) ? ref : `${ref}T${defaultTime}`;
  const d = parseLocal(s);
  return d ? new Date(d.getTime() - (r.offset || 0) * MIN) : null;
}

export function offsetLabel(min) {
  const o = OFFSETS.find((x) => x.min === min);
  if (o) return o.label;
  if (min % 1440 === 0) return `${min / 1440} Tage vorher`;
  if (min % 60 === 0) return `${min / 60} Std. vorher`;
  return `${min} Min. vorher`;
}

export function describeReminder(item, r, defaultTime) {
  const t = reminderTime(item, r, defaultTime);
  if (r.kind === 'abs') return t ? fmtDateTime(t) : 'Zeitpunkt fehlt';
  const bez = r.kind === 'start' ? 'Start' : 'Ende';
  if (!t) return `${bez} fehlt`;
  return `${offsetLabel(r.offset)} (${bez}) · ${fmtDateTime(t)}`;
}

/** Hat das Element Erinnerungen, die noch etwas auslösen können? (für das Glockensymbol) */
export function hasActiveReminders(item, defaultTime) {
  if (!item.reminders?.length || item.status === 'done') return false;
  return item.reminders.some((r) => !!reminderTime(item, r, defaultTime));
}
