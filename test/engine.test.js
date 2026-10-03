import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FLAG, baseTokens, createEngine, describe, resolveSettings } from '../src/engine/kernel.js';
import center from '../src/plugins/layout-center.js';
import left from '../src/plugins/layout-left.js';
import punctuation from '../src/plugins/layout-punctuation.js';
import adaptive from '../src/plugins/timing-adaptive.js';
import pauses from '../src/plugins/timing-pauses.js';
import chunks from '../src/plugins/tokenize-chunks.js';
import splitLong from '../src/plugins/tokenize-split-long.js';
import chapterPause from '../src/plugins/flow-chapter-pause.js';
import pomodoro from '../src/plugins/flow-pomodoro.js';
import rampup from '../src/plugins/flow-rampup.js';
import basics from '../src/plugins/stats-basics.js';

const paras = [
  { t: 'Erstes Kapitel', h: 1 },
  { t: 'Dr. Meier kam am 3. Mai, z.B. mit dem Hochregallagerverwaltungssystem. Dann ging er!' },
  { t: 'Zweites Kapitel', h: 1 },
  { t: 'Ende gut, alles gut.' },
];
const chapters = [{ title: 'Erstes Kapitel', start: 0 }, { title: 'Zweites Kapitel', start: 2 }];

const engineWith = (plugins) => createEngine(new Map(Object.entries(plugins)));
const profile = (...ids) => ids.map((id) => (typeof id === 'string' ? { id } : id));

test('base tokens keep offsets and mark boundaries', () => {
  const tokens = baseTokens(paras, chapters);
  for (const token of tokens) assert.equal(paras[token.para].t.slice(token.start, token.end), token.text);
  const text = (flag) => tokens.filter((t) => t.flags & flag).map((t) => t.text);
  // abbreviations, initials and ordinals do not end a sentence
  assert.deepEqual(text(FLAG.SENTENCE_END), ['Kapitel', 'Hochregallagerverwaltungssystem.', 'er!', 'Kapitel', 'gut.']);
  assert.deepEqual(text(FLAG.CHAPTER_END), ['er!', 'gut.']);
  assert.deepEqual(text(FLAG.HEADING), ['Erstes', 'Kapitel', 'Zweites', 'Kapitel']);
});

test('default layout is the optical centre', () => {
  const { tokens } = engineWith({}).prepare({ paras, chapters, profile: [], wpm: 300 });
  for (const token of tokens) {
    assert.equal(token.ratio, 0.5);
    assert.equal(token.anchor, undefined);
    assert.equal(token.origin, 0.5);
  }
});

test('timing: base duration follows wpm, plugins stack', () => {
  const engine = engineWith({ adaptive, pauses });
  const plain = engine.prepare({ paras, chapters, profile: [], wpm: 300 });
  assert.ok(plain.ms.every((ms) => Math.abs(ms - 200) < 0.01));

  const { tokens, ms, errors } = engine.prepare({ paras, chapters, profile: profile('adaptive', 'pauses'), wpm: 300 });
  assert.deepEqual(errors, []);
  const at = (word) => ms[tokens.findIndex((t) => t.text === word)];
  assert.ok(at('Hochregallagerverwaltungssystem.') > at('Meier'));
  assert.ok(at('er!') > at('ging'), 'paragraph end is longer');
  assert.ok(at('Mai,') > at('kam'), 'comma adds a pause');
  assert.ok(at('am') < 200, 'short words are quicker');

  const faster = engine.retime(600).ms;
  assert.ok(Math.abs(faster[0] * 2 - ms[0]) < 0.5);
});

test('chunks merge words inside a sentence only', () => {
  const engine = engineWith({ chunks });
  const { tokens } = engine.prepare({ paras, chapters, profile: profile({ id: 'chunks', settings: { words: 3, maxChars: 30 } }), wpm: 300 });
  assert.equal(tokens[0].text, 'Erstes Kapitel');
  assert.equal(tokens[0].words, 2);
  assert.ok(tokens.every((t) => t.text.split(' ').length <= 3));
  const total = tokens.reduce((sum, t) => sum + t.words, 0);
  assert.equal(total, baseTokens(paras, chapters).length);
  assert.ok(!tokens.some((t) => /er! /.test(t.text)), 'no chunk continues past a sentence end');
  for (const token of tokens) assert.ok(token.end <= paras[token.para].t.length);
});

