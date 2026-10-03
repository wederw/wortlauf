# Scripts schreiben

Ein Script ist ein JavaScript-Modul mit einem Objekt als `default`-Export. Lege es als
`plugins/local/<name>.js` ab. Es erscheint danach in jedem Leseprofil, zunächst abgeschaltet.

```js
export default {
  name: 'Zahlen betonen',
  description: 'Unterstreicht Zahlen und lässt sie länger stehen.',
  settings: {
    extra: { type: 'number', label: 'Zuschlag (%)', default: 50, min: 0, max: 300, step: 10 },
  },
  hooks: {
    timing: (token, { ms, settings }) => (/\d/.test(token.text) ? ms * (1 + settings.extra / 100) : ms),
    layout(token, { layout }) {
      const match = token.text.match(/\d[\d.,]*/);
      if (!match) return null;
      return { segments: [...layout.segments, { start: match.index, end: match.index + match[0].length, style: 'underline' }] };
    },
  },
};
```

## Ablauf

Ein Profil ist eine geordnete Liste von Scripts. Für jeden Hook laufen die Scripts von oben nach
unten; jedes sieht das Ergebnis der vorherigen.

1. Der Kern zerlegt den Text an Leerzeichen in Tokens.
2. `tokenize` formt die Tokenliste um.
3. `timing` legt für jedes Token die Anzeigedauer fest.
4. `layout` legt fest, wo das Token steht und wie Teile davon aussehen.
5. Beim Abspielen reagiert `flow` auf Ereignisse, und `stats` ergänzt die Sitzungsübersicht.

## Token

| Feld | Bedeutung |
| --- | --- |
| `text` | angezeigter Text |
| `para` | Index des Absatzes |
| `start`, `end` | Zeichenpositionen im Absatz, über die der Lesestand gespeichert wird |
| `words` | Anzahl Wörter, die das Token darstellt; bestimmt die Grunddauer und die Statistik |
| `flags` | Bitfeld aus `FLAG.SENTENCE_END` (1), `FLAG.PARA_END` (2), `FLAG.CHAPTER_END` (4), `FLAG.HEADING` (8) |

## Kontext

Jeder Hook bekommt als zweites Argument ein Kontextobjekt. Immer enthalten:

| Feld | Bedeutung |
| --- | --- |
| `settings` | Werte aus dem Einstellungs-Schema des Scripts |
| `state` | leeres Objekt je Script, bleibt bis zum nächsten Vorbereiten des Textes erhalten |
| `meta` | `{ book, paragraphs, chapters, tokens }` |
| `FLAG` | die Flag-Konstanten |

## Hooks

### `tokenize(tokens, ctx) → tokens`

Gibt die neue Tokenliste zurück. Zusätzlich im Kontext: `paras` (alle Absätze als `{ t, h?, pg? }`).
Tokens müssen in Lesereihenfolge bleiben und auf einen vorhandenen Absatz zeigen.

### `timing(token, ctx) → Millisekunden`

Zusätzlich im Kontext: `ms` (bisheriger Wert), `baseMs` (Grunddauer aus dem Tempo), `wpm`, `index`,
`prev`, `next`. Der Kern begrenzt das Ergebnis auf 30 ms bis 15 s. Jeder andere Rückgabewert als
eine Zahl lässt den bisherigen Wert stehen.

### `layout(token, ctx) → { anchor | ratio, origin, segments }`

Zusätzlich im Kontext: `layout` (bisheriges Ergebnis), `index`. Alle Felder sind optional.

| Feld | Bedeutung |
| --- | --- |
| `ratio` | Anteil der Breite des Tokens, der auf der Fixationslinie liegt: 0 linker Rand, 0.5 Mitte, 1 rechter Rand |
| `anchor` | dasselbe als Zeichenposition, Bruchteile erlaubt; ersetzt `ratio` |
| `origin` | Lage der Fixationslinie in der Anzeige, 0.1 bis 0.9 der Breite |
| `segments` | Liste aus `{ start, end, style }` mit `style` aus `accent`, `dim`, `underline` |

Die Stile ändern nie die Breite eines Zeichens, damit die Ausrichtung stimmt.

### `flow(event, ctx) → Aktionen`

Ereignisse: `start`, `resume`, `sentenceEnd`, `paragraphEnd`, `chapterEnd`, `tick` (etwa jede
Sekunde). Jedes Ereignis trägt `index`, `total`, `flags`, `activeMs`, `words` und `wpm`.
Zusätzlich im Kontext: `token`.

| Aktion | Wirkung |
| --- | --- |
| `{ type: 'pause', message }` | hält an und zeigt die Meldung |
| `{ type: 'speed', factor, tokens }` | beginnt mit `factor` mal Tempo und erreicht nach `tokens` Tokens das volle Tempo |
| `{ type: 'rewind', tokens }` | springt zurück, höchstens bis zum Absatzanfang |
| `{ type: 'setWpm', value }` | setzt das Tempo |
| `{ type: 'notify', message }` | zeigt einen Hinweis |

### `stats(session, ctx) → [{ label, value }]`

`session` enthält `words`, `activeMs`, `pauses`, `from`, `to` und `wpm`. Zusätzlich im Kontext:
`tokens`.

## Einstellungs-Schema

`settings` beschreibt die Regler, die die Oberfläche für das Script anzeigt:

```js
settings: {
  amount: { type: 'number', label: 'Menge', default: 2, min: 1, max: 5, step: 1 },
  enabled: { type: 'boolean', label: 'Aktiv', default: true },
  mode: { type: 'select', label: 'Art', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  note: { type: 'text', label: 'Notiz', default: '' },
}
```

## Umgebung

Scripts laufen in einem Web Worker: kein DOM, kein `fetch`, keine Sockets, kein Speicher. Hooks
sind synchron und sollten schnell sein, denn `timing` und `layout` laufen für jedes Token des
Buches. Wirft ein Hook einen Fehler, schaltet der Kern das Script bis zum nächsten Vorbereiten ab
und zeigt die Meldung im Lesemodus.
