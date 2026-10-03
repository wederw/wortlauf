<script>
  // One page of text around the current word. The word is marked and kept in view while the
  // reading mode runs; a click on any word moves the reading mode there.
  import { tick } from 'svelte';
  import { positionAt } from '../lib/progress.js';

  let { doc, from, to, mark, onjump, width = $bindable(0), height = $bindable(0) } = $props();

  let scroller = $state();
  let shownFrom = -1;
  let heldUntil = 0;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // after the reader scrolls by hand, following pauses for a moment
  const hold = () => (heldUntil = Date.now() + 4000);

  async function follow() {
    await tick();
    if (!scroller) return;
    if (from !== shownFrom) {
      shownFrom = from;
      heldUntil = 0;
      scroller.scrollTop = 0;
    }
    const marked = scroller.querySelector('mark');
    if (!marked || Date.now() < heldUntil) return;
    const box = scroller.getBoundingClientRect();
    const at = marked.getBoundingClientRect();
    if (at.top < box.top + box.height * 0.1 || at.bottom > box.top + box.height * 0.8) {
      scroller.scrollTo({ top: scroller.scrollTop + at.top - box.top - box.height * 0.3, behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  $effect(() => {
    mark;
    from;
    follow();
  });

  function click(event) {
    if (!getSelection().isCollapsed) return;
    const at = positionAt(event);
    if (at) onjump(at);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scroller" bind:this={scroller} bind:clientWidth={width} bind:clientHeight={height} onwheel={hold} ontouchmove={hold} onclick={click}>
  <article>
    {#each { length: to - from } as _, k (from + k)}
      {@const i = from + k}
      {@const para = doc.paras[i]}
      {#if mark && i === mark.para}
        <p data-i={i} class:heading={para.h}>{para.t.slice(0, mark.start)}<mark>{para.t.slice(mark.start, mark.end)}</mark>{para.t.slice(mark.end)}</p>
      {:else}
        <p data-i={i} class:heading={para.h}>{para.t}</p>
      {/if}
    {/each}
  </article>
</div>

<style>
  .scroller {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.75rem max(1rem, env(safe-area-inset-right)) 2rem max(1rem, env(safe-area-inset-left));
  }
  article {
    max-width: var(--measure);
    margin: 0 auto;
    font-family: var(--book);
    font-size: 1.0625rem;
    line-height: 1.6;
    cursor: pointer;
  }
  p {
    margin-bottom: 0.7em;
    hyphens: auto;
  }
  p.heading {
    font-weight: 600;
    font-size: var(--s1);
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
</style>
