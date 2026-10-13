// Einstellungen: Themes (mit Live-Vorschau), Erinnerungen, Kalender, Kategorien, Datensicherung, Info.

import { h, dayKey, uid } from './util.js';
import { icon } from './icons.js';
import { confirmDialog, toast, timeField } from './ui.js';
import {
  state, THEMES, CAT_COLORS, patchSettings, updateCategory, deleteCategory, moveCategory, ensureCategory, exportData, importData,
  backupSummary, validateBackup, resetAll,
} from './store.js';
import { permissionState, ensureNotifyPermission, sendTestNotification, isNative } from './notify.js';
import { VERSION, REPO_URL } from './version.js';

function section(title, ...kids) {
  const id = 'sec-' + uid().slice(0, 5);
  return h('section', { class: 'card-sec', 'aria-labelledby': id }, h('h2', { id }, title), ...kids);
}
function toggle(label, checked, onChange, hint) {
  const i = h('input', { type: 'checkbox', role: 'switch', checked });
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 'switch-row' }, h('span', { class: 'sw-text' }, h('span', null, label), hint ? h('span', { class: 'hint' }, hint) : null), i, h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

/** Mini-Oberfläche, die mit den Tokens des jeweiligen Themes gezeichnet wird. */
function themePreview(id) {
  return h('div', { class: 'tp', 'data-theme': id, 'aria-hidden': 'true' },
    h('div', { class: 'tp-bar' }, h('span', { class: 'tp-dot' }), h('span', { class: 'tp-line w40' })),
    h('div', { class: 'tp-body' },
      h('div', { class: 'tp-card' }, h('span', { class: 'tp-line w70' }), h('span', { class: 'tp-line w40 soft' })),
      h('div', { class: 'tp-card hot' }, h('span', { class: 'tp-line w60' }), h('span', { class: 'tp-chip' })),
      h('div', { class: 'tp-btn' }))
  );
}

