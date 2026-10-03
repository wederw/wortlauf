# Wortlauf

**Ausprobieren: [wederw.github.io/wortlauf](https://wederw.github.io/wortlauf/)**

Ein Reader für eigene Bücher und Dokumente, der komplett im Browser läuft. Du fügst eine Datei
hinzu, liest sie normal oder wechselst in den Lesemodus: oben erscheint der Text Wort für Wort an
fester Stelle (centered RSVP), unten siehst du die ganze Seite, auf der das aktuelle Wort markiert
ist. Wie der Lesemodus zerlegt, taktet und anzeigt, bestimmen austauschbare Scripts.

**Deine Bücher verlassen nie dein Gerät.** Es gibt keinen Server und kein Konto. Wortlauf liest
die Dateien im Browser ein und speichert Bücher, Lesestand und Einstellungen in dessen Speicher
(IndexedDB). Wer die Seite öffnet, hat seine eigene, leere Bibliothek.

## Funktionen

- **Formate:** PDF, ePub, Word (.docx), Text, Markdown, HTML
- **Lesemodus:** oberes Drittel das Einzelwort, untere zwei Drittel die ganze Seite mit dem
  aktuellen Wort markiert. Die Seite blättert mit; ein Klick auf ein Wort springt dorthin. Bei
  PDFs ist das die Originalseite mit Bildern und Layout, auf Wunsch der reine Text.
- **Steuerung:** Tempo in Wörtern pro Minute, Satz-, Absatz- und Kapitelsprünge,
  Inhaltsverzeichnis, Lesezeichen, Restzeit für Kapitel und Buch
- **Normalansicht:** PDFs als Originalseiten, alle anderen Formate als Text kapitelweise. Ein Klick
  auf ein Wort setzt die Lesemarke, ein Doppelklick startet dort den Lesemodus.
- **Leseprofile:** Stapel von Scripts mit eigenen Einstellungen, zum Beispiel „Roman“ und „Fachtext“
- **Eigene Scripts:** als .js-Datei importieren, sie bleiben im Browser
- **Offline:** nach dem ersten Aufruf funktioniert die App auch ohne Netz und lässt sich als App
  installieren
- **Sicherung:** Einstellungen, Lesestände, Lesezeichen und Statistik als Datei exportieren und auf
  einem anderen Gerät einspielen
- **Statistik:** Lesezeit, Wörter und Tempo je Tag und Buch

## Bedienung im Lesemodus

| Taste | Wirkung |
| --- | --- |
| Leertaste, Enter | Start und Pause |
| ← → | Satz zurück, vor |
| Umschalt + ← → | Absatz zurück, vor |
| Bild ↑ Bild ↓ | Kapitel zurück, vor |
| ↑ ↓ | schneller, langsamer |
| B | Lesezeichen setzen |
| Esc | Lesemodus verlassen |

Auf dem Handy: Tippen auf das Wort startet und hält an, Wischen nach links oder rechts springt
satzweise, Wischen nach oben oder unten ändert das Tempo. Quer gehalten stehen Wort und Seite
nebeneinander.

## Mehrere Geräte

Weil alles im Browser liegt, wird nichts automatisch abgeglichen. Unter **Einstellungen → Daten**
lädst du eine Sicherung herunter und spielst sie auf dem anderen Gerät ein. Die Bücher selbst sind
nicht in der Sicherung: Füge dort dieselbe Datei hinzu, und Wortlauf erkennt sie am Inhalt wieder,
samt Lesestand und Lesezeichen.

Browser dürfen gespeicherte Daten löschen, wenn der Speicher knapp wird. Wortlauf bittet den
Browser, die Daten dauerhaft zu behalten; eine gelegentliche Sicherung schadet trotzdem nicht.

## Scripts

Der Lesemodus besteht aus einer Pipeline mit fünf Hooks: `tokenize`, `timing`, `layout`, `flow`
und `stats`. Die mitgelieferten Scripts liegen in [src/plugins](src/plugins). Eigene Scripts
importierst du unter **Einstellungen → Eigene Scripts**; sie werden nirgends hochgeladen und
gehören deshalb auch nicht in dieses Repository.

Scripts laufen in einem Web Worker ohne DOM. Die Seite hat eine Content-Security-Policy, die jede
Verbindung zu anderen Adressen verbietet, und sie gilt auch im Worker. Scripts geben nur Daten
zurück, die der Kern prüft, bevor er sie verwendet. Ein fehlerhaftes Script wird abgeschaltet und
im Lesemodus gemeldet. Die Hooks im Einzelnen stehen in [docs/scripts.md](docs/scripts.md).

## Grenzen

- PDFs ohne Textebene (Scans) brauchen vorher OCR, zum Beispiel mit `ocrmypdf`.
- Absätze und Lesereihenfolge eines PDFs werden aus der Lage der Zeilen erschlossen. Bei
  mehrspaltigem Satz, Tabellen und Fußnoten kann das danebenliegen.
- Die Markierung auf einer PDF-Seite wird aus der Lage der Buchstaben geschätzt und kann bei
  ungewöhnlichen Schriften ein wenig danebenliegen.
- Seiten, auf denen nur Bilder stehen, überspringt der Lesemodus, weil es dort nichts zu lesen
  gibt. In der Normalansicht sind sie zu sehen.
- ePubs werden als reiner Text gezeigt, ohne Bilder und ohne das Layout des Verlags.
- Kopiergeschützte Dateien (DRM) lassen sich nicht lesen.
- Lange Wörter werden nach einer einfachen Silbenregel geteilt, nicht nach Wörterbuch.
- Dateien bis 300 MB.

## Entwicklung

```sh
npm ci
npm run dev      # Entwicklungsserver auf http://localhost:5173
npm test         # Extraktion, Seiten, Wortlage im PDF, Script-Engine und mitgelieferte Scripts
npm run build    # fertige Seite in dist/
```

Die Tests brauchen Node 22 oder neuer.

## Auf GitHub Pages veröffentlichen

Das Repository bringt einen Workflow mit ([.github/workflows/pages.yml](.github/workflows/pages.yml)),
der bei jedem Push auf `main` testet, baut und die Seite veröffentlicht.

1. Auf GitHub ein neues, öffentliches Repository anlegen, zum Beispiel `wortlauf`, ohne README.
2. Den Code hochladen:
   ```sh
   git remote add origin https://github.com/<dein-name>/wortlauf.git
   git push -u origin main
   ```
3. Im Repository unter **Settings → Pages** bei **Source** „GitHub Actions“ wählen.
4. Unter **Actions** den Lauf „GitHub Pages“ abwarten (beim ersten Mal ggf. neu starten). Danach
   ist die App unter `https://<dein-name>.github.io/wortlauf/` erreichbar.

Die gebaute Seite verwendet relative Pfade und läuft deshalb unter jedem Repository-Namen und auch
mit eigener Domain.

## Lizenz

MIT. Eingebunden werden pdf.js (Apache-2.0), fflate (MIT), Literata und Atkinson Hyperlegible (OFL).
