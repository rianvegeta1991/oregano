// Erinnerungen und Benachrichtigungen.
//
// Zwei Wege, ein Datenmodell:
//  • NATIV (Capacitor, Android/iOS): Erinnerungen werden als lokale Benachrichtigungen beim Betriebssystem
//    eingeplant – sie kommen auch bei geschlossener App, mit mitgeliefertem Klingelton (sounds/oregano.wav,
//    beim Bauen nach res/raw kopiert) und den Aktionen „Erledigt“ / „Später erinnern (10 Min.)“.
//  • WEB/PWA: Ein Browser kann bei geschlossener App nichts zuverlässig einplanen. Solange die App (oder der
//    Hintergrund-Tab) läuft, prüft ein Takt alle 10 s auf Fälliges und zeigt eine System-Benachrichtigung
//    (über den Service Worker, ebenfalls mit den beiden Aktionen) plus ein Banner in der App mit Ton.
//
// Erledigte Elemente lösen nichts mehr aus; Ändern/Löschen plant automatisch neu (Abo auf den Store).

import { h, MIN, parseLocal, titleOf, fmtDateTime, debounce, uid } from './util.js';
import { state, subscribe, updateItem, getItem, setSnoozes, setFired } from './store.js';
import { reminderTime } from './reminders.js';
import { openModal, toast } from './ui.js';
import { icon } from './icons.js';

const SNOOZE_MIN = 10;
const MAX_NATIVE = 60;          // iOS erlaubt höchstens 64 geplante lokale Benachrichtigungen
const SOUND_FILE = 'oregano.wav';
const CH_SOUND = 'oregano-ton', CH_SILENT = 'oregano-leise';
const ACTION_TYPE = 'OREGANO_REMINDER';

// ------------------------------------------------------------------ Umgebung
let LN = null;           // Capacitor-LocalNotifications-Plugin (nur nativ)
let nativeReady = false;
export const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

async function loadCapacitorCore() {
  if (window.Capacitor?.Plugins || !/; wv\)|Capacitor/i.test(navigator.userAgent)) return;
  // Bei reinem Web-Stand ohne Bundler liefert der native Build capacitor.js neben die Seite (siehe Workflow).
  await new Promise((res) => { const s = document.createElement('script'); s.src = 'capacitor.js'; s.onload = s.onerror = res; document.head.append(s); });
}
export async function initNative() {
  if (nativeReady) return isNative();
  await loadCapacitorCore();
  if (!isNative()) return false;
  try {
    LN = window.Capacitor.Plugins?.LocalNotifications || window.Capacitor.registerPlugin?.('LocalNotifications');
    if (!LN) return false;
    await LN.registerActionTypes({ types: [{ id: ACTION_TYPE, actions: [
      { id: 'done', title: 'Erledigt' },
      { id: 'snooze', title: `Später erinnern (${SNOOZE_MIN} Min.)` },
    ] }] });
    // Ab Android 8 gehört der Ton zum Kanal, nicht zur einzelnen Benachrichtigung.
    await LN.createChannel?.({ id: CH_SOUND, name: 'Erinnerungen mit Klingelton', description: 'Oregano-Erinnerungen mit kurzem Ton', importance: 4, sound: SOUND_FILE, vibration: true });
    await LN.createChannel?.({ id: CH_SILENT, name: 'Erinnerungen (leise)', description: 'Oregano-Erinnerungen ohne Ton', importance: 3, vibration: false });
    await LN.addListener('localNotificationActionPerformed', (ev) => {
      const extra = ev.notification?.extra || {};
      handleAction(ev.actionId, extra.itemId, extra.sound);
    });
    nativeReady = true;
  } catch (e) { console.warn('Native Benachrichtigungen nicht verfügbar:', e); LN = null; return false; }
  return true;
}

