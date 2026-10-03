// Finds where the words of the extracted text sit on the original PDF pages. With that, the
// reader can mark the current word on the page image, turn to the page the word is really on
// (a paragraph can run on over a page break) and map a click on the page back to the text.
//
// The page's words are rebuilt from pdf.js text items with the same line rules as the
// extraction, then aligned with the extracted words by their longest common subsequence.
// Running headers and page numbers simply stay unmatched.
import { groupLines, STARTS_LOWER } from './extract/pdf.js';

const key = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Character positions inside an item are estimated from a generic font's proportions.
const measure = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
function share(str, k) {
  if (k <= 0) return 0;
  if (k >= str.length) return 1;
  if (!measure) return k / str.length;
  measure.font = '100px sans-serif';
  const total = measure.measureText(str).width;
  return total ? measure.measureText(str.slice(0, k)).width / total : k / str.length;
}

/** Box of characters `from`..`to` of an item, in PDF space: [x0, y0, x1, y1]. */
function box({ item, from, to }) {
  const [, , c, d, x, y] = item.transform;
  const size = Math.hypot(c, d) || item.height || 10;
  const width = item.width || 0;
  return [x + width * share(item.str, from), y - size * 0.22, x + width * share(item.str, to), y + size * 0.82];
}

/** The words of one page in reading order, each with the boxes of its pieces. */
export function pageWords(content) {
  const words = [];
  groupLines(content).forEach((line, index) => {
    let word = null;
    const end = () => {
      if (word) words.push(word);
      word = null;
    };
    for (const { item, spaced } of line.parts) {
      if (spaced) end();
      for (let k = 0; k < item.str.length; k++) {
        if (/\s/.test(item.str[k])) {
          end();
          continue;
        }
        word ??= { text: '', line: index, spans: [] };
        const span = word.spans.at(-1);
        if (span?.item === item && span.to === k) span.to = k + 1;
        else word.spans.push({ item, from: k, to: k + 1 });
        word.text += item.str[k];
      }
    }
    end();
  });
  // a word hyphenated at the end of a line continues at the start of the next one
  for (let i = words.length - 2; i >= 0; i--) {
    const [a, b] = [words[i], words[i + 1]];
    if (b.line === a.line + 1 && /[-‐]$/.test(a.text) && STARTS_LOWER.test(b.text)) {
      a.text = a.text.slice(0, -1) + b.text;
      a.spans.push(...b.spans);
      words.splice(i + 1, 1);
    }
  }
  return words.map((w) => ({ text: w.text, key: key(w.text), boxes: w.spans.map(box) }));
}

/** Index pairs [i, j] of a longest common subsequence of two key lists. */
export function align(a, b) {
  const n = a.length;
  const m = b.length;
  const pairs = [];
  if (n === 0 || m === 0) return pairs;
  if (n * m > 6_000_000) {
    // very dense pages: match in order, looking a little ahead
    let j = 0;
    for (let i = 0; i < n && j < m; i++) {
      const found = b.indexOf(a[i], j);
      if (found >= 0 && found - j < 60) {
        pairs.push([i, found]);
        j = found + 1;
      }
    }
    return pairs;
  }
  const w = m + 1;
  const table = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

export class PdfMap {
  /** @param pdf a pdf.js document, @param doc the extracted document */
  constructor(pdf, doc) {
    this.pdf = pdf;
    this.doc = doc;
    this.pages = new Map();
  }

  /** Where the extracted words of page `number` are, as fractions of the page size. */
  page(number) {
    if (!this.pages.has(number)) {
      this.pages.set(number, this.#build(number).catch(() => ({ number, words: [] })));
    }
    return this.pages.get(number);
  }

  async #build(number) {
    const page = await this.pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const found = pageWords(await page.getTextContent()).filter((word) => word.key);

    // the paragraphs that can have words here: those starting on this page and the one before
    const paras = this.doc.paras;
    let first = paras.findIndex((p) => (p.pg ?? 0) >= number);
    if (first < 0) first = paras.length;
    let last = first;
    while (last < paras.length && paras[last].pg === number) last++;
    const expected = [];
    for (let p = Math.max(0, first - 1); p < last; p++) {
      for (const match of paras[p].t.matchAll(/\S+/g)) {
        const k = key(match[0]);
        if (k) expected.push({ para: p, start: match.index, end: match.index + match[0].length, key: k });
      }
    }

    const words = align(
      found.map((word) => word.key),
      expected.map((word) => word.key),
    ).map(([i, j]) => ({
      ...expected[j],
      rects: found[i].boxes.map((corners) => {
        const [x0, y0, x1, y1] = viewport.convertToViewportRectangle(corners);
        return [Math.min(x0, x1) / viewport.width, Math.min(y0, y1) / viewport.height, Math.max(x0, x1) / viewport.width, Math.max(y0, y1) / viewport.height];
      }),
    }));
    return { number, words };
  }

  /**
   * Finds the page and the boxes of `mark` ({ para, start, end }), trying `preferred` first.
   * @returns {Promise<{ page: number, rects: number[][] } | null>}
   */
  async locate(mark, preferred) {
    const para = this.doc.paras[mark.para];
    if (!para) return null;
    const from = para.pg ?? 1;
    const to = Math.min(this.pdf.numPages, Math.max(from, this.doc.paras[mark.para + 1]?.pg ?? from + 2), from + 6);
    const pages = [];
    for (let n = from; n <= to; n++) pages.push(n);
    if (pages.includes(preferred)) pages.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
    for (const number of pages) {
      const rects = marksOn(await this.page(number), mark);
      if (rects.length) return { page: number, rects };
    }
    return null;
  }
}

/** Boxes of all words of a page map that overlap `mark`. */
export function marksOn(map, mark) {
  return map.words.filter((w) => w.para === mark.para && w.start < mark.end && w.end > mark.start).flatMap((w) => w.rects);
}

/** The text position of the word nearest to a point given as fractions of the page size. */
export function wordNear(map, x, y) {
  let best = null;
  let distance = Infinity;
  for (const word of map.words) {
    for (const [x0, y0, x1, y1] of word.rects) {
      const dx = Math.max(x0 - x, 0, x - x1);
      const dy = Math.max(y0 - y, 0, y - y1) * 1.5;
      const d = dx * dx + dy * dy;
      if (d < distance) {
        distance = d;
        best = word;
      }
    }
  }
  return best && distance < 0.003 ? { para: best.para, offset: best.start } : null;
}
