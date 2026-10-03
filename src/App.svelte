<script>
  import { onMount } from 'svelte';
  import { app, loadSettings, toast } from './lib/state.svelte.js';
  import { loadPlugins } from './lib/engine.js';
  import Library from './views/Library.svelte';
  import Book from './views/Book.svelte';
  import Settings from './views/Settings.svelte';
  import Stats from './views/Stats.svelte';

  let failed = $state('');

  async function start() {
    failed = '';
    try {
      await loadSettings();
      loadPlugins().catch((error) => toast(`Scripts konnten nicht geladen werden: ${error.message}`, 'error'));
    } catch (error) {
      failed = error.message;
    }
    app.loading = false;
  }

  onMount(start);

  $effect(() => {
    document.documentElement.dataset.theme = app.settings.theme;
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colour);
  });
</script>

{#if app.loading}
  <p class="page muted">Lädt …</p>
{:else if failed}
  <div class="page">
    <h1>Wortlauf</h1>
    <p class="error" style="margin: 1rem 0">{failed}</p>
    <button onclick={start}>Erneut versuchen</button>
  </div>
{:else if app.route.name === 'book'}
  {#key app.route.arg}
    <Book id={app.route.arg} />
  {/key}
{:else if app.route.name === 'settings'}
  <Settings />
{:else if app.route.name === 'stats'}
  <Stats />
{:else}
  <Library />
{/if}

{#if app.toast}
  <div class="toast" class:bad={app.toast.kind === 'error'} role="status">{app.toast.message}</div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 1.25rem;
    transform: translateX(-50%);
    max-width: min(32rem, calc(100vw - 2rem));
    background: var(--text);
    color: var(--bg);
    padding: 0.6rem 1rem;
    border-radius: var(--radius);
    z-index: 50;
  }
  .toast.bad {
    background: var(--danger);
    color: var(--bg);
  }
</style>