// ------------------------------------------------------------------ Berechtigung
/** 'granted' | 'denied' | 'default' | 'unsupported' */
export async function permissionState() {
  if (isNative() && LN) {
    try { const r = await LN.checkPermissions(); return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'default'; }
    catch { return 'unsupported'; }
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
async function requestPermission() {
  if (isNative() && LN) {
    const r = await LN.requestPermissions();
    return r.display === 'granted' ? 'granted' : 'denied';
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}
let asking = null;
/** Freundliche Vorab-Erklärung, dann erst die System-Abfrage. Fragt nie zweimal nach, wenn schon entschieden. */
export function ensureNotifyPermission() {
  if (asking) return asking;
  asking = (async () => {
    const st = await permissionState();
    if (st !== 'default') {
      if (st === 'denied') toast('Benachrichtigungen sind blockiert. Erlaube sie in den Einstellungen deines Geräts oder in Oregano → Einstellungen → Erinnerungen.', { timeout: 9000 });
      return st;
    }
    const ok = await new Promise((resolve) => {
      let answered = false;
      const done = (v) => { if (!answered) { answered = true; m.close(); resolve(v); } };
      const m = openModal({
        title: 'Erinnerungen erlauben?', cls: 'small',
        body: h('div', { class: 'perm-intro' }, icon('bell', { size: 36 }),
          h('p', null, 'Damit Oregano dich rechtzeitig erinnern kann, braucht die App deine Erlaubnis für Benachrichtigungen. Gleich fragt dich dein Gerät noch einmal.')),
        footer: [h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Jetzt nicht'),
          h('button', { class: 'btn primary', type: 'button', autofocus: true, onclick: () => done(true) }, 'Erlauben')],
        onClose: () => { if (!answered) { answered = true; resolve(false); } },
      });
    });
    if (!ok) return 'default';
    const res = await requestPermission();
    if (res !== 'granted') toast('Ohne Erlaubnis kann Oregano keine Benachrichtigungen zeigen. Du kannst sie später in den Einstellungen erteilen.', { timeout: 8000 });
    reschedule();
    return res;
  })().finally(() => { asking = null; });
  return asking;
}

// ------------------------------------------------------------------ Fälliges berechnen
const hash32 = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0; return Math.abs(x) % 2147483000 + 1; };

/** Alle aktiven Erinnerungen als flache Liste (inkl. „Später“-Erinnerungen). */
export function collectDue() {
  const out = [];
  for (const it of state.items) {
    if (it.status === 'done') continue;
    for (const r of it.reminders || []) {
      const t = reminderTime(it, r, state.settings.defaultTime);
      if (!t) continue;
      out.push({ key: `${it.id}:${r.id}:${t.getTime()}`, itemId: it.id, at: t.getTime(), sound: !!r.sound });
    }
  }
  for (const s of state.snoozes) {
    const it = getItem(s.itemId);
    if (it && it.status !== 'done') out.push({ key: s.key, itemId: s.itemId, at: s.at, sound: !!s.sound, snooze: true });
  }
  return out.sort((a, b) => a.at - b.at);
}
const bodyFor = (it, at) => {
  const lines = it.text.trim().split('\n').slice(1).join(' ').trim();
  const when = it.end || it.start;
  return [lines, when ? `Fällig: ${fmtDateTime(parseLocal(when.length > 10 ? when : when + 'T00:00')).replace(' 00:00', '')}` : ''].filter(Boolean).join(' · ') || 'Erinnerung';
};

// ------------------------------------------------------------------ Planung
let known = new Set();       // Schlüssel, die seit dem Start schon gesehen wurden
let started = false;
const reschedule = debounce(async () => {
  const due = collectDue();
  const now = Date.now();
  if (nativeReady && LN) {
    try {
      const pending = await LN.getPending();
      if (pending.notifications?.length) await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      const future = due.filter((d) => d.at > now + 2000).slice(0, MAX_NATIVE);
      if (future.length) {
        await LN.schedule({ notifications: future.map((d) => {
          const it = getItem(d.itemId);
          return {
            id: hash32(d.key), title: titleOf(it.text), body: bodyFor(it, d.at),
            schedule: { at: new Date(d.at), allowWhileIdle: true },
            channelId: d.sound ? CH_SOUND : CH_SILENT, sound: d.sound ? SOUND_FILE : undefined,
            actionTypeId: ACTION_TYPE, extra: { itemId: d.itemId, sound: d.sound, key: d.key },
          };
        }) });
      }
    } catch (e) { console.warn('Planen fehlgeschlagen', e); }
    return;
  }
  // Web: Neues, das schon in der Vergangenheit liegt, gilt als erledigt (nicht nachträglich feuern).
  let changed = false;
  const fired = { ...state.fired };
  for (const d of due) {
    if (!known.has(d.key)) { known.add(d.key); if (started && d.at <= now && !fired[d.key]) { fired[d.key] = now; changed = true; } }
  }
  for (const k of Object.keys(fired)) if (now - fired[k] > 14 * 86400000) { delete fired[k]; changed = true; }
  if (changed) setFired(fired);
}, 400);
export { reschedule };

// ------------------------------------------------------------------ Web-Takt
let tickTimer = 0;
const shownBanners = new Map();
function tick() {
  if (nativeReady) return;
  const now = Date.now();
  const fired = { ...state.fired };
  let changed = false;
  for (const d of collectDue()) {
    if (d.at > now || fired[d.key]) continue;
    if (now - d.at > 24 * 3600000) { fired[d.key] = now; changed = true; continue; }  // zu alt: still verwerfen
    fired[d.key] = now; changed = true;
    if (d.snooze) setSnoozes(state.snoozes.filter((s) => s.key !== d.key));
    fireWeb(d);
  }
  if (changed) setFired(fired);
}
async function fireWeb(d) {
  const it = getItem(d.itemId);
  if (!it) return;
  if (d.sound) playSound();
  showBanner(it, d);
  if ('Notification' in window && Notification.permission === 'granted') {
    const opts = {
      body: bodyFor(it, d.at), tag: d.key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      data: { itemId: it.id, sound: d.sound }, silent: true, requireInteraction: false,
      actions: [{ action: 'done', title: 'Erledigt' }, { action: 'snooze', title: `Später (${SNOOZE_MIN} Min.)` }],
    };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(titleOf(it.text), opts);
      else new Notification(titleOf(it.text), opts);
    } catch (e) { console.warn(e); }
  }
}
function showBanner(it, d) {
  shownBanners.get(d.key)?.dismiss();
  const t = toast(titleOf(it.text), {
    persistent: true,
    extra: h('span', { class: 'toast-actions' },
      icon('bell', { size: 16 }),
      h('button', { class: 'btn small ghost-inv', type: 'button', onclick: () => { handleAction('done', it.id); t.dismiss(); } }, 'Erledigt'),
      h('button', { class: 'btn small ghost-inv', type: 'button', onclick: () => { handleAction('snooze', it.id, d.sound); t.dismiss(); } }, `+${SNOOZE_MIN} Min.`)),
  });
  shownBanners.set(d.key, t);
}

let audio = null;
export function playSound() {
  try {
    audio ||= new Audio('sounds/oregano.wav');
    audio.currentTime = 0;
    audio.volume = 0.8;
    audio.play().catch(() => {});
  } catch { /* Autoplay gesperrt – Banner/Benachrichtigung genügen */ }
}

// ------------------------------------------------------------------ Aktionen aus Benachrichtigung / Banner
export function handleAction(action, itemId, sound) {
  const it = getItem(itemId);
  if (!it) return;
  if (action === 'done') {
    updateItem(itemId, { status: 'done' });
    toast(`Erledigt: „${titleOf(it.text).slice(0, 40)}“`, { actionLabel: 'Rückgängig', onAction: () => updateItem(itemId, { status: it.status }) });
  } else if (action === 'snooze') {
    const at = Date.now() + SNOOZE_MIN * MIN;
    setSnoozes([...state.snoozes, { key: `snooze:${uid()}`, itemId, at, sound: sound !== false }]);
    toast(`Ich erinnere dich in ${SNOOZE_MIN} Minuten wieder.`);
    reschedule();
  }
}

// ------------------------------------------------------------------ Test aus den Einstellungen
export async function sendTestNotification() {
  const st = await permissionState();
  if (st !== 'granted') { const r = await ensureNotifyPermission(); if (r !== 'granted') return false; }
  if (nativeReady && LN) {
    await LN.schedule({ notifications: [{ id: hash32('test' + Date.now()), title: 'Oregano', body: 'So klingt eine Erinnerung.',
      schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true }, channelId: CH_SOUND, sound: SOUND_FILE, actionTypeId: ACTION_TYPE }] });
    return true;
  }
  playSound();
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: 'So sieht eine Erinnerung aus.', icon: 'icons/icon-192.png', silent: true, tag: 'oregano-test' };
    if (reg) await reg.showNotification('Oregano', opts); else new Notification('Oregano', opts);
  } catch (e) { console.warn(e); }
  return true;
}

// ------------------------------------------------------------------ Start
export async function startNotifications() {
  await initNative();
  // Aktionen aus dem Service Worker (Web) und aus der URL (App wurde per Klick auf Aktion neu geöffnet)
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'reminder-action') handleAction(e.data.action, e.data.itemId, e.data.sound);
  });
  const p = new URLSearchParams(location.search);
  if (p.get('act') && p.get('item')) {
    handleAction(p.get('act'), p.get('item'));
    history.replaceState(null, '', location.pathname + location.hash);
  }
  collectDue().forEach((d) => known.add(d.key));
  subscribe((kinds) => { if (kinds.has('items') || kinds.has('settings')) reschedule(); });
  if (nativeReady) reschedule();
  else {
    tick();             // verpasste Erinnerungen der letzten 24 h nachholen
    tickTimer = setInterval(tick, 10000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  }
  started = true;
}