export const settingsView = {
  title: 'Einstellungen',
  mount(host, params, app) {
    const root = h('div', { class: 'view settings' });
    host.append(root);
    let permEl, catsEl;

    // ---------------------------------------------------------------- Darstellung
    const themeGrid = h('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Theme' });
    function drawThemes() {
      themeGrid.replaceChildren();
      for (const group of ['Schlicht', 'Stylisch']) {
        themeGrid.append(h('h3', { class: 'grp' }, group));
        const row = h('div', { class: 'theme-row' });
        for (const t of THEMES.filter((x) => x.group === group)) {
          const on = !state.settings.followSystem && state.settings.theme === t.id;
          row.append(h('button', { class: `theme-card ${on ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(on),
            onclick: () => patchSettings({ theme: t.id, followSystem: false }) }, themePreview(t.id), h('span', { class: 'tc-name' }, on ? icon('check', { size: 14 }) : null, t.name)));
        }
        themeGrid.append(row);
      }
    }
    const follow = toggle('System folgen', state.settings.followSystem, (v) => {
      patchSettings({ followSystem: v, theme: v ? state.settings.theme : state.settings.theme });
    }, 'Wechselt automatisch zwischen Hell und Dunkel – passend zur Einstellung deines Geräts.');

    // ---------------------------------------------------------------- Erinnerungen
    permEl = h('div', { class: 'perm-state', 'aria-live': 'polite' });
    async function drawPerm() {
      const st = await permissionState();
      const txt = { granted: 'Benachrichtigungen sind erlaubt.', denied: 'Benachrichtigungen sind blockiert. Erlaube sie in den Einstellungen deines Geräts (App-Info → Benachrichtigungen bzw. Website-Einstellungen im Browser), damit Erinnerungen ankommen.',
        default: 'Du wurdest noch nicht gefragt. Beim ersten Anlegen einer Erinnerung fragt Oregano freundlich nach.', unsupported: 'Dieses Gerät oder dieser Browser unterstützt keine Benachrichtigungen. Erinnerungen erscheinen dann nur als Hinweis in der geöffneten App.' }[st];
      permEl.replaceChildren(h('div', { class: `perm ${st}` }, icon(st === 'granted' ? 'check' : st === 'denied' ? 'alert' : 'bell', { size: 18 }), h('span', null, txt)),
        st === 'default' ? h('button', { class: 'btn small', type: 'button', onclick: async () => { await ensureNotifyPermission(); drawPerm(); } }, 'Jetzt erlauben') : null,
        st === 'granted' ? h('button', { class: 'btn small', type: 'button', onclick: async () => { await sendTestNotification(); toast('Testbenachrichtigung gesendet'); } }, 'Test senden') : null);
    }
    const defTime = timeField({ value: state.settings.defaultTime, label: 'Uhrzeit für ganztägige Termine', onChange: () => { const v = defTime.get(); if (v) patchSettings({ defaultTime: v }); } });

    // ---------------------------------------------------------------- Kategorien
    catsEl = h('div', { class: 'cat-list' });
    function drawCats() {
      catsEl.replaceChildren(...state.categories.map((c, i) => {
        const count = state.items.filter((x) => x.categoryId === c.id).length;
        const name = h('input', { class: 'input', type: 'text', value: c.name, 'aria-label': `Name der Kategorie ${c.name}` });
        name.addEventListener('change', () => { if (updateCategory(c.id, { name: name.value }) === false) { name.value = c.name; toast('Dieser Name ist leer oder schon vergeben.'); } });
        const sw = h('details', { class: 'color-pick' },
          h('summary', { 'aria-label': `Farbe von ${c.name} ändern` }, h('span', { class: 'dot big', style: { background: c.color } })),
          h('div', { class: 'color-pop' }, CAT_COLORS.map((col) => h('button', { type: 'button', class: `dot big pick ${col === c.color ? 'on' : ''}`, style: { background: col }, 'aria-label': `Farbe ${col}`,
            onclick: () => updateCategory(c.id, { color: col }) }))));
        return h('div', { class: 'cat-row' }, sw, name, h('span', { class: 'hint count' }, count === 1 ? '1 Element' : `${count} Elemente`),
          h('button', { class: 'btn icon ghost', type: 'button', disabled: i === 0, 'aria-label': `${c.name} nach oben`, onclick: () => moveCategory(c.id, -1) }, icon('up', { size: 16 })),
          h('button', { class: 'btn icon ghost', type: 'button', disabled: i === state.categories.length - 1, 'aria-label': `${c.name} nach unten`, onclick: () => moveCategory(c.id, 1) }, icon('down', { size: 16 })),
          h('button', { class: 'btn icon ghost danger-ghost', type: 'button', 'aria-label': `${c.name} löschen`, onclick: async () => {
            const ok = await confirmDialog({ title: `Kategorie „${c.name}“ löschen?`, confirmText: 'Löschen', danger: true,
              message: count ? `${count === 1 ? 'Das 1 Element' : `Die ${count} Elemente`} dieser Kategorie ${count === 1 ? 'wird' : 'werden'} auf „Ohne Kategorie“ gesetzt. Die Elemente selbst bleiben erhalten.` : 'Diese Kategorie wird nicht verwendet.' });
            if (ok) deleteCategory(c.id);
          } }, icon('trash', { size: 16 })));
      }), state.categories.length ? null : h('p', { class: 'hint' }, 'Noch keine Kategorien. Sie entstehen automatisch, sobald du einem Element eine gibst – oder lege hier eine an.'));
    }
    const newCat = h('input', { class: 'input', type: 'text', placeholder: 'Neue Kategorie …', 'aria-label': 'Neue Kategorie' });
    const addCat = () => { if (newCat.value.trim()) { ensureCategory(newCat.value); newCat.value = ''; } };
    newCat.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } });

    // ---------------------------------------------------------------- Daten
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const err = validateBackup(obj);
        if (err) { toast(err); return; }
        const ok = await confirmDialog({ title: 'Sicherung einspielen?', confirmText: 'Ersetzen', danger: true,
          message: `Die Datei enthält ${backupSummary(obj)}${obj.exportedAt ? ` (erstellt ${new Date(obj.exportedAt).toLocaleString('de-DE')})` : ''}. Alle aktuellen Daten in Oregano werden dadurch ersetzt.` });
        if (!ok) return;
        await importData(obj);
        toast('Sicherung eingespielt.');
      } catch (e) { console.error(e); toast('Die Datei konnte nicht gelesen werden.'); }
    });
    async function doExport() {
      const json = JSON.stringify(exportData(), null, 2);
      const name = `oregano-sicherung-${dayKey(new Date())}.json`;
      try {
        if (isNative()) {
          const { Filesystem, Share } = window.Capacitor.Plugins;
          const res = await Filesystem.writeFile({ path: name, data: json, directory: 'CACHE', encoding: 'utf8' });
          await Share.share({ title: 'Oregano-Sicherung', url: res.uri, dialogTitle: 'Sicherung speichern' });
          return;
        }
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Sicherung gespeichert.');
      } catch (e) { console.error(e); toast('Export fehlgeschlagen.'); }
    }

    // ---------------------------------------------------------------- Zusammenbau
    const installBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: async () => {
      const p = window.__installPrompt; if (!p) return; p.prompt(); await p.userChoice; window.__installPrompt = null; installBtn.hidden = true;
    } }, icon('download', { size: 18 }), ' App installieren');
    if (window.__installPrompt) installBtn.hidden = false;
    window.addEventListener('beforeinstallprompt', () => { installBtn.hidden = false; }, { once: true });
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isNative();

    root.append(
      section('Darstellung', follow, themeGrid,
        h('p', { class: 'hint' }, 'Ein Tipp auf ein Theme wendet es sofort an – die ganze App ist deine Vorschau.')),
      section('Erinnerungen', permEl,
        h('div', { class: 'field' }, h('label', { for: 'dt-def' }, 'Uhrzeit für ganztägige Termine'), (() => { defTime.input.id = 'dt-def'; return defTime.el; })(),
          h('div', { class: 'hint' }, 'Gilt für Erinnerungen an Elemente, die nur ein Datum, aber keine Uhrzeit haben.')),
        toggle('Neue Erinnerungen mit Klingelton', state.settings.defaultSound, (v) => patchSettings({ defaultSound: v }), 'Der Ton ist kurz und dezent (ca. 2 Sekunden) und lässt sich pro Erinnerung ändern.'),
        isNative() ? null : h('p', { class: 'hint' }, 'Hinweis: Im Browser kommen Erinnerungen nur, solange Oregano geöffnet ist (auch im Hintergrund-Tab). Für Erinnerungen bei geschlossener App nutze die Handy-App.')),
      section('Kalender',
        toggle('Kalenderwochen anzeigen', state.settings.weekNumbers, (v) => patchSettings({ weekNumbers: v })),
        toggle('Erledigte Elemente im Kalender zeigen', state.settings.showDone, (v) => patchSettings({ showDone: v }), 'Sie erscheinen ausgegraut und durchgestrichen.'),
        h('p', { class: 'hint' }, 'Wochenbeginn: Montag · Datumsformat: TT.MM.JJJJ · Uhrzeit: 24-Stunden-Format')),
      section('Kategorien', catsEl, h('div', { class: 'cat-add' }, newCat, h('button', { class: 'btn', type: 'button', onclick: addCat }, icon('plus', { size: 16 }), ' Hinzufügen')),
        h('p', { class: 'hint' }, 'Jede Kategorie ist im Board eine eigene Swimlane.')),
      section('Daten & Sicherung',
        !state.persistent ? h('div', { class: 'perm denied' }, icon('alert', { size: 18 }), h('span', null, 'Achtung: Dein Browser erlaubt hier keinen dauerhaften Speicher. Daten gehen beim Schließen verloren – sichere sie regelmäßig.')) : null,
        h('p', null, 'Alle Daten liegen nur auf diesem Gerät. Eine Sicherung ist eine einzelne JSON-Datei.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: doExport }, icon('download', { size: 18 }), ' Sicherung exportieren'),
          h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, icon('upload', { size: 18 }), ' Sicherung importieren'), fileIn),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn danger-ghost', type: 'button', onclick: async () => {
          const ok = await confirmDialog({ title: 'Alles löschen?', confirmText: 'Alles löschen', danger: true, message: 'Alle Elemente, Kategorien und Listen werden unwiderruflich gelöscht. Exportiere vorher eine Sicherung, falls du etwas behalten willst.' });
          if (ok) { await resetAll(); toast('Alle Daten wurden gelöscht.'); }
        } }, icon('trash', { size: 18 }), ' Alle Daten löschen'))),
      section('Über Oregano',
        h('p', null, `Oregano ${VERSION} – dein Organizer für ToDos, Termine und Listen.`),
        installBtn,
        isIos ? h('p', { class: 'hint' }, 'iPhone/iPad: Tippe in Safari auf „Teilen“ und dann „Zum Home-Bildschirm“, um Oregano als App zu installieren.') : null,
        h('p', { class: 'hint' }, 'Quelltext: ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, REPO_URL.replace('https://', '')))));
    drawThemes(); drawCats(); drawPerm();
    return {
      update(kinds) {
        if (kinds.has('settings')) drawThemes();
        if (kinds.has('categories') || kinds.has('items')) drawCats();
      },
    };
  },
};
