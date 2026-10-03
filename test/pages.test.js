import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageOf, paginate, wordAt } from '../src/lib/progress.js';

const text = (length) => 'x'.repeat(length);

test('text pages fill up to the size and start anew at every chapter', () => {
  const doc = {
    chapters: [{ title: 'A', start: 0 }, { title: 'B', start: 4 }],
    paras: [{ t: text(300) }, { t: text(300) }, { t: text(300) }, { t: text(300) }, { t: text(100) }, { t: text(100) }],
  };
  assert.deepEqual(paginate(doc, 700), [0, 2, 4]);
});

test('a long paragraph joins a page that is less than half full', () => {
  const doc = { chapters: [{ title: 'A', start: 0 }], paras: [{ t: text(200) }, { t: text(600) }, { t: text(100) }] };
  assert.deepEqual(paginate(doc, 700), [0, 2]);
});

test('printed pages follow the original page numbers', () => {
  const doc = {
    chapters: [{ title: 'A', start: 0 }],
    paras: [{ t: 'a', pg: 1 }, { t: 'b', pg: 1 }, { t: 'c', pg: 3 }, { t: 'd', pg: 4 }],
  };
  const starts = paginate(doc, 1);
  assert.deepEqual(starts, [0, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map((para) => pageOf(starts, para)), [0, 0, 1, 2]);
});

test('wordAt finds the word around an offset', () => {
  assert.deepEqual(wordAt('Ein kurzer Satz.', 6), [4, 10]);
  assert.deepEqual(wordAt('Ein kurzer Satz.', 0), [0, 3]);
});
