<script>
  // One page of the original PDF, scaled so the whole page fits the available space. It turns
  // to the page the current word is printed on and marks the word there; a click on a word
  // moves the reading mode to it.
  import { onMount, untrack } from 'svelte';
  import { getOriginal } from '../lib/library.js';
  import { openPdf } from '../lib/pdfjs.js';
  import { PdfMap, wordNear } from '../lib/pdfmap.js';

  let { bookId, doc, mark, onjump, onpage } = $props();

  let pdf = $state.raw(null);
  let map = null;
  let paper = $state();
  let sheet = $state();
  let width = $state(0);
  let height = $state(0);
  let shown = $state(doc.paras[mark.para]?.pg ?? 1);
  let rendered = $state(0); // the page currently on the canvas
  let rects = $state.raw([]);
  let error = $state('');
  let renderRun = 0;
  let followRun = 0;
  let task = null;

  async function render(number, availableWidth, availableHeight) {
    const mine = ++renderRun;
    task?.cancel();
    try {
      const pdfPage = await pdf.getPage(Math.min(Math.max(1, number), pdf.numPages));
      if (mine !== renderRun) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.max(160, Math.min(availableWidth, (availableHeight * base.width) / base.height));
      const viewport = pdfPage.getViewport({ scale: (fit / base.width) * Math.min(window.devicePixelRatio || 1, 2) });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      task = pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
      await task.promise;
      if (mine !== renderRun) return;
      sheet.style.aspectRatio = `${base.width} / ${base.height}`;
      sheet.style.width = `${fit}px`;
      paper.replaceChildren(canvas);
      rendered = number;
    } catch (failure) {
      if (failure?.name !== 'RenderingCancelledException') console.warn('PDF page', number, failure);
    }
  }

  async function follow(target) {
    const run = ++followRun;
    const found = await map.locate(target, shown);
    if (run !== followRun) return;
    if (found) {
      shown = found.page;
      rects = found.rects;
      if (found.page < pdf.numPages) map.page(found.page + 1); // the next page is usually needed soon
    } else {
      shown = doc.paras[target.para]?.pg ?? shown;
      rects = [];
    }
    onpage?.(shown, pdf.numPages);
  }

  $effect(() => {
    if (pdf && paper && width > 0 && height > 0) render(shown, width, height);
  });

  $effect(() => {
    const target = mark;
    if (pdf && target) untrack(() => follow(target));
  });

  async function click(event) {
    if (!map) return;
    const box = sheet.getBoundingClientRect();
    const at = wordNear(await map.page(rendered || shown), (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    if (at) onjump(at);
  }

  onMount(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await getOriginal(bookId);
        if (!blob) throw new Error('missing');
        const opened = await openPdf(blob);
        if (!alive) return opened.destroy();
        map = new PdfMap(opened, doc);
        pdf = opened;
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
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="sheet" bind:this={sheet} onclick={click} aria-label="Seite {shown}">
      <div class="paper" bind:this={paper}></div>
      {#if rendered === shown}
        {#each rects as [x0, y0, x1, y1]}
          <i class="hit" style="left: {x0 * 100}%; top: {y0 * 100}%; width: {(x1 - x0) * 100}%; height: {(y1 - y0) * 100}%"></i>
        {/each}
      {/if}
    </div>
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
    position: relative;
    background: #fff;
    border: 1px solid var(--line);
    aspect-ratio: 1 / 1.414;
    max-width: 100%;
    cursor: pointer;
  }
  .paper :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .paper {
    width: 100%;
    height: 100%;
  }
  /* multiplied onto the page, so the printed word stays readable under the mark */
  .hit {
    position: absolute;
    margin: -2px 0 0 -2px;
    padding: 2px;
    box-sizing: content-box;
    background: var(--accent);
    opacity: 0.65;
    mix-blend-mode: multiply;
    border-radius: 2px;
    pointer-events: none;
  }
</style>
