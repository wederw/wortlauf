// Pinch and Ctrl+wheel zoom for one scrolling element, instead of the browser zooming the
// whole page. The element needs `touch-action: pan-x pan-y` so the browser only scrolls it.
//
// Svelte action: use:pinch={{ preview, commit }}
//   preview(scale, x, y)  while two fingers move; show the change cheaply, e.g. as a transform
//   commit(scale, x, y)   when the gesture ends or for each Ctrl+wheel step
// x and y are the gesture's centre, relative to the element's visible top-left corner.

export function pinch(node, handlers) {
  let current = handlers;
  let start = null;
  let scale = 1;

  const spread = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const centre = (touches) => {
    const box = node.getBoundingClientRect();
    return [(touches[0].clientX + touches[1].clientX) / 2 - box.left, (touches[0].clientY + touches[1].clientY) / 2 - box.top];
  };

  function touchstart(event) {
    if (event.touches.length !== 2) return;
    start = { spread: spread(event.touches) || 1, centre: centre(event.touches) };
    scale = 1;
  }

  function touchmove(event) {
    if (!start || event.touches.length !== 2) return;
    event.preventDefault();
    scale = spread(event.touches) / start.spread;
    current.preview?.(scale, ...start.centre);
  }

  function touchend(event) {
    if (!start || event.touches.length >= 2) return;
    const [x, y] = start.centre;
    start = null;
    current.commit(scale, x, y);
  }

  function wheel(event) {
    if (!event.ctrlKey) return; // a trackpad pinch arrives as Ctrl+wheel
    event.preventDefault();
    const box = node.getBoundingClientRect();
    const step = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY / 150)));
    current.commit(step, event.clientX - box.left, event.clientY - box.top);
  }

  node.addEventListener('touchstart', touchstart, { passive: true });
  node.addEventListener('touchmove', touchmove, { passive: false });
  node.addEventListener('touchend', touchend);
  node.addEventListener('touchcancel', touchend);
  node.addEventListener('wheel', wheel, { passive: false });

  return {
    update(next) {
      current = next;
    },
    destroy() {
      node.removeEventListener('touchstart', touchstart);
      node.removeEventListener('touchmove', touchmove);
      node.removeEventListener('touchend', touchend);
      node.removeEventListener('touchcancel', touchend);
      node.removeEventListener('wheel', wheel);
    },
  };
}

/** Whether the reader asked the system for less motion. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scrolls `scroller` so the point (x, y), given relative to its visible top-left corner,
 * lies in a comfortable band: about a third from the top, inside the left and right edges.
 */
export function keepInView(scroller, x, y) {
  const height = scroller.clientHeight;
  const width = scroller.clientWidth;
  const top = y < height * 0.1 || y > height * 0.75 ? y - height * 0.3 : 0;
  const left = x < width * 0.08 || x > width * 0.92 ? x - width * 0.5 : 0;
  if (!top && !left) return;
  const near = Math.abs(top) < height * 1.5 && Math.abs(left) < width * 1.5;
  scroller.scrollBy({ top, left, behavior: near && !reducedMotion() ? 'smooth' : 'auto' });
}
