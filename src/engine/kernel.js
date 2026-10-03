// Script engine kernel. Pure functions, no DOM, no network: the same file runs in the
// worker and under `node --test`.
//
// A document passes through four stages, each of which plugins can hook into:
//   tokenize(tokens, ctx)  -> tokens      reshape the list of display units
//   timing(token, ctx)     -> ms          how long a unit stays on screen
//   layout(token, ctx)     -> layout      where the unit sits and how parts of it are styled
//   flow(event, ctx)       -> actions     react to playback events
// plus stats(session, ctx) -> rows        extra figures for the session summary.
//
// Hooks return plain data. The kernel validates everything a plugin returns, so a faulty
// script degrades to "plugin switched off, error shown" instead of breaking playback.

export const FLAG = { SENTENCE_END: 1, PARA_END: 2, CHAPTER_END: 4, HEADING: 8 };

export const STYLES = ['accent', 'dim', 'underline'];
export const ACTIONS = ['pause', 'speed', 'rewind', 'notify', 'setWpm'];

const ABBREVIATIONS = new Set([
  'z.b.', 'bzw.', 'ca.', 'usw.', 'etc.', 'dr.', 'prof.', 'nr.', 'vgl.', 'ggf.', 'evtl.', 'd.h.', 'u.a.',
  'inkl.', 'abs.', 'art.', 'bd.', 'hrsg.', 's.', 'st.', 'str.', 'mr.', 'mrs.', 'ms.', 'e.g.', 'i.e.',
  'vs.', 'fig.', 'no.', 'vol.', 'approx.', 'abb.', 'kap.', 'tab.', 'zzgl.', 'max.', 'min.', 'o.g.',
]);
const SENTENCE_END = /[.!?…]["'»«”“’)\]]*$/;

function endsSentence(text) {
  if (!SENTENCE_END.test(text)) return false;
  const bare = text.replace(/["'»«”“’)\]]+$/, '');
  if (!bare.endsWith('.')) return true;
  if (ABBREVIATIONS.has(bare.toLowerCase())) return false;
  if (/^\p{L}\.$/u.test(bare)) return false; // single initial: "J."
  if (/^\d+\.$/.test(bare)) return false; // ordinal or list number: "3."
  return true;
}

/** Splits paragraphs at whitespace into one token per word. */
export function baseTokens(paras, chapters = []) {
  const chapterEnds = new Set(chapters.map((c) => c.start - 1));
  chapterEnds.add(paras.length - 1);
  const tokens = [];
  for (let p = 0; p < paras.length; p++) {
    const text = paras[p].t;
    const heading = paras[p].h ? FLAG.HEADING : 0;
    const first = tokens.length;
    const pattern = /\S+/g;
    let match;
    while ((match = pattern.exec(text))) {
      tokens.push({
        text: match[0],
        para: p,
        start: match.index,
        end: match.index + match[0].length,
        words: 1,
        flags: heading | (endsSentence(match[0]) ? FLAG.SENTENCE_END : 0),
      });
    }
    if (tokens.length > first) {
      const last = tokens[tokens.length - 1];
      last.flags |= FLAG.SENTENCE_END | FLAG.PARA_END;
      if (chapterEnds.has(p)) last.flags |= FLAG.CHAPTER_END;
    }
  }
  return tokens;
}

function cleanTokens(list, paraCount) {
  if (!Array.isArray(list)) throw new Error('tokenize muss ein Array zurückgeben');
  const out = [];
  let lastPara = 0;
  let lastStart = -1;
  for (const raw of list) {
    if (!raw || typeof raw.text !== 'string' || raw.text.length === 0) continue;
    const para = raw.para | 0;
    const start = raw.start | 0;
    if (para < 0 || para >= paraCount) throw new Error('Token verweist auf einen unbekannten Absatz');
    if (para < lastPara || (para === lastPara && start < lastStart)) {
      throw new Error('Tokens müssen in Lesereihenfolge bleiben');
    }
    lastPara = para;
    lastStart = start;
    const words = Number(raw.words);
    out.push({
      text: raw.text.slice(0, 200),
      para,
      start,
      end: Math.max(start, raw.end | 0),
      words: Number.isFinite(words) && words >= 0 ? words : 1,
      flags: (raw.flags | 0) & 15,
    });
  }
  if (out.length === 0) throw new Error('tokenize hat keine Tokens übrig gelassen');
  return out;
}

function cleanLayout(candidate, previous, length) {
  if (!candidate || typeof candidate !== 'object') return previous;
  const next = { ...previous };
  // The point of a unit that sits on the fixation line: either a character position
  // (`anchor`, may be fractional) or a share of the rendered width (`ratio`, 0 to 1).
  if (Number.isFinite(candidate.anchor)) {
    next.anchor = Math.min(length, Math.max(0, candidate.anchor));
    next.ratio = null;
  } else if (Number.isFinite(candidate.ratio)) {
    next.ratio = Math.min(1, Math.max(0, candidate.ratio));
    next.anchor = null;
  }
  if (Number.isFinite(candidate.origin)) next.origin = Math.min(0.9, Math.max(0.1, candidate.origin));
  if (Array.isArray(candidate.segments)) {
    next.segments = candidate.segments
      .filter((s) => s && STYLES.includes(s.style) && Number.isFinite(s.start) && Number.isFinite(s.end))
      .map((s) => ({
        start: Math.max(0, Math.min(length, s.start | 0)),
        end: Math.max(0, Math.min(length, s.end | 0)),
        style: s.style,
      }))
      .filter((s) => s.end > s.start)
      .slice(0, 12);
  }
  return next;
}

function cleanActions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const action of list) {
    if (!action || !ACTIONS.includes(action.type)) continue;
    if (action.type === 'pause' || action.type === 'notify') {
      out.push({ type: action.type, message: String(action.message ?? '').slice(0, 200) });
    } else if (action.type === 'speed' && Number.isFinite(action.factor)) {
      out.push({
        type: 'speed',
        factor: Math.min(2, Math.max(0.2, action.factor)),
        tokens: Math.min(200, Math.max(1, action.tokens | 0 || 10)),
      });
    } else if (action.type === 'rewind') {
      out.push({ type: 'rewind', tokens: Math.min(500, Math.max(0, action.tokens | 0)) });
    } else if (action.type === 'setWpm' && Number.isFinite(action.value)) {
      out.push({ type: 'setWpm', value: Math.min(2000, Math.max(50, Math.round(action.value))) });
    }
  }
  return out.slice(0, 8);
}

/** Fills in defaults from a plugin's settings schema and coerces stored values to it. */
export function resolveSettings(schema = {}, stored = {}) {
  const out = {};
  for (const [key, field] of Object.entries(schema)) {
    let value = stored?.[key] ?? field.default;
    if (field.type === 'number') {
      value = Number(value);
      if (!Number.isFinite(value)) value = Number(field.default) || 0;
      if (Number.isFinite(field.min)) value = Math.max(field.min, value);
      if (Number.isFinite(field.max)) value = Math.min(field.max, value);
    } else if (field.type === 'boolean') {
      value = Boolean(value);
    } else if (field.type === 'select') {
      const allowed = (field.options ?? []).map((o) => o.value);
      if (!allowed.includes(value)) value = field.default;
    } else {
      value = String(value ?? '');
    }
    out[key] = value;
  }
  return out;
}

const HOOKS = ['tokenize', 'timing', 'layout', 'flow', 'stats'];

/** Describes a loaded plugin module for the settings UI. */
export function describe(id, definition) {
  if (!definition || typeof definition !== 'object') throw new Error('Kein default-Export mit Plugin-Objekt');
  const hooks = HOOKS.filter((h) => typeof definition.hooks?.[h] === 'function');
  if (hooks.length === 0) throw new Error('Das Plugin definiert keinen Hook');
  return {
    id,
    name: String(definition.name ?? id),
    description: String(definition.description ?? ''),
    hooks,
    settings: definition.settings ?? {},
  };
}

/**
 * The engine instance keeps the active stack, the prepared tokens and per-plugin state.
 * `registry` maps plugin id -> plugin definition (the module's default export).
 */
export function createEngine(registry) {
  let stack = []; // [{ id, hooks, settings, state }]
  let tokens = [];
  let meta = {};
  let errors = [];

  const report = (plugin, hook, error) => {
    plugin.broken = true;
    errors.push({ plugin: plugin.id, hook, message: String(error?.message ?? error) });
  };
  const active = (hook) => stack.filter((p) => !p.broken && typeof p.hooks[hook] === 'function');
  const context = (plugin, extra) => ({ settings: plugin.settings, state: plugin.state, meta, FLAG, ...extra });

  function retime(wpm) {
    const perWord = 60000 / wpm;
    const plugins = active('timing');
    const out = new Float32Array(tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const baseMs = perWord * Math.max(token.words, 0.35);
      let ms = baseMs;
      for (const plugin of plugins) {
        if (plugin.broken) continue;
        try {
          const result = plugin.hooks.timing(
            token,
            context(plugin, { ms, baseMs, wpm, index: i, prev: tokens[i - 1], next: tokens[i + 1] }),
          );
          if (Number.isFinite(result)) ms = result;
        } catch (error) {
          report(plugin, 'timing', error);
        }
      }
      out[i] = Math.min(15000, Math.max(30, ms));
    }
    return out;
  }

  function prepare({ paras, chapters, profile, wpm, book }) {
    errors = [];
    meta = { book: book ?? {}, paragraphs: paras.length, chapters: chapters ?? [] };
    stack = [];
    for (const entry of profile ?? []) {
      const definition = registry.get(entry.id);
      if (!definition) continue;
      stack.push({
        id: entry.id,
        hooks: definition.hooks ?? {},
        settings: resolveSettings(definition.settings, entry.settings),
        state: {},
        broken: false,
      });
    }

    tokens = baseTokens(paras, chapters);
    for (const plugin of active('tokenize')) {
      try {
        tokens = cleanTokens(plugin.hooks.tokenize(tokens, context(plugin, { paras })), paras.length);
      } catch (error) {
        report(plugin, 'tokenize', error);
      }
    }
    meta.tokens = tokens.length;

    const ms = retime(wpm);
    const layouts = active('layout');
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let layout = { anchor: null, ratio: 0.5, origin: 0.5, segments: [] };
      for (const plugin of layouts) {
        if (plugin.broken) continue;
        try {
          const result = plugin.hooks.layout(token, context(plugin, { layout, index: i }));
          layout = cleanLayout(result, layout, token.text.length);
        } catch (error) {
          report(plugin, 'layout', error);
        }
      }
      if (layout.anchor === null) token.ratio = layout.ratio;
      else token.anchor = layout.anchor;
      token.origin = layout.origin;
      if (layout.segments.length) token.segments = layout.segments;
    }
    return { tokens, ms, errors };
  }

  function flow(event) {
    const actions = [];
    const before = errors.length;
    for (const plugin of active('flow')) {
      try {
        actions.push(...cleanActions(plugin.hooks.flow(event, context(plugin, { token: tokens[event.index] }))));
      } catch (error) {
        report(plugin, 'flow', error);
      }
    }
    return { actions, errors: errors.slice(before) };
  }

  function stats(session) {
    const rows = [];
    for (const plugin of active('stats')) {
      try {
        const result = plugin.hooks.stats(session, context(plugin, { tokens }));
        for (const row of Array.isArray(result) ? result : []) {
          if (row && row.label != null) rows.push({ label: String(row.label).slice(0, 60), value: String(row.value ?? '').slice(0, 60) });
        }
      } catch (error) {
        report(plugin, 'stats', error);
      }
    }
    return rows.slice(0, 20);
  }

  return { prepare, retime: (wpm) => ({ ms: retime(wpm), errors }), flow, stats };
}
