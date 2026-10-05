// Positions in a book are a paragraph and a character offset.

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
