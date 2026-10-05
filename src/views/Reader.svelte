<script>
  // The book screen. The upper third shows the reading position one word at a time, the lower
  // two thirds the document itself: the original pages of a PDF, the text of everything else.
  // The script engine decides what is shown, for how long and where; this component draws the
  // result and forwards input to the player.
  import { onMount } from 'svelte';
  import { engine } from '../lib/engine.js';
  import Icon from '../lib/Icon.svelte';
  import { addReading } from '../lib/library.js';
  import { Player, UNIT } from '../lib/player.js';
  import { activeProfile, app, profileStack, READER_FONTS, saveSettings, toast } from '../lib/state.svelte.js';
  import DocPdf from './DocPdf.svelte';
  import DocText from './DocText.svelte';

  let { book, doc, start, wpm: initialWpm, bookmarks, onexit, onposition, onbookmark, onunbookmark } = $props();

  let tokens = $state.raw([]);
  let chapterStarts = $state.raw([]); // first token index of every chapter
  let index = $state(0);
  let playing = $state(false);
  let message = $state('');
  let wpm = $state(initialWpm);
  let ready = $state(false);
  let failure = $state('');
  let scriptErrors = $state([]);
  let panel = $state(null);
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let where = $state(''); // page or chapter shown below
  let docView = $state();
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
      .then((result) => run === retimeRun && (player.ms = result.ms))
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

  // ---- the document below the word

  const printed = book.format === 'pdf';
  const showOriginal = $derived(printed && app.settings.pdfView !== 'text');
  const zoom = $derived(showOriginal ? (app.settings.pdfZoom ?? 1) : (app.settings.textZoom ?? 1));
  // the word to mark in the document, also before the text is prepared
  const mark = $derived(token ? { para: token.para, start: token.start, end: token.end } : { para: start.para, start: start.offset, end: start.offset + 1 });

  function setZoom(value) {
    if (showOriginal) app.settings.pdfZoom = value;
    else app.settings.textZoom = value;
    saveSettings();
  }

  function setPdfView(view) {
    app.settings.pdfView = view;
    saveSettings();
  }

  function jump(pos) {
    if (!ready) return;
    player.seek(indexAt(pos));
    if (!playing) onposition(position(), wpm);
  }

  function addMark() {
    onbookmark(position());
  }

  // ---- input

  function keys(event) {
    if (event.target.closest('select, input')) return;
    // Enter activates a focused button; Space always starts and stops, like in a media player
    if (event.key === 'Enter' && event.target.closest('button')) return;
    if (event.key === ' ') event.target.closest('button')?.blur();
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

    // Only the document zooms here, not the page: undo any page zoom and keep it off while
    // this screen is open (Safari needs the gesture events as well).
    const viewport = document.querySelector('meta[name="viewport"]');
    const original = viewport?.getAttribute('content');
    viewport?.setAttribute('content', `${original}, maximum-scale=1`);
    const stop = (event) => event.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);

    const save = setInterval(() => playing && onposition(position(), wpm), 10000);
    const hidden = () => document.hidden && player.pause();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', report);
    root?.focus();

    return () => {
      viewport?.setAttribute('content', original);
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
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
      <button class="icon quiet" onclick={exit} aria-label="Zur Bibliothek"><Icon name="back" /></button>
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
            <button class="icon quiet roomy" onclick={addMark} aria-label="Lesezeichen setzen"><Icon name="bookmark" /></button>
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
      <span class="pagelabel">{where}</span>
      <div class="zoom" role="group" aria-label="Zoom">
        <button class="icon quiet" onclick={() => docView?.zoomBy(1 / 1.25)} aria-label="Verkleinern"><Icon name="minus" size={18} /></button>
        <span class="percent">{Math.round(zoom * 100)} %</span>
        <button class="icon quiet" onclick={() => docView?.zoomBy(1.25)} aria-label="Vergrößern"><Icon name="plus" size={18} /></button>
      </div>
      {#if printed}
        <div class="switch" role="group" aria-label="Ansicht">
          <button class:active={showOriginal} onclick={() => setPdfView('original')}>Original</button>
          <button class:active={!showOriginal} onclick={() => setPdfView('text')}>Text</button>
        </div>
      {/if}
    </header>

    {#each scriptErrors as problem}
      <p class="error small problem">Script {problem.plugin} wurde abgeschaltet ({problem.hook}): {problem.message}</p>
    {/each}

    <div class="docarea">
      {#if showOriginal}
        <DocPdf bind:this={docView} bookId={book.id} {doc} {mark} {zoom} onzoom={setZoom} onjump={jump} onpage={(label) => (where = label)} />
      {:else}
        <DocText bind:this={docView} {doc} {mark} {zoom} onzoom={setZoom} onjump={jump} onpage={(label) => (where = label)} />
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
          {#each bookmarks as saved (saved.id)}
            <li class="bookmark">
              <button class="quiet" onclick={() => { player.seek(indexAt(saved)); panel = null; }}>{saved.snippet} …</button>
              <button class="icon quiet" onclick={() => onunbookmark(saved)} aria-label="Lesezeichen entfernen"><Icon name="close" size={16} /></button>
            </li>
          {/each}
        </ol>
      </aside>
    {/if}
  </section>
</div>

<style>
  /* Upper third: the word. Lower two thirds: the document. No page zoom anywhere here. */
  .reader {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 2fr);
    background: var(--bg);
    outline: none;
    overflow: hidden;
    touch-action: pan-x pan-y;
  }
  .focus {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-height: 0;
    min-width: 0;
    border-bottom: 1px solid var(--line);
  }
  .sheet {
    position: relative;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
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
    gap: 0.5rem;
    padding-top: max(0.4rem, env(safe-area-inset-top));
    padding-left: max(0.5rem, env(safe-area-inset-left));
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
    max-width: 8.5rem;
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
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem max(0.75rem, env(safe-area-inset-right)) 0.25rem max(1rem, env(safe-area-inset-left));
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .pagelabel {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .zoom {
    display: flex;
    align-items: center;
    margin-left: auto;
  }
  .zoom .icon {
    padding: 0.3rem;
  }
  .percent {
    min-width: 3.2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .switch {
    display: flex;
  }
  .switch button {
    border-radius: 0;
    padding: 0.15rem 0.55rem;
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
  .problem {
    padding: 0.4rem 1rem;
    border-bottom: 1px solid var(--line);
  }
  /* a fixed-height box, so the document inside scrolls instead of growing */
  .docarea {
    grid-row: 3;
    min-height: 0;
    min-width: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
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
  .panel .bookmark {
    display: flex;
    align-items: start;
    justify-content: space-between;
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
    .percent {
      min-width: 2.8rem;
    }
  }

  /* Phones held sideways: word and document side by side. */
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
