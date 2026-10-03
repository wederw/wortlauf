<script>
  // Reading mode. The script engine decides what is shown, for how long and where;
  // this component only draws the result and forwards input to the player.
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { engine, loadPlugins } from '../lib/engine.js';
  import Icon from '../lib/Icon.svelte';
  import { Player, UNIT } from '../lib/player.js';
  import { activeProfile, app, formatDuration, formatNumber, profileStack, READER_FONTS, saveSettings, toast } from '../lib/state.svelte.js';

  let { book, doc, start, wpm: initialWpm, bookmarks, onexit, onposition, onbookmark } = $props();

  let tokens = $state.raw([]);
  let remaining = $state.raw(new Float64Array(1)); // ms from each token to the end
  let chapterStarts = $state.raw([]); // first token index of every chapter
  let index = $state(0);
  let playing = $state(false);
  let message = $state('');
  let wpm = $state(initialWpm);
  let ready = $state(false);
  let failure = $state('');
  let scriptErrors = $state([]);
  let summary = $state([]);
  let panel = $state(null);
  let stageWidth = $state(0);
  let fontTick = $state(0);
  let root = $state();

  const measure = document.createElement('canvas').getContext('2d');
  const startedAt = Date.now() / 1000;
  let reported = false;
  let retimeRun = 0;
  let wakeLock = null;

  const player = new Player({
    flow: async (event) => {
      const result = await engine.flow(event);
      if (result.errors.length) scriptErrors = [...scriptErrors, ...result.errors];
      return result.actions;
    },
    onToken: (i) => (index = i),
    onState: (state) => {
      playing = state.playing;
      message = state.message;
      if (state.playing) {
        panel = null;
        navigator.wakeLock?.request('screen').then((lock) => (wakeLock = lock)).catch(() => {});
      } else {
        wakeLock?.release().catch(() => {});
        wakeLock = null;
        onposition(position(), wpm);
        engine.stats(player.session).then((rows) => (summary = rows)).catch(() => {});
      }
    },
    onWpm: (value) => setWpm(value),
    onNotify: (text) => toast(text),
  });

  const token = $derived(tokens[index]);
  const position = () => (tokens[player.index] ? { para: tokens[player.index].para, offset: tokens[player.index].start } : start);

  function indexAt(pos) {
    let low = 0;
    let high = tokens.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      const t = tokens[mid];
      if (t.para > pos.para || (t.para === pos.para && t.end > pos.offset)) high = mid;
      else low = mid + 1;
    }
    return low;
  }

  function setTimes(ms) {
    player.ms = ms;
    const sums = new Float64Array(ms.length + 1);
    for (let i = ms.length - 1; i >= 0; i--) sums[i] = sums[i + 1] + ms[i];
    remaining = sums;
  }

  async function prepare(at) {
    player.pause();
    try {
      const result = await engine.prepare({
        paras: doc.paras,
        chapters: doc.chapters,
        profile: profileStack(activeProfile()),
        wpm,
        book: { title: book.title, format: book.format },
      });
      tokens = result.tokens;
      scriptErrors = result.errors;
      const starts = [];
      let t = 0;
      for (const chapter of doc.chapters) {
        while (t < tokens.length - 1 && tokens[t].para < chapter.start) t++;
        starts.push(t);
      }
      chapterStarts = starts;
      player.load(tokens, result.ms, 0);
      player.wpm = wpm;
      setTimes(result.ms);
      player.index = index = indexAt(at);
      failure = '';
      ready = true;
    } catch (error) {
      failure = error.message;
    }
  }

  function setWpm(value) {
    wpm = Math.min(1500, Math.max(60, Math.round(value)));
    player.wpm = wpm;
    const run = ++retimeRun;
    engine
      .retime(wpm)
      .then((result) => run === retimeRun && setTimes(result.ms))
      .catch(() => {});
  }

  function changeProfile(event) {
    app.settings.activeProfile = event.target.value;
    saveSettings();
    prepare(position());
  }

  function report() {
    if (reported) return;
    reported = true;
    const { words, activeMs } = player.session;
    api.post('/api/readings', { book_id: book.id, started: startedAt, active_ms: activeMs, words }).catch(() => {});
  }

  function exit() {
    player.pause();
    report();
    onexit(position(), wpm);
  }

  // ---- what to draw

  const chapterIndex = $derived.by(() => {
    if (!token) return 0;
    let found = 0;
    for (let i = 0; i < doc.chapters.length; i++) if (doc.chapters[i].start <= token.para) found = i;
    return found;
  });
  const chapterLeft = $derived(remaining[index] - (remaining[chapterStarts[chapterIndex + 1] ?? tokens.length] ?? 0));
  const font = $derived(READER_FONTS[app.settings.readerFont] ?? READER_FONTS.literata);
  const fontSize = $derived(Math.max(22, Math.min(app.settings.wordSize, stageWidth / 9)));

  const placed = $derived.by(() => {
    fontTick;
    if (!token || !stageWidth) return null;
    const text = token.text;
    measure.font = `400 ${fontSize}px ${font.family}`;
    const width = measure.measureText(text).width;
    let anchorX = width * (token.ratio ?? 0.5);
    if (token.anchor !== undefined) {
      const whole = Math.floor(token.anchor);
      const left = measure.measureText(text.slice(0, whole)).width;
      const next = whole < text.length ? measure.measureText(text.slice(0, whole + 1)).width : left;
      anchorX = left + (token.anchor - whole) * (next - left);
    }
    const originX = token.origin * stageWidth;
    const margin = 12;
    let scale = 1;
    if (anchorX > originX - margin) scale = Math.min(scale, (originX - margin) / anchorX);
    if (width - anchorX > stageWidth - originX - margin) scale = Math.min(scale, (stageWidth - originX - margin) / (width - anchorX));

    const cuts = new Set([0, text.length]);
    for (const segment of token.segments ?? []) cuts.add(segment.start).add(segment.end);
    const points = [...cuts].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const style = (token.segments ?? []).findLast((s) => s.start <= points[i] && s.end >= points[i + 1])?.style ?? '';
      parts.push({ text: text.slice(points[i], points[i + 1]), style });
    }
    return { parts, originX, shift: -anchorX * scale, scale };
  });

  const sentence = $derived.by(() => {
    if (!token || !app.settings.context) return null;
    let first = index;
    while (first > 0 && !(tokens[first - 1].flags & UNIT.SENTENCE)) first--;
    let last = index;
    while (last < tokens.length - 1 && !(tokens[last].flags & UNIT.SENTENCE)) last++;
    const text = doc.paras[token.para].t;
    return {
      before: text.slice(tokens[first].start, token.start),
      now: text.slice(token.start, token.end),
      after: text.slice(token.end, tokens[last].end),
    };
  });

  // ---- input

  function keys(event) {
    if (event.target.closest('select, input')) return;
    // a focused button handles Space and Enter itself
    if ((event.key === ' ' || event.key === 'Enter') && event.target.closest('button')) return;
    const unit = event.shiftKey ? UNIT.PARAGRAPH : UNIT.SENTENCE;
    const actions = {
      ' ': () => player.toggle(),
      Enter: () => player.toggle(),
      ArrowLeft: () => player.back(unit),
      ArrowRight: () => player.forward(unit),
      ArrowUp: () => setWpm(wpm + 10),
      ArrowDown: () => setWpm(wpm - 10),
      Escape: () => (panel ? (panel = null) : exit()),
      b: () => onbookmark(position()),
      PageUp: () => player.back(UNIT.CHAPTER),
      PageDown: () => player.forward(UNIT.CHAPTER),
    };
    const action = actions[event.key];
    if (!action || !ready) return;
    event.preventDefault();
    action();
  }

  let touch = null;
  function pointerDown(event) {
    touch = { x: event.clientX, y: event.clientY };
  }
  function pointerUp(event) {
    if (!touch || !ready) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) player.toggle();
    else if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) dx < 0 ? player.forward() : player.back();
    else if (Math.abs(dy) > 48 && Math.abs(dy) > Math.abs(dx) * 1.5) setWpm(wpm + (dy < 0 ? 25 : -25));
  }

  function seekFraction(event) {
    const box = event.currentTarget.getBoundingClientRect();
    player.seek(Math.round(((event.clientX - box.left) / box.width) * (tokens.length - 1)));
  }

  onMount(() => {
    prepare(start);
    document.fonts?.ready.then(() => fontTick++);

    const save = setInterval(() => playing && onposition(position(), wpm), 10000);
    // scripts edited on the server show up here without a reload
    const watch = setInterval(() => {
      if (document.hidden) return;
      loadPlugins().then((changed) => changed && prepare(position())).catch(() => {});
    }, 4000);
    const hidden = () => document.hidden && player.pause();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', report);
    root?.focus();

    return () => {
      clearInterval(save);
      clearInterval(watch);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', report);
      player.pause();
      report();
    };
  });

  $effect(() => {
    font;
    document.fonts?.load(`400 ${fontSize}px ${font.family}`).then(() => fontTick++);
  });
