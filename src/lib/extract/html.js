// HTML and XHTML: block-level text becomes paragraphs. The browser's parser does the
// parsing; nothing in a parsed document is ever executed or attached to the page.
import { clean, decode, finish } from './common.js';

const BLOCK = new Set([
  'p', 'div', 'li', 'blockquote', 'section', 'article', 'pre', 'dd', 'dt', 'tr',
  'figcaption', 'table', 'ul', 'ol', 'header', 'footer', 'aside', 'main', 'hr', 'body',
]);
const SKIP = new Set(['script', 'style', 'head', 'svg', 'math', 'template', 'noscript', 'title']);
const HEADING = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

export const parseHtml = (markup) => new DOMParser().parseFromString(markup, 'text/html');

/** Paragraphs of a document, each remembering the element ids before it for TOC anchors. */
export function htmlBlocks(markup) {
  const doc = parseHtml(markup);
  const out = [];
  let buffer = [];
  let level = 0;
  let ids = [];

  function flush() {
    const text = clean(buffer.join(''));
    buffer = [];
    if (!text) return;
    const para = { t: text, ids };
    if (level) para.h = level;
    out.push(para);
    ids = [];
  }

  function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        buffer.push(child.data);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.localName;
      if (SKIP.has(tag)) continue;
      if (HEADING[tag]) {
        flush();
        level = HEADING[tag];
      } else if (BLOCK.has(tag)) flush();
      else if (tag === 'br') buffer.push(' ');
      // ids are recorded after the flush so they attach to the text that follows them
      if (child.id) ids.push(child.id);
      walk(child);
      if (HEADING[tag]) {
        flush();
        level = 0;
      } else if (tag === 'td' || tag === 'th') buffer.push(' ');
      else if (BLOCK.has(tag)) flush();
    }
  }

  walk(doc.body ?? doc.documentElement);
  flush();
  return { out, title: doc.title ?? '' };
}

export function extractHtml(data, fallbackTitle) {
  const parsed = htmlBlocks(decode(data));
  return finish(clean(parsed.title) || fallbackTitle, '', parsed.out, []);
}
