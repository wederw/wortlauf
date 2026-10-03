<script>
  // Shows the original PDF, one canvas per page, rendered only when a page scrolls into view.
  import { onMount } from 'svelte';
  import { getOriginal } from '../lib/library.js';
  import { openPdf } from '../lib/pdfjs.js';

  let { bookId, page = 1, onpage } = $props();

  let host;
  let count = $state(0);
  let ratio = $state(1.414);
  let error = $state('');
  let pdf = null;
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
      holder.replaceChildren(canvas);
    } catch (failure) {
      console.warn('PDF page', number, failure);
      rendered.delete(number);
    }
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
          host.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' });
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

<div class="pages" bind:this={host}>
  {#each { length: count } as _, index}
    <div class="sheet" data-page={index + 1} style="aspect-ratio: 1 / {ratio}" aria-label="Seite {index + 1}"></div>
  {/each}
</div>

<style>
  .pages {
    display: grid;
    gap: 1rem;
  }
  .sheet {
    background: #fff;
    border: 1px solid var(--line);
    width: 100%;
  }
  .sheet :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
