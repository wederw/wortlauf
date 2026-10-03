<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { app, formatDuration, formatNumber, go, toast } from '../lib/state.svelte.js';

  let books = $state([]);
  let loading = $state(true);
  let uploading = $state([]);
  let dragging = $state(false);
  let picker;

  const FORMAT = { pdf: 'PDF', epub: 'ePub', docx: 'Word', txt: 'Text', md: 'Markdown', html: 'HTML' };

  async function load() {
    try {
      books = await api.get('/api/books');
    } catch (error) {
      toast(error.message, 'error');
    }
    loading = false;
  }

  async function upload(files) {
    for (const file of files) {
      uploading = [...uploading, file.name];
      const body = new FormData();
      body.append('file', file);
      try {
        await api.post('/api/books', body);
        await load();
      } catch (error) {
        toast(`${file.name}: ${error.message}`, 'error');
      }
      uploading = uploading.filter((name) => name !== file.name);
    }
  }

  async function remove(book) {
    if (!confirm(`„${book.title}“ mit Lesestand und Lesezeichen entfernen?`)) return;
    try {
      await api.del(`/api/books/${book.id}`);
      books = books.filter((b) => b.id !== book.id);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function drop(event) {
    event.preventDefault();
    dragging = false;
    upload([...event.dataTransfer.files]);
  }

  onMount(load);
</script>

<svelte:window
  ondragover={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragleave={(event) => {
    if (!event.relatedTarget) dragging = false;
  }}
  ondrop={drop}
/>

<main class="page">
  <header class="topbar">
    <h1>Bibliothek</h1>
    <nav>
      <button class="quiet" onclick={() => go('stats')}>Statistik</button>
      <button class="quiet" onclick={() => go('settings')}>Einstellungen</button>
    </nav>
  </header>

  <input
    bind:this={picker}
    type="file"
    multiple
    hidden
    accept=".pdf,.epub,.docx,.txt,.md,.markdown,.html,.htm"
    onchange={(event) => {
      upload([...event.target.files]);
      event.target.value = '';
    }}
  />

  {#if loading}
    <p class="muted">Lädt …</p>
  {:else if books.length === 0 && uploading.length === 0}
    <div class="empty" class:dragging>
      <p>Hier ist noch nichts. Zieh eine Datei in dieses Fenster oder wähle eine aus.</p>
      <p class="muted small">PDF, ePub, Word, Text, Markdown und HTML</p>
      <button class="primary" onclick={() => picker.click()}>Datei hochladen</button>
    </div>
  {:else}
    <div class="actions">
      <button class="primary" onclick={() => picker.click()}>Datei hochladen</button>
      {#if dragging}<span class="muted">Loslassen zum Hochladen</span>{/if}
    </div>

    <ul class="books">
      {#each uploading as name (name)}
        <li class="pending"><span class="title">{name}</span><span class="muted small">wird eingelesen …</span></li>
      {/each}
      {#each books as book (book.id)}
        {@const done = book.fraction ?? 0}
        <li style="--done: {done * 100}%">
          <a href="#/book/{book.id}">
            <span class="title">{book.title}</span>
            {#if book.author}<span class="author muted">{book.author}</span>{/if}
          </a>
          <div class="meta muted small">
            <span>{FORMAT[book.format]}</span>
            <span>{formatNumber(book.words)} Wörter</span>
            <span>
              {#if done >= 0.995}
                gelesen
              {:else if done > 0}
                {Math.round(done * 100)} %, noch {formatDuration(((1 - done) * book.words * 60000) / app.settings.defaultWpm)}
              {:else}
                {formatDuration((book.words * 60000) / app.settings.defaultWpm)}
              {/if}
            </span>
            <button class="quiet danger small" onclick={() => remove(book)}>Entfernen</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .empty {
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    padding: 3rem 1.5rem;
    display: grid;
    gap: 0.75rem;
    justify-items: start;
  }
  .empty.dragging {
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .books {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* The rule under each book doubles as its progress: the accent part is what has been read. */
  .books li {
    padding: 1rem 0 0.9rem;
    border-bottom: 2px solid transparent;
    border-image: linear-gradient(to right, var(--accent) var(--done, 0%), var(--line) var(--done, 0%)) 1;
  }
  .books a {
    display: grid;
    text-decoration: none;
  }
  .title {
    font-family: var(--book);
    font-size: var(--s1);
    font-weight: 600;
    line-height: 1.25;
  }
  a:hover .title {
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-underline-offset: 0.2em;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1.25rem;
    margin-top: 0.35rem;
  }
  .meta button {
    margin-left: auto;
    padding: 0.1rem 0.4rem;
  }
  .pending {
    display: grid;
  }
</style>
