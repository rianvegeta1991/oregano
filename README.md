# Oregano 🌿

Organizer für **ToDos, Kalender, Kanban-Board und Listen** – offline-first, auf Deutsch, für Handy und Desktop.

- **Live (PWA):** https://rianvegeta1991.github.io/oregano/ – im Browser öffnen und „Installieren“ wählen
- **Handy-App (Android):** APK aus dem Actions-Lauf „Android-App bauen“ bzw. von der Releases-Seite
- Alle Daten bleiben **lokal auf dem Gerät** (IndexedDB). Sicherung/Wiederherstellung als JSON-Datei in den Einstellungen.

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Übersicht** | Schnelleingabe (Text, Enter), Filter nach Kategorie / Priorität / Status / Fälligkeit, Sortierung nach Fälligkeit oder Priorität |
| **Kalender** | Tag / Woche / Monat, Kalenderwochen, mehrtägige Balken, Klick auf freie Fläche legt an, Drag & Drop (Verschieben, in Tag/Woche auch Dauer ziehen), Seitenleiste „Ohne Termin“ |
| **Board** | Spalten Backlog · Zu erledigen · In Arbeit · Erledigt, Swimlane je Kategorie (einklappbar, sortierbar, auch leer sichtbar), Karten ziehen ändert Status bzw. Kategorie |
| **Listen** | *Tabellenliste* (Standard „Einkaufsliste“, freie Spalten, Abhaken sortiert nach unten, „Erledigte entfernen“ mit Rückgängig) und *Kachelliste* (Standard „Ideenliste“, Masonry, Reihenfolge per Drag & Drop, Kachel → ToDo) |
| **Erinnerungen** | bis zu 2 pro Element, absolut oder relativ zu Start/Ende, wahlweise mit Klingelton; Aktionen „Erledigt“ und „Später erinnern (10 Min.)“ |
| **Suche** | über Elemente und Listeneinträge – `/` oder `Strg+K` |
| **Themes** | Hell · Dunkel · Beige · Pastellblau · Cyberpunk · Bauhaus, dazu „System folgen“ |

Tastatur: `n` neues Element, `/` Suche. Im Board verschiebt `Alt` + Pfeiltasten die fokussierte Karte.
Format: de-DE, Wochenbeginn Montag, 24-Stunden-Zeit.

## Wo kommen Erinnerungen an?

| Umgebung | Verhalten |
|---|---|
| **Android-App** | Echte lokale Benachrichtigungen des Betriebssystems – auch bei **geschlossener App**, mit mitgeliefertem Ton (`www/sounds/oregano.wav`, ~1,5 s) und den beiden Aktionen. |
| **PWA im Browser** | Ein Browser kann bei geschlossener Seite nichts zuverlässig einplanen. Solange Oregano offen ist (auch als Hintergrund-Tab), kommen Systembenachrichtigung **und** ein Banner in der App; verpasste Erinnerungen der letzten 24 h werden beim Öffnen nachgeholt. |
| **iOS** | Gleiche Logik wie Android über Capacitor, aber der Build braucht einen Mac (siehe unten). Als PWA gilt die Browser-Zeile. |

## Entwicklung

Die App ist bewusst **ohne Build-Schritt** gebaut (reines HTML/CSS/JavaScript mit ES-Modulen, keine Abhängigkeiten) –
`www/` ist direkt lauffähig. Lokaler Server (Windows, kein Node nötig):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8799
```

→ http://localhost:8799/

Aufbau von `www/js/`:

| Datei | Aufgabe |
|---|---|
| `db.js` | **Repository-Schicht** (IndexedDB, Notnagel im Arbeitsspeicher). Einzige Stelle, die Speicherorte kennt – hier hängt später eine Cloud-Synchronisation an. |
| `store.js` | Zustand + alle Änderungen (Elemente, Kategorien, Listen, Einträge, Backup), Schreib-Warteschlange |
| `reminders.js`, `notify.js` | Erinnerungsmodell, Planung (nativ bzw. Web), Berechtigung, Aktionen |
| `itemdialog.js` | der eine Bearbeitungsdialog für alle Ansichten (Bottom-Sheet auf dem Handy) |
| `overview.js` · `calendar.js` · `board.js` · `lists.js` · `settings.js` · `search.js` | die Ansichten |
| `dnd.js` | Drag & Drop per Pointer-Events (Maus, Touch mit Gedrückthalten, Stift) |
| `ui.js`, `util.js`, `icons.js` | Dialoge, Combobox, Datum/Zeit-Felder, Helfer, Icons |

Design-Tokens (alle Farben, Schriften, Radien, Schatten) stehen in `www/css/themes.css`. Kontraste prüfen (WCAG AA):

```
python tools/kontrast.py
```

Icons/Ton neu erzeugen: `tools/icons.ps1` (PNG aus dem Logo) und `python tools/sound.py` (Erinnerungston).

## Veröffentlichen

- **PWA:** jeder Push auf `main` stößt `.github/workflows/pages.yml` an (Ordner `www/` geht 1:1 online).
  Einmalig nach dem Anlegen des Repos: Pages auf „GitHub Actions“ stellen
  (`gh api -X POST repos/OWNER/oregano/pages -f build_type=workflow`).
- **Android-APK:** Actions → *Android-App bauen* → *Run workflow*. Das Skript installiert Node/Java in der Cloud,
  legt das Capacitor-Projekt an, erzeugt Icons/Splash aus `assets/`, kopiert den Klingelton nach `res/raw`,
  ergänzt die Berechtigungen und baut `oregano-debug.apk` (Artefakt am Lauf; bei einem Tag `v*` zusätzlich am Release).
  Auf dem Handy: APK öffnen, „Aus dieser Quelle installieren“ erlauben. Beim ersten Erinnerungs-Anlegen die
  Benachrichtigungs-Erlaubnis bestätigen.
- **iOS:** auf einem Mac mit Xcode: `npm install`, `npx cap add ios`, `npx capacitor-assets generate --ios`,
  `www/sounds/oregano.wav` zum App-Ziel hinzufügen, `npx cap sync ios`, `npx cap open ios` – signieren und installieren.

## Hinweise zur Qualität

Geprüft sind PWA-Oberfläche, Datenhaltung, Drag & Drop, Erinnerungs-Banner und alle Themes im Browser.
Der **native Teil (Capacitor, Benachrichtigungen bei geschlossener App) wird in der Cloud gebaut, aber nicht
automatisch auf einem Gerät getestet** – bei Problemen bitte `adb logcat | findstr -i oregano` ansehen.