test('long words are split and still add up to one word', () => {
  const engine = engineWith({ splitLong });
  const { tokens } = engine.prepare({ paras, chapters, profile: profile({ id: 'splitLong', settings: { maxLength: 12 } }), wpm: 300 });
  const parts = tokens.filter((t) => t.para === 1 && t.start >= paras[1].t.indexOf('Hochregal') && t.start < paras[1].t.indexOf(' Dann'));
  assert.ok(parts.length >= 3);
  assert.equal(parts.map((p) => p.text.replace(/-$/, '')).join(''), 'Hochregallagerverwaltungssystem.');
  assert.ok(Math.abs(parts.reduce((sum, p) => sum + p.words, 0) - 1) < 1e-9);
  assert.ok(parts.slice(0, -1).every((p) => !(p.flags & FLAG.SENTENCE_END)));
  assert.ok(parts.at(-1).flags & FLAG.SENTENCE_END);
  assert.ok(parts.every((p) => p.text.length <= 14));
});

test('layout plugins chain and results are clamped', () => {
  const wild = { hooks: { layout: () => ({ anchor: 999, origin: 7, segments: [{ start: -4, end: 2, style: 'accent' }, { start: 0, end: 1, style: 'blink' }] }) } };
  const engine = engineWith({ center, left, punctuation, wild });
  let { tokens } = engine.prepare({ paras, chapters, profile: profile('center', 'left', 'punctuation'), wpm: 300 });
  const comma = tokens.find((t) => t.text === 'Mai,');
  assert.equal(comma.anchor, 0);
  assert.equal(comma.ratio, undefined, 'a later anchor replaces an earlier ratio');
  assert.equal(comma.origin, 0.3);
  assert.deepEqual(comma.segments, [{ start: 3, end: 4, style: 'dim' }]);

  ({ tokens } = engine.prepare({ paras, chapters, profile: profile('wild'), wpm: 300 }));
  assert.equal(tokens[0].anchor, tokens[0].text.length);
  assert.equal(tokens[0].origin, 0.9);
  assert.deepEqual(tokens[0].segments, [{ start: 0, end: 2, style: 'accent' }]);
});

test('a throwing plugin is switched off and reported, the rest keeps working', () => {
  const broken = { hooks: { timing: () => { throw new Error('kaputt'); }, tokenize: () => 'nonsense' } };
  const engine = engineWith({ broken, pauses });
  const { tokens, ms, errors } = engine.prepare({ paras, chapters, profile: profile('broken', 'pauses'), wpm: 300 });
  assert.equal(tokens.length, baseTokens(paras, chapters).length);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].plugin, 'broken');
  assert.ok(ms.some((value) => value > 200), 'pauses still apply');
});

test('flow: chapter pause, ramp-up and reading breaks', () => {
  const engine = engineWith({ chapterPause, rampup, pomodoro });
  engine.prepare({ paras, chapters, profile: profile('chapterPause', 'rampup', { id: 'pomodoro', settings: { minutes: 1 } }), wpm: 300 });
  assert.deepEqual(engine.flow({ type: 'chapterEnd', index: 3, activeMs: 0 }).actions, [{ type: 'pause', message: 'Kapitel zu Ende' }]);
  assert.deepEqual(engine.flow({ type: 'resume', index: 3, activeMs: 0 }).actions, [
    { type: 'rewind', tokens: 3 },
    { type: 'speed', factor: 0.6, tokens: 12 },
  ]);
  assert.deepEqual(engine.flow({ type: 'tick', index: 3, activeMs: 61000 }).actions, [], 'never mid-sentence');
  assert.equal(engine.flow({ type: 'sentenceEnd', index: 3, activeMs: 61000 }).actions[0].type, 'pause');
  assert.deepEqual(engine.flow({ type: 'sentenceEnd', index: 4, activeMs: 70000 }).actions, [], 'timer restarts');
});

test('stats rows and manifest description', () => {
  const engine = engineWith({ basics });
  const { tokens } = engine.prepare({ paras, chapters, profile: profile('basics'), wpm: 300 });
  const rows = engine.stats({ words: 150, activeMs: 30000, pauses: 2, from: 0, to: tokens.length - 1 });
  assert.deepEqual(rows[0], { label: 'Tatsächliches Tempo', value: '300 Wörter/min' });
  assert.equal(rows[2].value, 'Hochregallagerverwaltungssystem');

  assert.deepEqual(describe('x', adaptive).hooks, ['timing']);
  assert.throws(() => describe('x', {}));
  assert.deepEqual(resolveSettings(adaptive.settings, { threshold: 99, perChar: 'abc' }), { threshold: 20, perChar: 5, numbers: 60, short: 85 });
});
