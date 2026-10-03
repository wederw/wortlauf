// Where the reader is in a book, as a paragraph and a character offset, plus the helpers that
// map clicks and positions onto words.

/** Start and end of the word around `offset`. */
export function wordAt(text, offset) {
  let start = Math.min(offset, text.length);
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = start;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return [start, end];
}

/**
 * The paragraph and character offset under a click inside an element whose paragraphs carry
 * `data-i`, or null when the click was not on text.
 */
export function positionAt(event) {
  const element = event.target.closest('[data-i]');
  if (!element) return null;
  let node, offset;
  if (document.caretPositionFromPoint) {
    const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
    node = caret?.offsetNode;
    offset = caret?.offset;
  } else if (document.caretRangeFromPoint) {
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    node = caret?.startContainer;
    offset = caret?.startOffset;
  }
  let chars = 0;
  if (node && element.contains(node)) {
    const range = document.createRange();
    range.setStart(element, 0);
    range.setEnd(node, offset);
    chars = range.toString().length;
  }
  return { para: Number(element.dataset.i), offset: chars };
}

/**
 * Splits a document into pages: for PDFs the original pages, otherwise runs of paragraphs of
 * about `size` characters. A chapter always starts a new page. A paragraph that does not fit
 * still joins a page that is less than half full, which then scrolls a little.
 * @returns {number[]} index of the first paragraph of every page
 */
export function paginate(doc, size = 2200) {
  const chapterStarts = new Set(doc.chapters.map((c) => c.start));
  const printed = doc.paras.some((p) => p.pg);
  const starts = [];
  let filled = 0;
  doc.paras.forEach((para, i) => {
    const full = filled > 0 && filled + para.t.length > size && (filled >= size / 2 || filled + para.t.length > size * 1.5);
    const fresh = printed ? para.pg !== doc.paras[i - 1]?.pg : chapterStarts.has(i) || full;
    if (i === 0 || fresh) {
      starts.push(i);
      filled = 0;
    }
    filled += para.t.length;
  });
  return starts;
}

/** Index of the page that holds paragraph `para`. */
export function pageOf(starts, para) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= para) low = mid;
    else high = mid - 1;
  }
  return low;
}
