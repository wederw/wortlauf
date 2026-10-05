# Wortlauf

**Ausprobieren: [wederw.github.io/wortlauf](https://wederw.github.io/wortlauf/)**

Ein Reader für eigene Bücher und Dokumente, der komplett im Browser läuft. Oben erscheint der Text
Wort für Wort an fester Stelle (centered RSVP), darunter siehst du das Dokument selbst, PDFs mit
Bildern und Layout, und das aktuelle Wort ist darin markiert. Wie der Text zerlegt, getaktet und
angezeigt wird, bestimmen austauschbare Scripts.

**Deine Bücher verlassen nie dein Gerät.** Es gibt keinen Server und kein Konto. Wortlauf liest
die Dateien im Browser ein und speichert Bücher, Lesestand und Einstellungen in dessen Speicher
(IndexedDB). Wer die Seite öffnet, hat seine eigene, leere Bibliothek.

## Funktionen

- **Formate:** PDF, ePub, Word (.docx), Text, Markdown, HTML
- **Ein Bildschirm:** oberes Drittel die Lesestelle als Einzelwort, untere zwei Drittel das
  Dokument zum Durchscrollen. PDFs erscheinen als Originalseiten, alles andere als durchgehender
  Text; bei PDFs gibt es den Text auf Wunsch auch. Das aktuelle Wort ist markiert und bleibt im
  Blick, ein Klick auf ein Wort springt dorthin.
- **Zoom:** Das Dokument lässt sich mit zwei Fingern, Strg+Mausrad oder den Knöpfen − und +
  vergrößern, ohne dass die übrige Seite mitzoomt. PDFs werden größer, Text bekommt eine größere
  Schrift.
- **Steuerung:** Tempo in Wörtern pro Minute, Satz-, Absatz- und Kapitelsprünge,
  Inhaltsverzeichnis, Lesezeichen
- **Leseprofile:** Stapel von Scripts mit eigenen Einstellungen, zum Beispiel „Roman“ und „Fachtext“
- **Eigene Scripts:** als .js-Datei importieren, sie bleiben im Browser
- **Offline:** nach dem ersten Aufruf funktioniert die App auch ohne Netz und lässt sich als App
  installieren
- **Sicherung:** Einstellungen, Lesestände, Lesezeichen und Statistik als Datei exportieren und auf
  einem anderen Gerät einspielen
- **Statistik:** Lesezeit, Wörter und Tempo je Tag und Buch

## Bedienung

| Taste | Wirkung |
| --- | --- |
| Leertaste | Start und Pause |
| ← → | Satz zurück, vor |
| Umschalt + ← → | Absatz zurück, vor |
| Bild ↑ Bild ↓ | Kapitel zurück, vor |
| ↑ ↓ | schneller, langsamer |
| B | Lesezeichen setzen |
| Esc | zurück zur Bibliothek |

Auf dem Handy: Tippen auf das Wort startet und hält an, Wischen nach links oder rechts springt
satzweise, Wischen nach oben oder unten ändert das Tempo. Im Dokument darunter scrollst und zoomst
du wie gewohnt; Tippen auf ein Wort setzt die Lesestelle dorthin. Quer gehalten stehen Wort und
Dokument nebeneinander.

## Mehrere Geräte

Weil alles im Browser liegt, wird nichts automatisch abgeglichen. Unter **Einstellungen → Daten**
lädst du eine Sicherung herunter und spielst sie auf dem anderen Gerät ein. Die Bücher selbst sind
nicht in der Sicherung: Füge dort dieselbe Datei hinzu, und Wortlauf erkennt sie am Inhalt wieder,
samt Lesestand und Lesezeichen.

Browser dürfen gespeicherte Daten löschen, wenn der Speicher knapp wird. Wortlauf bittet den
Browser, die Daten dauerhaft zu behalten; eine gelegentliche Sicherung schadet trotzdem nicht.

## Scripts

Die Wortanzeige besteht aus einer Pipeline mit fünf Hooks: `tokenize`, `timing`, `layout`, `flow`
und `stats`. Die mitgelieferten Scripts liegen in [src/plugins](src/plugins). Eigene Scripts
importierst du unter **Einstellungen → Eigene Scripts**; sie werden nirgends hochgeladen und
gehören deshalb auch nicht in dieses Repository.

Scripts laufen in einem Web Worker ohne DOM. Die Seite hat eine Content-Security-Policy, die jede
Verbindung zu anderen Adressen verbietet, und sie gilt auch im Worker. Scripts geben nur Daten
zurück, die der Kern prüft, bevor er sie verwendet. Ein fehlerhaftes Script wird abgeschaltet und
über dem Dokument gemeldet. Die Hooks im Einzelnen stehen in [docs/scripts.md](docs/scripts.md).

## Grenzen

- PDFs ohne Textebene (Scans) brauchen vorher OCR, zum Beispiel mit `ocrmypdf`.
- Absätze und Lesereihenfolge eines PDFs werden aus der Lage der Zeilen erschlossen. Bei
  mehrspaltigem Satz, Tabellen und Fußnoten kann das danebenliegen.
- Die Markierung auf einer PDF-Seite wird aus der Lage der Buchstaben geschätzt und kann bei
  ungewöhnlichen Schriften ein wenig danebenliegen.
- Seiten, auf denen nur Bilder stehen, überspringt die Wortanzeige, weil es dort nichts zu lesen
  gibt. Im Dokument darunter sind sie beim Scrollen zu sehen.
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
