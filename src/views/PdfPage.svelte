<script>
  // One page of the original PDF, scaled so the whole page fits the available space.
  import { onMount } from 'svelte';
  import { getOriginal } from '../lib/library.js';
  import { openPdf } from '../lib/pdfjs.js';

  let { bookId, page } = $props();

  let pdf = $state.raw(null);
  let holder = $state();
  let width = $state(0);
  let height = $state(0);
  let error = $state('');
  let run = 0;
  let task = null;

  async function render(number, availableWidth, availableHeight) {
    const mine = ++run;
    task?.cancel();
    try {
      const pdfPage = await pdf.getPage(Math.min(Math.max(1, number), pdf.numPages));
      if (mine !== run) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.max(160, Math.min(availableWidth, (availableHeight * base.width) / base.height));
      const viewport = pdfPage.getViewport({ scale: (fit / base.width) * Math.min(window.devicePixelRatio || 1, 2) });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      task = pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
      await task.promise;
      if (mine !== run) return;
      holder.style.aspectRatio = `${base.width} / ${base.height}`;
      holder.style.width = `${fit}px`;
      holder.replaceChildren(canvas);
    } catch (failure) {
      if (failure?.name !== 'RenderingCancelledException') console.warn('PDF page', number, failure);
    }
  }

  $effect(() => {
    if (pdf && holder && width > 0 && height > 0) render(page, width, height);
  });

  onMount(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await getOriginal(bookId);
        if (!blob) throw new Error('missing');
        const opened = await openPdf(blob);
        if (alive) pdf = opened;
        else opened.destroy();
      } catch {
        error = 'Das Original ließ sich nicht anzeigen. Die Textansicht funktioniert weiterhin.';
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
      pdf?.destroy();
    };
  });
</script>

<div class="scroller">
  {#if error}
    <p class="error">{error}</p>
  {:else if !pdf}
    <p class="muted">PDF wird geladen …</p>
  {/if}
  <div class="fit" bind:clientWidth={width} bind:clientHeight={height}>
    <div class="sheet" bind:this={holder} aria-label="Seite {page}"></div>
  </div>
</div>

<style>
  .scroller {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    padding: 0.5rem max(1rem, env(safe-area-inset-right)) 0.75rem max(1rem, env(safe-area-inset-left));
  }
  .fit {
    grid-row: 2;
    min-height: 0;
    display: grid;
    justify-items: center;
    align-items: start;
  }
  .sheet {
    background: #fff;
    border: 1px solid var(--line);
    aspect-ratio: 1 / 1.414;
    max-width: 100%;
  }
  .sheet :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