</script>

<svelte:window onkeydown={keys} />

<div class="reader" class:playing bind:this={root} tabindex="-1">
  <header class="chrome">
    <button class="icon quiet" onclick={exit} aria-label="Lesemodus verlassen"><Icon name="close" /></button>
    <div class="where">
      <span class="booktitle">{book.title}</span>
      <span class="muted small">{doc.chapters[chapterIndex]?.title}</span>
    </div>
    <select value={app.settings.activeProfile} onchange={changeProfile} aria-label="Leseprofil">
      {#each app.settings.profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}
    </select>
  </header>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" bind:clientWidth={stageWidth} onpointerdown={pointerDown} onpointerup={pointerUp} style="--size: {fontSize}px; --family: {font.family}">
    {#if failure}
      <p class="note error">Die Scripts konnten den Text nicht vorbereiten: {failure}</p>
    {:else if !ready}
      <p class="note muted">Text wird vorbereitet …</p>
    {:else if placed}
      <p class="note" aria-live="polite">{message}</p>
      <div class="line">
        {#if app.settings.guides}
          <i class="guide top" style="left: {placed.originX}px"></i>
          <i class="guide bottom" style="left: {placed.originX}px"></i>
        {/if}
        <div class="word" style="left: {placed.originX}px; transform: translateX({placed.shift}px) scale({placed.scale})">
          {#each placed.parts as part}<span class={part.style}>{part.text}</span>{/each}
        </div>
      </div>
      {#if sentence}
        <p class="context">{sentence.before}<b>{sentence.now}</b>{sentence.after}</p>
      {/if}
    {/if}
  </div>

  {#if ready}
    <footer class="chrome">
      {#if !playing && summary.length && player.started}
        <dl class="summary small">
          <div><dt>Gelesen</dt><dd>{formatNumber(player.session.words)} Wörter in {formatDuration(player.session.activeMs)}</dd></div>
          {#each summary as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}
        </dl>
      {/if}
      {#each scriptErrors as problem}
        <p class="error small">Script {problem.plugin} wurde abgeschaltet ({problem.hook}): {problem.message}</p>
      {/each}

      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="track" onclick={seekFraction} style="--done: {(index / Math.max(1, tokens.length - 1)) * 100}%" title="Im Text springen"></div>

      <div class="controls">
        <div class="group">
          <button class="icon quiet" onclick={() => (panel = panel === 'toc' ? null : 'toc')} aria-label="Inhalt" aria-expanded={panel === 'toc'}><Icon name="list" /></button>
          <button class="icon quiet" onclick={() => onbookmark(position())} aria-label="Lesezeichen setzen"><Icon name="bookmark" /></button>
        </div>
        <div class="group transport">
          <button class="icon quiet" onclick={() => player.back(UNIT.PARAGRAPH)} aria-label="Absatz zurück"><Icon name="backFar" /></button>
          <button class="icon quiet" onclick={() => player.back()} aria-label="Satz zurück"><Icon name="back" /></button>
          <button class="icon primary play" onclick={() => player.toggle()} aria-label={playing ? 'Anhalten' : 'Lesen'}><Icon name={playing ? 'pause' : 'play'} size={26} /></button>
          <button class="icon quiet" onclick={() => player.forward()} aria-label="Satz vor"><Icon name="forward" /></button>
          <button class="icon quiet" onclick={() => player.forward(UNIT.PARAGRAPH)} aria-label="Absatz vor"><Icon name="forwardFar" /></button>
        </div>
        <div class="group speed">
          <button class="icon quiet" onclick={() => setWpm(wpm - 10)} aria-label="Langsamer"><Icon name="down" /></button>
          <span class="wpm"><b>{wpm}</b> <span class="muted small">W/min</span></span>
          <button class="icon quiet" onclick={() => setWpm(wpm + 10)} aria-label="Schneller"><Icon name="up" /></button>
        </div>
      </div>
      <p class="times muted small">
        <span>Kapitel: noch {formatDuration(chapterLeft)}</span>
        <span>Buch: noch {formatDuration(remaining[index])}</span>
      </p>
    </footer>
  {/if}

  {#if panel === 'toc'}
    <aside class="panel">
      <h2>Inhalt</h2>
      <ol>
        {#each doc.chapters as chapter, i}
          <li><button class="quiet" class:here={i === chapterIndex} onclick={() => { player.seek(chapterStarts[i]); panel = null; }}>{chapter.title}</button></li>
        {/each}
      </ol>
      {#if bookmarks.length}
        <h2>Lesezeichen</h2>
        <ol>
          {#each bookmarks as mark (mark.id)}
            <li><button class="quiet" onclick={() => { player.seek(indexAt(mark)); panel = null; }}>{mark.snippet} …</button></li>
          {/each}
        </ol>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .reader {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    background: var(--bg);
    outline: none;
    overflow: hidden;
  }
  .chrome {
    transition: opacity 0.4s;
    padding: 0.6rem max(1rem, env(safe-area-inset-right)) 0.6rem max(1rem, env(safe-area-inset-left));
  }
  /* While the text runs, everything except the word steps back. */
  .playing .chrome {
    opacity: 0.22;
  }
  .playing .chrome:hover,
  .playing .chrome:focus-within {
    opacity: 1;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .where {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .where span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .booktitle {
    font-family: var(--book);
    font-weight: 600;
  }

  .stage {
    position: relative;
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    align-items: center;
    min-width: 0;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .note {
    align-self: end;
    text-align: center;
    padding: 0 1rem 1.5rem;
    min-height: 3rem;
    color: var(--accent);
  }
  .note.muted {
    color: var(--muted);
  }
  .note.error {
    color: var(--danger);
  }
  .line {
    position: relative;
    height: calc(var(--size) * 2.4);
    border-block: 1px solid var(--line);
  }
  .guide {
    position: absolute;
    width: 2px;
    margin-left: -1px;
    height: calc(var(--size) * 0.35);
    background: var(--accent);
  }
  .guide.top {
    top: 0;
  }
  .guide.bottom {
    bottom: 0;
  }
  .word {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    white-space: pre;
    transform-origin: 0 50%;
    font: 400 var(--size) / 1 var(--family);
  }
  .word .accent {
    color: var(--accent);
  }
  .word .dim {
    opacity: 0.4;
  }
  .word .underline {
    text-decoration: underline;
    text-decoration-thickness: 0.06em;
    text-underline-offset: 0.18em;
  }
  .context {
    align-self: start;
    max-width: 40rem;
    margin: 1.75rem auto 0;
    padding: 0 1.25rem;
    text-align: center;
    font-family: var(--book);
    line-height: 1.6;
    color: var(--muted);
    opacity: 0.75;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .context b {
    color: var(--text);
    font-weight: 400;
  }
  .playing .context {
    opacity: 0.4;
  }

  footer {
    display: grid;
    gap: 0.5rem;
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  }
  .track {
    height: 14px;
    cursor: pointer;
    background: linear-gradient(to right, var(--accent) var(--done), var(--line) var(--done)) center / 100% 2px no-repeat;
  }
  .controls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }
  .speed {
    justify-content: flex-end;
  }
  .play {
    width: 3.1rem;
    height: 3.1rem;
    border-radius: 50%;
    margin: 0 0.35rem;
  }
  .wpm {
    min-width: 5.2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .times {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.5rem;
    margin: 0;
  }
  .summary div {
    display: flex;
    gap: 0.4rem;
  }
  .summary dt {
    color: var(--muted);
  }
  .summary dd {
    margin: 0;
  }

  .panel {
    position: absolute;
    left: 0.75rem;
    bottom: 7.5rem;
    width: min(24rem, calc(100vw - 1.5rem));
    max-height: 60dvh;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1rem;
  }
  .panel h2 {
    font-size: var(--s1);
    margin: 0.5rem 0;
  }
  .panel ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .panel button {
    text-align: left;
    padding: 0.3rem 0.4rem;
  }
  .panel .here {
    color: var(--accent);
  }

  @media (max-width: 34rem) {
    .controls {
      grid-template-columns: 1fr 1fr;
    }
    .transport {
      grid-column: 1 / -1;
      grid-row: 1;
      justify-content: center;
    }
    .panel {
      bottom: 11rem;
    }
  }
</style>
