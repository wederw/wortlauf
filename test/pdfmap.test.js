import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { extract } from '../src/lib/extract/index.js';
import { align, PdfMap, wordNear } from '../src/lib/pdfmap.js';
import { makePdf } from './fixtures.js';

const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');

const pages = [
  [
    [40, 500, 'Ein langer Absatz beginnt auf der ersten Seite und wird um-'],
    [40, 486, 'gebrochen, dann läuft er weiter bis an das Ende der'],
  ],
  [
    [40, 500, 'zweiten Seite und endet erst dort mit einem Punkt.'],
    [40, 460, 'Ein neuer Absatz steht darunter und hat'],
    [40, 446, 'eine zweite Zeile.'],
    [200, 30, '2'],
  ],
];

async function setup() {
  const data = makePdf(pages);
  const { doc } = await extract('x.pdf', data, { pdfjs });
  const pdf = await getDocument({ data: data.slice(), verbosity: 0 }).promise;
  return { doc, map: new PdfMap(pdf, doc), pdf };
}

const markOf = (doc, para, word) => {
  const start = doc.paras[para].t.indexOf(word);
  return { para, start, end: start + word.length };
};

test('align keeps order and skips what has no partner', () => {
  assert.deepEqual(align(['kopf', 'a', 'b', '2', 'c'], ['x', 'a', 'b', 'c']), [[1, 1], [2, 2], [4, 3]]);
});

test('words are found on the page they are printed on', async () => {
  const { doc, map, pdf } = await setup();
  assert.equal(doc.paras[0].pg, 1);
  assert.ok(doc.paras[0].t.includes('umgebrochen, dann'));

  const start = await map.locate(markOf(doc, 0, 'langer'));
  assert.equal(start.page, 1);
  const [x0, y0, x1, y1] = start.rects[0];
  assert.ok(x0 > 0.1 && x0 < 0.25 && x1 > x0, `x ${x0}..${x1}`);
  assert.ok(y0 > 0.12 && y1 < 0.18 && y1 > y0, `y ${y0}..${y1}`);

  const hyphenated = await map.locate(markOf(doc, 0, 'umgebrochen,'));
  assert.equal(hyphenated.page, 1);
  assert.equal(hyphenated.rects.length, 2, 'both halves of the hyphenated word are marked');

  // the paragraph started on page 1, but this word is on page 2
  const runOn = await map.locate(markOf(doc, 0, 'zweiten'));
  assert.equal(runOn.page, 2);
  assert.equal((await map.locate(markOf(doc, 1, 'neuer'))).page, 2);

  const [a, b, c, d] = runOn.rects[0];
  assert.deepEqual(wordNear(await map.page(2), (a + c) / 2, (b + d) / 2), { para: 0, offset: doc.paras[0].t.indexOf('zweiten') });
  assert.equal(wordNear(await map.page(2), 0.95, 0.95), null, 'far from any word');
  await pdf.destroy();
});
