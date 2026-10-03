<script>
  // Reading mode. The upper third shows one word at a time, the lower two thirds the whole
  // page around it. The script engine decides what is shown, for how long and where; this
  // component only draws the result and forwards input to the player.
  import { onMount } from 'svelte';
  import { engine } from '../lib/engine.js';
  import Icon from '../lib/Icon.svelte';
  import { addReading } from '../lib/library.js';
  import { Player, UNIT } from '../lib/player.js';
  import { pageOf, paginate } from '../lib/progress.js';
  import { activeProfile, app, formatDuration, formatNumber, profileStack, READER_FONTS, saveSettings, toast } from '../lib/state.svelte.js';
  import PageView from './PageView.svelte';
  import PdfPage from './PdfPage.svelte';

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
  let stageHeight = $state(0);
  let pageWidth = $state(0);
  let pageHeight = $state(0);
  let capacity = $state(0); // characters that fit on one text page
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
    addReading({ book_id: book.id, started: startedAt, active_ms: activeMs, words });
  }

  function exit() {
    player.pause();
    report();
    onexit(position(), wpm);
  }

  // ---- the word

  const chapterIndex = $derived.by(() => {
    const para = token ? token.para : start.para;
    let found = 0;
    for (let i = 0; i < doc.chapters.length; i++) if (doc.chapters[i].start <= para) found = i;
    return found;
  });
  const chapterLeft = $derived(remaining[index] - (remaining[chapterStarts[chapterIndex + 1] ?? tokens.length] ?? 0));
  const font = $derived(READER_FONTS[app.settings.readerFont] ?? READER_FONTS.literata);
  const fontSize = $derived(Math.max(20, Math.min(app.settings.wordSize, stageWidth / 9, stageHeight / 2.6)));

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

  // ---- the page below the word

  const printed = book.format === 'pdf';
  const pageStarts = $derived(paginate(doc, capacity || 1800));
  const pageIndex = $derived(pageOf(pageStarts, token ? token.para : start.para));
  const pageFrom = $derived(pageStarts[pageIndex]);
  const pageTo = $derived(pageStarts[pageIndex + 1] ?? doc.paras.length);
  const pageLabel = $derived(
    printed ? `Seite ${doc.paras[pageFrom].pg} von ${doc.paras.at(-1).pg}` : `Seite ${pageIndex + 1} von ${pageStarts.length}`,
  );
  const showOriginal = $derived(printed && app.settings.pageView === 'original');

  // A text page holds about as much as the area below the word shows. Small changes, such as
  // a mobile browser hiding its address bar, keep the pages as they are.
  $effect(() => {
    if (!pageWidth || !pageHeight) return;
    const lines = Math.floor((pageHeight - 40) / 27);
    const perLine = Math.floor(Math.min(pageWidth - 32, 544) / 8.6);
    const next = Math.max(400, Math.round((lines * perLine * 0.8) / 100) * 100);
    if (!capacity || Math.abs(next - capacity) / capacity > 0.15) capacity = next;
  });

  function setPageView(view) {
    app.settings.pageView = view;
    saveSettings();
  }

  function jump(pos) {
    if (!ready) return;
    player.seek(indexAt(pos));
    if (!playing) onposition(position(), wpm);
  }

  function addMark() {
    onbookmark(position());
    panel = null;
  }

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
    const hidden = () => document.hidden && player.pause();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', report);
    root?.focus();

    return () => {
      clearInterval(save);
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
  <section class="focus">
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
    <div
      class="stage"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
      onpointerdown={pointerDown}
      onpointerup={pointerUp}
      style="--size: {fontSize}px; --family: {font.family}"
    >
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
      {/if}
    </div>

    {#if ready}
      <div class="chrome deck">
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="track" onclick={seekFraction} style="--done: {(index / Math.max(1, tokens.length - 1)) * 100}%" title="Im Text springen"></div>
        <div class="controls">
          <div class="group">
            <button class="icon quiet" onclick={() => (panel = panel === 'toc' ? null : 'toc')} aria-label="Inhalt und Lesezeichen" aria-expanded={panel === 'toc'}><Icon name="list" /></button>
            <button class="icon quiet roomy" onclick={() => onbookmark(position())} aria-label="Lesezeichen setzen"><Icon name="bookmark" /></button>
          </div>
          <div class="group transport">
            <button class="icon quiet roomy" onclick={() => player.back(UNIT.PARAGRAPH)} aria-label="Absatz zurück"><Icon name="backFar" /></button>
            <button class="icon quiet" onclick={() => player.back()} aria-label="Satz zurück"><Icon name="back" /></button>
            <button class="icon primary play" onclick={() => player.toggle()} aria-label={playing ? 'Anhalten' : 'Lesen'}><Icon name={playing ? 'pause' : 'play'} size={24} /></button>
            <button class="icon quiet" onclick={() => player.forward()} aria-label="Satz vor"><Icon name="forward" /></button>
            <button class="icon quiet roomy" onclick={() => player.forward(UNIT.PARAGRAPH)} aria-label="Absatz vor"><Icon name="forwardFar" /></button>
          </div>
          <div class="group speed">
            <button class="icon quiet" onclick={() => setWpm(wpm - 10)} aria-label="Langsamer"><Icon name="down" /></button>
            <span class="wpm"><b>{wpm}</b><span class="muted small">W/min</span></span>
            <button class="icon quiet" onclick={() => setWpm(wpm + 10)} aria-label="Schneller"><Icon name="up" /></button>
          </div>
        </div>
      </div>
    {/if}
  </section>

  <section class="sheet">
    <header class="sheethead small">
      <span class="pagelabel">{pageLabel}</span>
      {#if ready}
        <span class="muted times">
          <span>Kapitel noch {formatDuration(chapterLeft)}</span>
          <span>Buch noch {formatDuration(remaining[index])}</span>
        </span>
      {/if}
      {#if printed}
        <div class="switch" role="group" aria-label="Seitenansicht">
          <button class:active={!showOriginal} onclick={() => setPageView('text')}>Text</button>
          <button class:active={showOriginal} onclick={() => setPageView('original')}>Original</button>
        </div>
      {/if}
    </header>

    {#if scriptErrors.length || (!playing && summary.length && player.started)}
      <div class="notes small">
        {#if !playing && summary.length && player.started}
          <dl class="summary">
            <div><dt>Gelesen</dt><dd>{formatNumber(player.session.words)} Wörter in {formatDuration(player.session.activeMs)}</dd></div>
            {#each summary as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}
          </dl>
        {/if}
        {#each scriptErrors as problem}
          <p class="error">Script {problem.plugin} wurde abgeschaltet ({problem.hook}): {problem.message}</p>
        {/each}
      </div>
    {/if}

    <div class="pagearea">
      {#if showOriginal}
        <PdfPage bookId={book.id} page={doc.paras[pageFrom].pg ?? 1} />
      {:else}
        <PageView {doc} from={pageFrom} to={pageTo} mark={token} onjump={jump} bind:width={pageWidth} bind:height={pageHeight} />
      {/if}
    </div>

    {#if panel === 'toc'}
      <aside class="panel">
        <h2>Inhalt</h2>
        <ol>
          {#each doc.chapters as chapter, i}
            <li><button class="quiet" class:here={i === chapterIndex} onclick={() => { player.seek(chapterStarts[i]); panel = null; }}>{chapter.title}</button></li>
          {/each}
        </ol>
        <h2>Lesezeichen</h2>
        <button onclick={addMark}>Lesezeichen hier setzen</button>
        <ol>
          {#each bookmarks as mark (mark.id)}
            <li><button class="quiet" onclick={() => { player.seek(indexAt(mark)); panel = null; }}>{mark.snippet} …</button></li>
          {/each}
        </ol>
      </aside>
    {/if}
  </section>
</div>

<style>
  /* Upper third: the word. Lower two thirds: the page. */
  .reader {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 2fr);
    background: var(--bg);
    outline: none;
    overflow: hidden;
  }
  .focus {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-height: 0;
    border-bottom: 1px solid var(--line);
  }
  .sheet {
    position: relative;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
  }

  .chrome {
    transition: opacity 0.4s;
    padding: 0.4rem max(1rem, env(safe-area-inset-right)) 0.4rem max(1rem, env(safe-area-inset-left));
  }
  /* While the text runs, the controls step back. */
  .playing .chrome {
    opacity: 0.22;
  }
  .playing .chrome:hover,
  .playing .chrome:focus-within {
    opacity: 1;
  }
  header.chrome {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-top: max(0.4rem, env(safe-area-inset-top));
  }
  .where {
    display: grid;
    min-width: 0;
    flex: 1;
    line-height: 1.3;
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
  header select {
    max-width: 9rem;
  }

  .stage {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    min-width: 0;
    min-height: 0;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .note {
    align-self: end;
    text-align: center;
    padding: 0 1rem 0.5rem;
    color: var(--accent);
  }
  .note.muted {
    color: var(--muted);
  }
  .note.error {
    color: var(--danger);
  }
  .line {
    grid-row: 2;
    position: relative;
    height: calc(var(--size) * 2.2);
    border-block: 1px solid var(--line);
  }
  .guide {
    position: absolute;
    width: 2px;
    margin-left: -1px;
    height: calc(var(--size) * 0.3);
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

  .deck {
    display: grid;
    gap: 0.25rem;
    padding-bottom: 0.5rem;
  }
  .track {
    height: 12px;
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
    gap: 0.1rem;
  }
  .speed {
    justify-content: flex-end;
  }
  .play {
    width: 2.9rem;
    height: 2.9rem;
    border-radius: 50%;
    margin: 0 0.3rem;
  }
  .wpm {
    display: grid;
    justify-items: center;
    min-width: 3.4rem;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .sheethead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1rem;
    padding: 0.45rem max(1rem, env(safe-area-inset-right)) 0.45rem max(1rem, env(safe-area-inset-left));
    border-bottom: 1px solid var(--line);
  }
  .pagelabel {
    font-weight: 700;
  }
  .times {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1rem;
  }
  .switch {
    display: flex;
    margin-left: auto;
  }
  .switch button {
    border-radius: 0;
    padding: 0.15rem 0.6rem;
  }
  .switch button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
    border-right: 0;
  }
  .switch button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .switch .active {
    background: var(--bg);
    font-weight: 700;
  }
  .notes {
    display: grid;
    gap: 0.25rem;
    padding: 0.5rem max(1rem, env(safe-area-inset-right)) 0.5rem max(1rem, env(safe-area-inset-left));
    border-bottom: 1px solid var(--line);
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
  /* a fixed-height box, so the page inside scrolls instead of growing */
  .pagearea {
    grid-row: 3;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    padding-bottom: env(safe-area-inset-bottom);
  }

  .panel {
    position: absolute;
    top: 0.5rem;
    bottom: 0.5rem;
    left: 0.5rem;
    width: min(24rem, calc(100% - 1rem));
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1rem;
    z-index: 5;
  }
  .panel h2 {
    font-size: var(--s1);
    margin: 0.5rem 0;
  }
  .panel h2 + button {
    margin-bottom: 0.5rem;
  }
  .panel ol {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
  }
  .panel li button {
    text-align: left;
    padding: 0.3rem 0.4rem;
  }
  .panel .here {
    color: var(--accent);
  }

  /* Narrow screens: one row of controls; paragraph jumps and the bookmark button move to
     swipes, Shift+arrows and the contents panel. */
  @media (max-width: 34rem) {
    .roomy {
      display: none;
    }
    .controls {
      gap: 0.25rem;
    }
  }

  /* Phones held sideways: word and page side by side. */
  @media (orientation: landscape) and (max-height: 32rem) {
    .reader {
      grid-template-rows: none;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .focus {
      border-bottom: 0;
      border-right: 1px solid var(--line);
    }
    .roomy {
      display: none;
    }
  }
</style>
