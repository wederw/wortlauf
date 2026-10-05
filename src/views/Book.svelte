<script>
  // A book: loads it with its reading position and bookmarks, shows it on the reading screen
  // and keeps the position saved.
  import { onMount } from 'svelte';
  import * as library from '../lib/library.js';
  import { app, go, toast } from '../lib/state.svelte.js';
  import Reader from './Reader.svelte';

  let { id } = $props();

  let book = $state.raw(null);
  let doc = $state.raw(null);
  let error = $state('');
  let start = $state.raw({ para: 0, offset: 0 });
  let wpm = $state(app.settings.defaultWpm);
  let bookmarks = $state([]);
  let before = []; // characters before each paragraph, for the progress fraction
  let total = 1;

  function save(position, speed) {
    const fraction = Math.min(1, ((before[position.para] ?? 0) + position.offset) / total);
    library.saveProgress(id, { para: position.para, offset: position.offset, fraction, wpm: speed });
  }

  function leave(position, speed) {
    save(position, speed);
    go('');
  }

  async function addBookmark(position) {
    try {
      const mark = await library.addBookmark(id, {
        para: position.para,
        offset: position.offset,
        snippet: doc.paras[position.para].t.slice(position.offset, position.offset + 90),
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

  onMount(async () => {
    try {
      const [{ book: meta, doc: content }, marks, saved] = await Promise.all([
        library.getBook(id),
        library.listBookmarks(id).catch(() => []),
        library.loadProgress(id),
      ]);
      let sum = 0;
      before = content.paras.map((p) => {
        const at = sum;
        sum += p.t.length + 1;
        return at;
      });
      total = Math.max(1, sum);
      if (saved) {
        start = { para: Math.min(saved.para, content.paras.length - 1), offset: saved.offset };
        wpm = saved.wpm ?? wpm;
      }
      bookmarks = marks;
      book = meta;
      doc = content;
    } catch (failure) {
      error = failure.message;
    }
  });
</script>

{#if error}
  <main class="page">
    <p class="error" style="margin-bottom: 1rem">{error}</p>
    <button onclick={() => go('')}>Zur Bibliothek</button>
  </main>
{:else if !doc}
  <p class="page muted">Lädt …</p>
{:else}
  <Reader {book} {doc} {start} {wpm} {bookmarks} onexit={leave} onposition={save} onbookmark={addBookmark} onunbookmark={removeBookmark} />
{/if}
