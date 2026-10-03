# Wortlauf

Selbst gehosteter Reader für eigene Bücher und Dokumente. Du lädst eine Datei hoch, liest sie
normal oder wechselst in den Lesemodus, der den Text Wort für Wort an fester Stelle zeigt
(centered RSVP). Wie der Lesemodus zerlegt, taktet und anzeigt, bestimmen austauschbare Scripts.

Gedacht für eine Person auf dem eigenen Server: ein Konto, ein Container, eine SQLite-Datei.

## Funktionen

- **Formate:** PDF, ePub, Word (.docx), Text, Markdown, HTML
- **Normalansicht:** Text kapitelweise, bei PDFs zusätzlich die Originalseiten. Ein Klick auf ein
  Wort setzt die Lesemarke, ein Doppelklick startet dort den Lesemodus.
- **Lesemodus:** Tempo in Wörtern pro Minute, Satz- und Absatzsprünge, Inhaltsverzeichnis,
  Lesezeichen, aktueller Satz als Kontext, Restzeit für Kapitel und Buch
- **Leseprofile:** Stapel von Scripts mit eigenen Einstellungen, zum Beispiel „Roman“ und „Fachtext“
- **Sync:** Lesestand, Tempo und Lesezeichen liegen auf dem Server und gelten auf jedem Gerät
- **Offline:** einmal geöffnete Bücher bleiben lesbar, der Lesestand wird nachgetragen
  (der Browser erlaubt das nur über HTTPS oder auf `localhost`)
- **Statistik:** Lesezeit, Wörter und Tempo je Tag und Buch

## Start

```sh
docker compose up -d --build
```

Dann `http://localhost:8000` öffnen und das Konto anlegen. Bücher, Datenbank und Lesestand liegen
in `./data`. Der Container läuft als Benutzer mit der ID 1000; `./data` muss ihm gehören.

Für den Zugriff von außerhalb des eigenen Netzes gehört ein Reverse Proxy mit HTTPS davor.

### Ohne Docker

```sh
cd frontend && npm ci && npm run build && cd ..
cd backend && pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

### Einstellungen über Umgebungsvariablen

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `WORTLAUF_DATA` | Ordner für Datenbank und Bücher | `./data` |
| `WORTLAUF_PLUGINS` | Ordner mit `builtin/` und `local/` | `./plugins` |
| `WORTLAUF_MAX_UPLOAD_MB` | größte erlaubte Datei | `200` |
| `WORTLAUF_SESSION_DAYS` | Gültigkeit einer Anmeldung | `30` |
| `WORTLAUF_COOKIE_SECURE` | `auto`, `true` oder `false` | `auto` |

### Passwort vergessen

```sh
docker compose exec wortlauf python -m app.cli reset-password
```

## Scripts

Der Lesemodus besteht aus einer Pipeline mit fünf Hooks: `tokenize`, `timing`, `layout`, `flow`
und `stats`. Mitgelieferte Scripts liegen in `plugins/builtin`. Eigene legst du als `.js`-Datei
in `plugins/local`; dieser Ordner wird von Git ignoriert und beim Lesen laufend neu eingelesen.

Die vollständige Beschreibung der Hooks steht in [docs/scripts.md](docs/scripts.md).

Scripts laufen in einem Web Worker ohne DOM. Der Server liefert den Worker mit einer
Content-Security-Policy aus, die ihm jede Netzwerkverbindung außer dem Laden von Script-Modulen
vom eigenen Server verbietet. Scripts geben nur Daten zurück, die der Kern prüft, bevor er sie
verwendet. Ein fehlerhaftes Script wird abgeschaltet und im Lesemodus gemeldet.

## Grenzen

- PDFs ohne Textebene (Scans) brauchen vorher OCR, zum Beispiel mit `ocrmypdf`.
- Absätze und Lesereihenfolge eines PDFs werden aus dem Seitenbild erschlossen. Bei mehrspaltigem
  Satz, Tabellen und Fußnoten kann das danebenliegen.
- ePubs werden als reiner Text gezeigt, ohne Bilder und ohne das Layout des Verlags.
- Kopiergeschützte Dateien (DRM) lassen sich nicht lesen.
- Lange Wörter werden nach einer einfachen Silbenregel geteilt, nicht nach Wörterbuch.

## Entwicklung

```sh
cd backend && python -m pytest          # Extraktion und API
cd frontend && npm test                 # Script-Engine und mitgelieferte Scripts
cd frontend && npm run dev              # Frontend mit Proxy auf localhost:8000
```

## Lizenz

MIT. Eingebunden werden pdf.js (Apache-2.0), pypdf (BSD), Literata und Atkinson Hyperlegible (OFL).
