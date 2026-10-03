<script>
  // Normal view of a book: the extracted text chapter by chapter, for PDFs the original pages
  // (or, on request, their text). The marker is the reading position; the reading mode
  // starts there.
  import { onMount, tick } from 'svelte';
  import Icon from '../lib/Icon.svelte';
  import * as library from '../lib/library.js';
  import { positionAt, wordAt } from '../lib/progress.js';
  import { app, go, saveSettings, toast } from '../lib/state.svelte.js';
  import PdfView from './PdfView.svelte';
  import Reader from './Reader.svelte';

  let { id } = $props();

  let book = $state(null);
  let doc = $state.raw(null);
  let error = $state('');
  let pos = $state({ para: 0, offset: 0 });
  let wpm = $state(app.settings.defaultWpm);
  let bookmarks = $state([]);
  let chapter = $state(0);
  let view = $state('text');
  let reading = $state(false);
  let panel = $state(null);
  let pdfPage = $state(1);
  let article = $state();
  let pdfView = $state();
  let before = []; // characters before each paragraph, for the progress fraction
  let total = 1;

  const span = $derived(doc ? [doc.chapters[chapter].start, doc.chapters[chapter + 1]?.start ?? doc.paras.length] : [0, 0]);
  const fraction = $derived(doc ? Math.min(1, ((before[pos.para] ?? 0) + pos.offset) / total) : 0);
  const markRange = $derived.by(() => {
    if (!doc) return null;
    const [start, end] = wordAt(doc.paras[pos.para].t, pos.offset);
    return { para: pos.para, start, end };
  });

  const preferredView = () => (book?.format === 'pdf' && app.settings.pdfView !== 'text' ? 'pdf' : 'text');

  function setView(next) {
    view = next;
    app.settings.pdfView = next === 'pdf' ? 'original' : 'text';
    saveSettings();
    if (next === 'text') showMarker();
  }

  function chapterOf(para) {
    let found = 0;
    for (let i = 0; i < doc.chapters.length; i++) if (doc.chapters[i].start <= para) found = i;
    return found;
  }

  const persist = () => library.saveProgress(id, { para: pos.para, offset: pos.offset, fraction, wpm });

  async function showMarker() {
    chapter = chapterOf(pos.para);
    await tick();
    article?.querySelector('mark')?.scrollIntoView({ block: 'center' });
  }

  function setMarker(para, offset) {
    pos = { para, offset: wordAt(doc.paras[para].t, offset)[0] };
    persist();
  }

  function clickText(event) {
    // a drag selection is not a click on a word; a double click selects the word itself
    if (event.detail < 2 && !getSelection().isCollapsed) return;
    const at = positionAt(event);
    if (!at) return;
    setMarker(at.para, at.offset);
    if (event.detail >= 2) startReading();
  }

  function goChapter(index) {
    chapter = Math.max(0, Math.min(doc.chapters.length - 1, index));
    panel = null;
    if (view === 'pdf') pdfView?.showPage(doc.paras[doc.chapters[chapter].start].pg ?? 1);
    else scrollTo({ top: 0 });
  }

  function pickWord(at, double) {
    setMarker(at.para, at.offset);
    if (double) startReading();
  }

  function readFromChapter() {
    setMarker(span[0], 0);
    startReading();
  }

  function readFromPage() {
    const para = doc.paras.findIndex((p) => (p.pg ?? 0) >= pdfPage);
    if (para < 0) return toast('Auf dieser Seite und danach steht kein Text.');
    setMarker(para, 0);
    startReading();
  }

  function startReading() {
    getSelection().removeAllRanges();
    panel = null;
    reading = true;
  }

  async function leaveReader(position, speed) {
    pos = position;
    wpm = speed;
    reading = false;
    view = preferredView();
    persist();
    await showMarker();
  }

  async function addBookmark(position = pos) {
    const text = doc.paras[position.para].t;
    try {
      const mark = await library.addBookmark(id, {
        para: position.para,
        offset: position.offset,
        snippet: text.slice(position.offset, position.offset + 90),
      });
      bookmarks = [...bookmarks, mark].sort((a, b) => a.para - b.para || a.offset - b.offset);
      toast('Lesezeichen gesetzt.');
    } catch (failure) {
      toast(failure.message, 'error');
    }
  }

  async function removeBookmark(mark) {
    await library.removeBookmark(mark.id).catch(() => {});
    bookmarks = bookmarks.filter((b) => b.id !== mark.id);
  }

  function openBookmark(mark) {
    pos = { para: Math.min(mark.para, doc.paras.length - 1), offset: mark.offset };
    panel = null;
    persist();
    if (view === 'pdf') tick().then(() => pdfView?.reveal());
    else showMarker();
  }

  function keys(event) {
    if (reading || event.target.closest('input, select, textarea, button')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      startReading();
    }
  }

  onMount(async () => {
    try {
      const [{ book: meta, doc: content }, marks] = await Promise.all([
        library.getBook(id),
        library.listBookmarks(id).catch(() => []),
      ]);
      let sum = 0;
      before = content.paras.map((p) => {
        const at = sum;
        sum += p.t.length + 1;
        return at;
      });
      total = Math.max(1, sum);
      book = meta;
      doc = content;
      view = preferredView();
      bookmarks = marks;
      const saved = await library.loadProgress(id);
      if (saved) {
        pos = { para: Math.min(saved.para, content.paras.length - 1), offset: saved.offset };
        wpm = saved.wpm ?? wpm;
      }
      await showMarker();
    } catch (failure) {
      error = failure.message;
    }
  });
