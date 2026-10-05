<script>
  // The text as one scrolling column, like an e-book: the whole book, or for very long books a
  // large stretch around the reading position that moves along. The current word is marked
  // and kept in view; pinching, Ctrl+wheel or the zoom buttons change the type size; a click
  // on a word moves the reading position there.
  import { tick, untrack } from 'svelte';
  import { positionAt } from '../lib/progress.js';
  import { keepInView, pinch } from '../lib/zoom.js';

  let { doc, mark, zoom, onzoom, onjump, onpage } = $props();

  const WHOLE = 2500; // books up to this many paragraphs are shown whole
  const BEFORE = 300; // otherwise this many paragraphs before the reading position
  const AFTER = 900; // and this many after it

  let scroller = $state();
  let article = $state();
  let range = $state([0, 0]);
  let heldUntil = 0;
  let pinching = false;

  const chapterOf = (para) => {
    let found = 0;
    for (let i = 0; i < doc.chapters.length; i++) if (doc.chapters[i].start <= para) found = i;
    return found;
  };
  const total = doc.paras.length;
  // only a change of paragraph re-checks every paragraph; within one, only it updates
  const markPara = $derived(mark.para);
  const chapter = $derived(chapterOf(markPara));

  /** The paragraphs to show around paragraph `para`. */
  function rangeFor(para) {
    if (total <= WHOLE) return [0, total];
    return [Math.max(0, para - BEFORE), Math.min(total, para + AFTER)];
  }

  /** Shows more paragraphs before or after the current stretch without moving the reading position. */
  function extend(before, after) {
    range = [Math.max(0, range[0] - before), Math.min(total, range[1] + after)];
  }

  const hold = () => (heldUntil = Date.now() + 4000);

  async function follow(force = false) {
    await tick();
    const marked = article?.querySelector('mark');
    if (!marked || pinching || (!force && Date.now() < heldUntil)) return;
    const box = scroller.getBoundingClientRect();
    const at = marked.getBoundingClientRect();
    keepInView(scroller, at.left - box.left, at.top - box.top);
  }

  $effect(() => {
    const target = mark;
    untrack(() => {
      const outside = target.para < range[0] || target.para >= range[1];
      const nearEdge = (range[0] > 0 && target.para < range[0] + 50) || (range[1] < total && target.para > range[1] - 150);
      if (outside || nearEdge) {
        range = rangeFor(target.para);
        heldUntil = 0;
      }
      follow(outside);
    });
  });

  $effect(() => {
    onpage?.(`Kap. ${chapter + 1} / ${doc.chapters.length}`);
  });

  function preview(scale, x, y) {
    pinching = true;
    article.style.transformOrigin = `${x}px ${scroller.scrollTop + y}px`;
    article.style.transform = `scale(${scale})`;
  }

  /** Changes the type size; the marked word stays in view. */
  export async function zoomBy(scale) {
    pinching = false;
    article.style.transform = '';
    const next = Math.min(2.5, Math.max(0.7, Math.round(zoom * scale * 100) / 100));
    if (next !== zoom) onzoom(next);
    await follow(true);
  }

  function click(event) {
    if (!getSelection().isCollapsed) return;
    const at = positionAt(event);
    if (at) onjump(at);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scroller" bind:this={scroller} use:pinch={{ preview, commit: zoomBy }} onwheel={hold} ontouchmove={hold}>
  {#if range[0] > 0}
    <button class="quiet more" onclick={() => extend(600, 0)}>Davor anzeigen</button>
  {/if}
  <article bind:this={article} onclick={click} style="--zoom: {zoom}">
    {#each { length: range[1] - range[0] } as _, k (range[0] + k)}
      {@const i = range[0] + k}
      {@const para = doc.paras[i]}
      {#if i === markPara}
        <p data-i={i} class:heading={para.h}>{para.t.slice(0, mark.start)}<mark>{para.t.slice(mark.start, mark.end)}</mark>{para.t.slice(mark.end)}</p>
      {:else}
        <p data-i={i} class:heading={para.h}>{para.t}</p>
      {/if}
    {/each}
  </article>
  {#if range[1] < total}
    <button class="quiet more" onclick={() => extend(0, 600)}>Weiter anzeigen</button>
  {/if}
</div>

<style>
  .scroller {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
    padding: 0.75rem max(1rem, env(safe-area-inset-right)) 2rem max(1rem, env(safe-area-inset-left));
  }
  article {
    max-width: calc(var(--measure) * var(--zoom));
    margin: 0 auto;
    font-family: var(--book);
    font-size: calc(1.0625rem * var(--zoom));
    line-height: 1.6;
    cursor: pointer;
    transform-origin: 0 0;
  }
  p {
    margin-bottom: 0.7em;
    hyphens: auto;
  }
  p.heading {
    font-weight: 600;
    font-size: 1.2em;
    line-height: 1.3;
    margin: 1em 0 0.5em;
    hyphens: manual;
  }
  mark {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 2px;
    padding: 0 0.1em;
    margin: 0 -0.1em;
  }
  .more {
    display: block;
    margin: 0.5rem auto;
  }
</style>
