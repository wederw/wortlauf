import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';

import { ExtractError, extract } from '../src/lib/extract/index.js';
import { makeDocx, makeEpub, makePdf } from './fixtures.js';

// The extractors use the browser's DOMParser.
globalThis.DOMParser = new JSDOM().window.DOMParser;

const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');
const utf8 = (text) => new TextEncoder().encode(text);

test('epub: metadata, chapters from the NCX, fragment anchors', async () => {
  const { format, doc } = await extract('band.epub', makeEpub());
  assert.equal(format, 'epub');
  assert.equal(doc.title, 'Der Testband');
  assert.equal(doc.author, 'A. Autorin');
  assert.deepEqual(doc.chapters.map((c) => c.title), ['Erstes Kapitel', 'Zweites Kapitel', 'Zweites, Teil B']);
  assert.equal(doc.paras[1].t, 'Ein Satz mit Betonung und Umbruch.');
  assert.equal(doc.paras[doc.chapters[2].start].t, 'Teil B');
  assert.equal(doc.paras.length, 7);
  assert.ok(doc.paras.every((p) => !('ids' in p)));
});

test('pdf: paragraphs, running headers, hyphens, page breaks', async () => {
  const pages = [1, 2, 3, 4].map((page) => {
    const lines = [
      `Seite ${page} beginnt mit einem langen Satz, der bis zum Rand der Zeile reicht und um-`,
      'gebrochen wird, damit die Silbentrennung geprüft werden kann, und er endet',
      'hier kurz.',
      'Der zweite Absatz ist ebenfalls lang genug, um mehrere Zeilen zu füllen, und läuft',
      'über das Seitenende hinaus weiter, ohne Punkt am Ende der letzten Zeile',
    ];
    return [[40, 560, 'Handbuch der Lagertechnik'], ...lines.map((line, i) => [40, 520 - i * 16, line]), [200, 30, String(page)]];
  });
  const { format, doc } = await extract('handbuch.pdf', makePdf(pages), { pdfjs });
  assert.equal(format, 'pdf');
  const text = doc.paras.map((p) => p.t).join(' ');
  assert.ok(!text.includes('Handbuch der Lagertechnik'), 'running header removed');
  assert.ok(text.includes('umgebrochen'), 'hyphenated line break joined');
  assert.ok(text.includes('geprüft'));
  assert.equal(doc.paras[0].pg, 1);
  assert.ok(doc.chapters[0].title.startsWith('Seite 1'));
  // the paragraph left open at the page end must not swallow the next page's capitalised start
  assert.ok(doc.paras.some((p) => p.t.startsWith('Seite 2 beginnt') && p.pg === 2));
  assert.equal(doc.title, 'handbuch');
});

test('pdf: outline becomes chapters, gaps split paragraphs', async () => {
  const pages = [
    [
      [40, 540, 'Einleitung', 16],
      [40, 510, 'Ein erster Absatz steht hier und geht noch'],
      [40, 496, 'über eine zweite Zeile weiter bis zum Ende'],
      [40, 482, 'mit drei Zeilen insgesamt'],
      [40, 452, 'Und nach einer Lücke folgt ein zweiter Absatz,'],
      [40, 438, 'der ebenfalls über zwei Zeilen geht'],
    ],
    [[40, 540, 'Hauptteil', 16], [40, 510, 'Der Hauptteil hat nur einen Satz in einer Zeile']],
  ];
  const { doc } = await extract('x.pdf', makePdf(pages, { title: 'Das Werk', outline: [['Einleitung', 1], ['Hauptteil', 2]] }), { pdfjs });
  assert.equal(doc.title, 'Das Werk');
  assert.deepEqual(doc.chapters.map((c) => c.title), ['Einleitung', 'Hauptteil']);
  assert.deepEqual(doc.paras.map((p) => p.t), [
    'Einleitung',
    'Ein erster Absatz steht hier und geht noch über eine zweite Zeile weiter bis zum Ende mit drei Zeilen insgesamt',
    'Und nach einer Lücke folgt ein zweiter Absatz, der ebenfalls über zwei Zeilen geht',
    'Hauptteil',
    'Der Hauptteil hat nur einen Satz in einer Zeile',
  ]);
  assert.equal(doc.paras[3].h, 1);
  assert.equal(doc.paras[3].pg, 2);
});

test('pdf without text is reported as a scan', async () => {
  await assert.rejects(extract('scan.pdf', makePdf([[]]), { pdfjs }), /OCR/);
});

test('markdown and plain text', async () => {
  let { format, doc } = await extract('notiz.md', utf8('# Titel\n\nEin **fetter** [Link](http://x) Text.\n\n## Zwei\n\n- Punkt eins\n- Punkt zwei\n'));
  assert.equal(format, 'md');
  assert.deepEqual(doc.chapters.map((c) => c.title), ['Titel', 'Zwei']);
  assert.equal(doc.paras[1].t, 'Ein fetter Link Text.');
  assert.deepEqual(doc.paras.slice(-2).map((p) => p.t), ['Punkt eins', 'Punkt zwei']);

  const cp1252 = new Uint8Array([...'Kapitel 1\n\nErste Zeile\nzweite Zeile.\n\nKapitel 2\n\nSchluß.'].map((c) => c.charCodeAt(0)));
  ({ format, doc } = await extract('roman.txt', cp1252));
  assert.equal(format, 'txt');
  assert.deepEqual(doc.chapters.map((c) => c.title), ['Kapitel 1', 'Kapitel 2']);
  assert.equal(doc.paras[1].t, 'Erste Zeile zweite Zeile.');
  assert.equal(doc.paras.at(-1).t, 'Schluß.');
});

test('docx and html', async () => {
  let { format, doc } = await extract('brief.docx', makeDocx());
  assert.equal(format, 'docx');
  assert.equal(doc.paras[0].h, 1);
  assert.equal(doc.paras[1].t, 'Absatz im Dokument.');
  assert.equal(doc.words, 4);

  ({ format, doc } = await extract('seite.html', utf8('<html><head><title>Seite</title><script>x()</script></head><body><h1>Kopf</h1><p>Inhalt &amp; mehr</p></body></html>')));
  assert.equal(format, 'html');
  assert.equal(doc.title, 'Seite');
  assert.deepEqual(doc.paras.map((p) => p.t), ['Kopf', 'Inhalt & mehr']);
});

test('rejects unknown and empty files', async () => {
  await assert.rejects(extract('bild.png', utf8('\x89PNG....')), ExtractError);
  await assert.rejects(extract('leer.txt', utf8('   \n  ')), ExtractError);
  await assert.rejects(extract('leer.txt', new Uint8Array()), ExtractError);
});