</script>

<svelte:window onkeydown={keys} />

{#if error}
  <main class="page">
    <p class="error" style="margin-bottom: 1rem">{error}</p>
    <button onclick={() => go('')}>Zur Bibliothek</button>
  </main>
{:else if !doc}
  <p class="page muted">Lädt …</p>
{:else if reading}
  <Reader {book} {doc} start={pos} {wpm} {bookmarks} onexit={leaveReader} onposition={(position, speed) => { pos = position; wpm = speed; persist(); }} onbookmark={addBookmark} />
{:else}
  <header class="bar">
    <button class="quiet" onclick={() => go('')}>Bibliothek</button>
    <div class="tools">
      {#if book.format === 'pdf'}
        <div class="switch" role="group" aria-label="Ansicht">
          <button class:active={view === 'pdf'} onclick={() => setView('pdf')}>Original</button>
          <button class:active={view === 'text'} onclick={() => setView('text')}>Text</button>
        </div>
      {/if}
      <button class="icon quiet" onclick={() => (panel = panel === 'toc' ? null : 'toc')} aria-label="Inhalt" aria-expanded={panel === 'toc'}><Icon name="list" /></button>
      <button class="icon quiet" onclick={() => (panel = panel === 'marks' ? null : 'marks')} aria-label="Lesezeichen" aria-expanded={panel === 'marks'}><Icon name="bookmark" /></button>
      <button class="primary" onclick={startReading}>{fraction > 0 ? 'Weiterlesen' : 'Lesen'}</button>
    </div>
    <div class="track" style="--done: {fraction * 100}%"></div>
  </header>

  {#if panel}
    <aside class="panel">
      {#if panel === 'toc'}
        <h2>Inhalt</h2>
        <ol>
          {#each doc.chapters as entry, index}
            <li><button class="quiet" class:here={index === chapterOf(pos.para)} onclick={() => goChapter(index)}>{entry.title}</button></li>
          {/each}
        </ol>
      {:else}
        <h2>Lesezeichen</h2>
        <button onclick={() => addBookmark()}>Lesezeichen an der Marke setzen</button>
        {#if bookmarks.length === 0}
          <p class="muted small">Noch keine Lesezeichen.</p>
        {/if}
        <ol>
          {#each bookmarks as mark (mark.id)}
            <li class="mark">
              <button class="quiet" onclick={() => openBookmark(mark)}>{mark.snippet} …</button>
              <button class="icon quiet" onclick={() => removeBookmark(mark)} aria-label="Lesezeichen entfernen"><Icon name="close" size={16} /></button>
            </li>
          {/each}
        </ol>
      {/if}
    </aside>
  {/if}

  <main class="page" class:wide={view === 'pdf'}>
    <h1>{book.title}</h1>
    {#if book.author}<p class="muted author">{book.author}</p>{/if}

    {#if view === 'pdf'}
      <div class="chapterhead">
        <span class="muted">Seite {pdfPage}</span>
        <button onclick={readFromPage}>Ab dieser Seite lesen</button>
      </div>
      <p class="muted small pdfhint">Ein Klick auf ein Wort setzt die Lesemarke, ein Doppelklick startet dort den Lesemodus.</p>
      <PdfView bind:this={pdfView} bookId={id} {doc} mark={markRange} onpick={pickWord} onpage={(number) => (pdfPage = number)} />
    {:else}
      <div class="chapterhead">
        <span class="muted">{doc.chapters[chapter].title}</span>
        <button onclick={readFromChapter}>Ab hier lesen</button>
      </div>

      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <article bind:this={article} onclick={clickText}>
        {#each { length: span[1] - span[0] } as _, k (span[0] + k)}
          {@const i = span[0] + k}
          {@const para = doc.paras[i]}
          {#if para.pg && para.pg !== doc.paras[i - 1]?.pg}<span class="pageno muted small">Seite {para.pg}</span>{/if}
          {#if i === pos.para}
            {@const [from, to] = wordAt(para.t, pos.offset)}
            <p data-i={i} class:heading={para.h}>{para.t.slice(0, from)}<mark>{para.t.slice(from, to)}</mark>{para.t.slice(to)}</p>
          {:else}
            <p data-i={i} class:heading={para.h}>{para.t}</p>
          {/if}
        {/each}
      </article>

      <nav class="pager">
        <button onclick={() => goChapter(chapter - 1)} disabled={chapter === 0}>Vorheriges Kapitel</button>
        <span class="muted small">{chapter + 1} von {doc.chapters.length}</span>
        <button onclick={() => goChapter(chapter + 1)} disabled={chapter === doc.chapters.length - 1}>Nächstes Kapitel</button>
      </nav>
      <p class="muted small hint">Ein Klick auf ein Wort setzt die Lesemarke, ein Doppelklick startet dort den Lesemodus.</p>
    {/if}
  </main>
{/if}

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--bg);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem 0.6rem;
  }
  .tools {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .track {
    position: absolute;
    inset: auto 0 0;
    height: 2px;
    background: linear-gradient(to right, var(--accent) var(--done), var(--line) var(--done));
  }
  .switch {
    display: flex;
  }
  .switch button {
    border-radius: 0;
    padding-block: 0.3rem;
  }
  .switch button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
    border-right: 0;
  }
  .switch button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .switch .active {
    background: var(--surface);
    font-weight: 700;
  }
  .panel {
    position: fixed;
    top: 3.4rem;
    right: 0.75rem;
    z-index: 11;
    width: min(24rem, calc(100vw - 1.5rem));
    max-height: calc(100dvh - 5rem);
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1rem;
  }
  .panel h2 {
    font-size: var(--s1);
    margin-bottom: 0.75rem;
  }
  .panel ol {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
  }
  .panel li button {
    text-align: left;
    padding: 0.3rem 0.4rem;
  }
  .panel li button.here {
    color: var(--accent);
  }
  .panel .mark {
    display: flex;
    align-items: start;
    justify-content: space-between;
  }
  .page.wide {
    max-width: 60rem;
  }
  .author {
    margin-top: 0.25rem;
  }
  .chapterhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 1.5rem 0;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--line);
  }
  article {
    font-family: var(--book);
    font-size: 1.125rem;
    line-height: 1.7;
    max-width: var(--measure);
    cursor: text;
  }
  article p {
    margin-bottom: 0.85em;
    hyphens: auto;
  }
  article p.heading {
    font-weight: 600;
    font-size: var(--s1);
    line-height: 1.3;
    margin: 1.6em 0 0.6em;
    hyphens: manual;
  }
  article mark {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 2px;
    padding: 0 0.1em;
    margin: 0 -0.1em;
  }
  .pageno {
    display: block;
    font-family: var(--ui);
    margin: 1.5em 0 0.3em;
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 2.5rem;
  }
  .hint {
    margin-top: 1.5rem;
  }
  .pdfhint {
    margin: -0.75rem 0 1rem;
  }
</style>
