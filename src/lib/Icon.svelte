<script>
  let { name, size = 22 } = $props();

  const filled = {
    play: 'M8 5v14l11-7z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  };
  const stroked = {
    back: 'M15 6l-6 6 6 6',
    forward: 'M9 6l6 6-6 6',
    backFar: 'M18 6l-6 6 6 6M11 6l-6 6 6 6',
    forwardFar: 'M6 6l6 6-6 6M13 6l6 6-6 6',
    close: 'M6 6l12 12M18 6L6 18',
    list: 'M4 7h16M4 12h16M4 17h10',
    bookmark: 'M7 4h10v16l-5-4-5 4z',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  {#if filled[name]}
    <path d={filled[name]} fill="currentColor" />
  {:else}
    <path d={stroked[name]} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  {/if}
</svg>
