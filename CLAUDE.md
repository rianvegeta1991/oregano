# Oregano

Organizer-App (ToDos, Kalender, Kanban-Board, Listen). **Deutsch ist Quellsprache** (UI, Code-Kommentare, Commits).
Live: https://rianvegeta1991.github.io/oregano/ · Repo: https://github.com/rianvegeta1991/oregano

## Aufbau

- **Kein Node/Build auf dem Rechner.** `www/` ist die App (HTML + CSS + ES-Module, null Abhängigkeiten) und geht 1:1 auf Pages.
  `package.json`/`capacitor.config.json` gibt es nur für den **Android-Build in GitHub Actions** (`android.yml`).
- Lokaler Server: `serve.ps1` (Port **8799**, `.claude/launch.json`-Eintrag `oregano` im übergeordneten Ordner).
- Daten: IndexedDB über `www/js/db.js` (Repository-Schicht – Cloud-Sync später hier einhängen). Alles andere liest/schreibt über `store.js`.
- Datums-Felder werden als **lokale Strings** gespeichert (`YYYY-MM-DD` oder `YYYY-MM-DDTHH:mm`), nie als UTC.
- Themes = Tokens in `css/themes.css`; nach Farbänderungen `python tools/kontrast.py` (WCAG AA) laufen lassen.
- Pfade in der App sind **relativ** (Pages liegt unter `/oregano/`).

## Fallstricke (aus Erfahrung)

- `style: {'--x': …}` geht nur über `setProperty` – `h()` in `util.js` erledigt das. `replaceChildren`/`append` sind dort gepatcht, damit `null` nicht als Text „null“ erscheint.
- `position: fixed`-Kinder (Combobox-Liste) funktionieren nicht unter Vorfahren mit `transform`/`filter`/`backdrop-filter` – die Modal-Animation läuft deshalb nur kurz und ohne `fill-mode`.
- Listen-Tabelle: Leerzeile wird **ohne Neuzeichnen** in eine echte Zeile verwandelt (sonst geht der Fokus verloren). Quiet-Updates (`{quiet:true}`) lösen kein Re-Render aus.
- Screenshots im Browser-Pane scheitern manchmal beim ersten Versuch (Fenster verdeckt) – einfach wiederholen. Mobil: `resize_window` mobile, danach wieder `desktop`.
- Service Worker ist „Netz zuerst“; bei neuen Dateien in `sw.js` die Liste `CORE` und `CACHE` pflegen.
- Der native Teil (Capacitor, Benachrichtigungen bei geschlossener App) ist **nicht auf einem Gerät getestet**.

## Testen

`preview_start oregano`, im Browser prüfen; Store im Test per `await import('/js/store.js')` ansprechen
(gleiche Modul-Instanz wie die App). Drag & Drop mit `left_click_drag` (Koordinaten des Screenshots, nicht der Seite).
