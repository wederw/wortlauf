<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { formatDuration, formatNumber, go, toast } from '../lib/state.svelte.js';

  let stats = $state(null);

  const days = $derived.by(() => {
    if (!stats) return [];
    const byDay = new Map(stats.days.map((d) => [d.day, d]));
    const out = [];
    for (let back = 13; back >= 0; back--) {
      const date = new Date();
      date.setDate(date.getDate() - back);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      out.push({ label: date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }), ms: byDay.get(key)?.ms ?? 0, words: byDay.get(key)?.words ?? 0 });
    }
    return out;
  });
  const peak = $derived(Math.max(1, ...days.map((d) => d.ms)));

  onMount(async () => {
    try {
      stats = await api.get(`/api/stats?tz_offset_min=${new Date().getTimezoneOffset()}`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
</script>

<main class="page">
  <header class="topbar">
    <h1>Statistik</h1>
    <nav><button class="quiet" onclick={() => go('')}>Zur Bibliothek</button></nav>
  </header>

  {#if !stats}
    <p class="muted">Lädt …</p>
  {:else if stats.total.n === 0}
    <p class="muted">Noch keine Lesesitzung. Öffne ein Buch und starte den Lesemodus.</p>
  {:else}
    <dl class="totals">
      <div><dt>Lesezeit</dt><dd>{formatDuration(stats.total.ms)}</dd></div>
      <div><dt>Wörter</dt><dd>{formatNumber(stats.total.words)}</dd></div>
      <div><dt>Mittleres Tempo</dt><dd>{formatNumber(stats.total.words / (stats.total.ms / 60000))} W/min</dd></div>
      <div><dt>Sitzungen</dt><dd>{stats.total.n}</dd></div>
    </dl>

    <h2>Letzte 14 Tage</h2>
    <table class="days">
      <tbody>
        {#each days as day}
          <tr>
            <th scope="row">{day.label}</th>
            <td class="bar"><span style="width: {(day.ms / peak) * 100}%"></span></td>
            <td class="value">{day.ms ? formatDuration(day.ms) : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h2>Nach Buch</h2>
    <table class="books">
      <tbody>
        {#each stats.books as book}
          <tr>
            <th scope="row"><a href="#/book/{book.id}">{book.title}</a></th>
            <td class="value">{formatDuration(book.ms)}</td>
            <td class="value">{formatNumber(book.words)} Wörter</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</main>

<style>
  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1rem 2rem;
    margin: 0 0 2.5rem;
  }
  dt {
    color: var(--muted);
    font-size: var(--s-1);
  }
  dd {
    margin: 0;
    font-family: var(--book);
    font-size: var(--s2);
    font-variant-numeric: tabular-nums;
  }
  h2 {
    font-size: var(--s1);
    margin: 2rem 0 0.75rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th {
    text-align: left;
    font-weight: 400;
    padding: 0.2rem 1rem 0.2rem 0;
  }
  .days th {
    width: 7.5rem;
    color: var(--muted);
    font-size: var(--s-1);
    white-space: nowrap;
  }
  .bar span {
    display: block;
    height: 0.6rem;
    min-width: 0;
    background: var(--accent);
    border-radius: 0 3px 3px 0;
  }
  .value {
    text-align: right;
    white-space: nowrap;
    padding-left: 1rem;
    font-size: var(--s-1);
    color: var(--muted);
    width: 1%;
  }
  .books td,
  .books th {
    border-bottom: 1px solid var(--line);
    padding-block: 0.5rem;
  }
</style>
