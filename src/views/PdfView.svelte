<script>
  // Shows the original PDF, one canvas per page, rendered only when a page scrolls into view.
  // The reading marker is drawn on the page its word is printed on; a click on a word picks it.
  import { onMount, untrack } from 'svelte';
  import { getOriginal } from '../lib/library.js';
  import { openPdf } from '../lib/pdfjs.js';
  import { PdfMap, wordNear } from '../lib/pdfmap.js';

  let { bookId, doc, mark, onpick, onpage } = $props();

  let host;
  let count = $state(0);
  let ratio = $state(1.414);
  let error = $state('');
  let marked = $state.raw(null); // { page, rects }
  let pdf = null;
  let map = null;
  let markRun = 0;
  const rendered = new Set();

  async function render(number, holder) {
    if (rendered.has(number) || !pdf) return;
    rendered.add(number);
    try {
      const pdfPage = await pdf.getPage(number);
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = (holder.clientWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      holder.style.aspectRatio = `${base.width} / ${base.height}`;
      await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      holder.querySelector('.paper').replaceChildren(canvas);
    } catch (failure) {
      console.warn('PDF page', number, failure);
      rendered.delete(number);
    }
  }

  async function placeMark(target) {
    const run = ++markRun;
    const found = map && target ? await map.locate(target) : null;
    if (run === markRun) marked = found;
    return found;
  }

  $effect(() => {
    const target = mark;
    if (count) untrack(() => placeMark(target));
  });

  /** Scrolls the marked word into the upper part of the window. */
  export async function reveal() {
    const found = await placeMark(mark);
    const holder = host?.querySelector(`[data-page="${found?.page ?? doc.paras[mark.para]?.pg ?? 1}"]`);
    if (!holder) return;
    const box = holder.getBoundingClientRect();
    const y = found ? box.top + found.rects[0][1] * box.height - window.innerHeight / 3 : box.top - 70;
    window.scrollBy({ top: y });
  }

  export function showPage(number, block = 'start') {
    host?.querySelector(`[data-page="${number}"]`)?.scrollIntoView({ block });
  }

  async function click(event) {
    const holder = event.target.closest('[data-page]');
    if (!holder || !map) return;
    const box = holder.getBoundingClientRect();
    const at = wordNear(await map.page(Number(holder.dataset.page)), (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    if (at) onpick(at, event.detail >= 2);
  }

  function track() {
    if (!host) return;
    let best = 1;
    for (const holder of host.children) {
      if (holder.getBoundingClientRect().top <= window.innerHeight / 3) best = Number(holder.dataset.page);
      else break;
    }
    onpage?.(best);
  }

  onMount(() => {
    let observer;
    let alive = true;
    (async () => {
      try {
        const blob = await getOriginal(bookId);
        if (!blob) throw new Error('missing');
        pdf = await openPdf(blob);
        if (!alive) return pdf.destroy();
        map = new PdfMap(pdf, doc);
        const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
        ratio = first.height / first.width;
        count = pdf.numPages;
        await Promise.resolve();
        requestAnimationFrame(() => {
          observer = new IntersectionObserver(
            (entries) => entries.forEach((entry) => entry.isIntersecting && render(Number(entry.target.dataset.page), entry.target)),
            { rootMargin: '150% 0px' },
          );
          for (const holder of host.children) observer.observe(holder);
          reveal();
        });
      } catch {
        error = 'Das PDF ließ sich nicht anzeigen. Die Textansicht funktioniert weiterhin.';
      }
    })();
    window.addEventListener('scroll', track, { passive: true });
    return () => {
      alive = false;
      observer?.disconnect();
      window.removeEventListener('scroll', track);
      pdf?.destroy();
    };
  });
</script>

{#if error}
  <p class="error">{error}</p>
{:else if count === 0}
  <p class="muted">PDF wird geladen …</p>
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="pages" bind:this={host} onclick={click}>
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

<style>
  .pages {
    display: grid;
    gap: 1rem;
  }
  .sheet {
    position: relative;
    background: #fff;
    border: 1px solid var(--line);
    width: 100%;
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
