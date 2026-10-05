<script>
  // The original PDF as a column of pages below the word. Pages are drawn when they come near
  // the visible area and released when they are far away again. The current word is marked
  // and kept in view; pinching, Ctrl+wheel or the zoom buttons scale the pages; a click on a
  // word moves the reading position there.
  import { onMount, tick, untrack } from 'svelte';
  import { getOriginal } from '../lib/library.js';
  import { openPdf } from '../lib/pdfjs.js';
  import { PdfMap, wordNear } from '../lib/pdfmap.js';
  import { keepInView, pinch } from '../lib/zoom.js';

  let { bookId, doc, mark, zoom, onzoom, onjump, onpage } = $props();

  const PAD = 12;
  const PIXEL_BUDGET = 5_000_000; // per canvas, so deep zoom does not exhaust memory

  let scroller = $state();
  let column = $state();
  let paneWidth = $state(0);
  let count = $state(0);
  let ratio = $state(1.414);
  let marked = $state.raw(null); // { page, rects }
  let error = $state('');

  let pdf = null;
  let map = null;
  let observer = null;
  const near = new Set(); // pages close to the visible area
  const drawn = new Map(); // page -> width it was drawn at
  let queue = Promise.resolve();
  let redrawTimer = 0;
  let followRun = 0;
  let heldUntil = 0;
  let pinching = false;
  let trackFrame = 0;

  const FIT = 860; // widest page at 100 %, so large screens show a readable page, not a poster
  const pageWidth = $derived(Math.max(120, Math.round(Math.min(paneWidth - 2 * PAD, FIT) * zoom)));
  const holderOf = (number) => column?.querySelector(`[data-page="${number}"]`);

  // ---- drawing

  function draw(number) {
    queue = queue.then(() => drawNow(number)).catch((failure) => console.warn('PDF page', number, failure));
  }

  async function drawNow(number) {
    const width = pageWidth;
    const holder = holderOf(number);
    if (!pdf || !holder || !near.has(number) || drawn.get(number) === width) return;
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min((width / base.width) * Math.min(window.devicePixelRatio || 1, 2), Math.sqrt(PIXEL_BUDGET / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (!near.has(number)) return;
    holder.style.aspectRatio = `${base.width} / ${base.height}`;
    holder.querySelector('.paper').replaceChildren(canvas);
    drawn.set(number, width);
  }

  function release(number) {
    near.delete(number);
    drawn.delete(number);
    holderOf(number)?.querySelector('.paper')?.replaceChildren();
  }

  // a new width redraws the nearby pages once the zooming has settled
  $effect(() => {
    pageWidth;
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => near.forEach(draw), 200);
  });

  // ---- following the reading position

  const hold = () => (heldUntil = Date.now() + 4000);

  async function follow(target, force = false) {
    const run = ++followRun;
    const found = map && target ? await map.locate(target, marked?.page) : null;
    if (run !== followRun) return;
    marked = found;
    if (pinching || (!force && Date.now() < heldUntil)) return;
    await tick();
    const holder = holderOf(found?.page ?? doc.paras[target.para]?.pg ?? 1);
    if (!holder || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const sheet = holder.getBoundingClientRect();
    const [x0, y0, x1] = found ? found.rects[0] : [0.5, 0, 0.5];
    keepInView(scroller, sheet.left - box.left + ((x0 + x1) / 2) * sheet.width, sheet.top - box.top + y0 * sheet.height);
  }

  $effect(() => {
    const target = mark;
    if (count) untrack(() => follow(target));
  });

  /** Reports the page a third of the way down the visible area. */
  function track() {
    cancelAnimationFrame(trackFrame);
    trackFrame = requestAnimationFrame(() => {
      if (!column || !count) return;
      const line = scroller.scrollTop + scroller.clientHeight / 3;
      const holders = column.children;
      let low = 0;
      let high = holders.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (holders[mid].offsetTop <= line) low = mid;
        else high = mid - 1;
      }
      onpage?.(`S. ${low + 1} / ${count}`);
    });
  }

  // ---- zoom

  function preview(scale, x, y) {
    pinching = true;
    column.style.transformOrigin = `${scroller.scrollLeft + x - column.offsetLeft}px ${scroller.scrollTop + y - column.offsetTop}px`;
    column.style.transform = `scale(${scale})`;
  }

  /** Applies a zoom change around the point (x, y) of the visible area. */
  export async function zoomBy(scale, x = scroller.clientWidth / 2, y = scroller.clientHeight / 3) {
    pinching = false;
    column.style.transform = '';
    const before = zoom;
    const next = Math.min(4, Math.max(0.5, Math.round(before * scale * 100) / 100));
    if (next === before) return;
    const left = scroller.scrollLeft + x;
    const top = scroller.scrollTop + y;
    onzoom(next);
    await tick();
    scroller.scrollLeft = (left * next) / before - x;
    scroller.scrollTop = (top * next) / before - y;
    hold();
  }

  // ---- input

  async function click(event) {
    const holder = event.target.closest('[data-page]');
    if (!holder || !map) return;
    const box = holder.getBoundingClientRect();
    const at = wordNear(await map.page(Number(holder.dataset.page)), (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
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
        pdf = opened;
        map = new PdfMap(pdf, doc);
        const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
        ratio = first.height / first.width;
        count = pdf.numPages;
        await tick();
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const number = Number(entry.target.dataset.page);
              if (entry.isIntersecting) {
                near.add(number);
                draw(number);
              } else release(number);
            }
          },
          { root: scroller, rootMargin: '120% 60%' },
        );
        for (const holder of column.children) observer.observe(holder);
        await follow(mark, true);
        track();
      } catch {
        error = 'Das PDF ließ sich nicht anzeigen. Die Textansicht funktioniert weiterhin.';
      }
    })();
    return () => {
      alive = false;
      observer?.disconnect();
      clearTimeout(redrawTimer);
      pdf?.destroy();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="scroller"
  bind:this={scroller}
  bind:clientWidth={paneWidth}
  use:pinch={{ preview, commit: zoomBy }}
  onscroll={track}
  onwheel={hold}
  ontouchmove={hold}
  onclick={click}
  style="--pad: {PAD}px"
>
  {#if error}
    <p class="error">{error}</p>
  {:else if !count}
    <p class="muted">PDF wird geladen …</p>
  {/if}
  <div class="column" bind:this={column} style="width: {pageWidth}px">
    {#each { length: count } as _, index}
      <div class="sheet" data-page={index + 1} style="aspect-ratio: 1 / {ratio}" aria-label="Seite {index + 1}">
        <div class="paper"></div>
        {#if marked?.page === index + 1}
          {#each marked.rects as [x0, y0, x1, y1]}
            <i class="hit" style="left: {x0 * 100}%; top: {y0 * 100}%; width: {(x1 - x0) * 100}%; height: {(y1 - y0) * 100}%"></i>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .scroller {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
    padding: var(--pad);
  }
  .column {
    display: grid;
    gap: 10px;
    margin: 0 auto;
  }
  .sheet {
    position: relative;
    width: 100%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    cursor: pointer;
  }
  .paper,
  .paper :global(canvas) {
    display: block;
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
