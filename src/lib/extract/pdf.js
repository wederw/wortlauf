// PDF: lines are rebuilt from the positioned text items pdf.js reports, paragraphs from the
// vertical gaps between lines and from short lines that end a sentence.
import { clean, ExtractError, finish } from './common.js';

const PAGE_NUMBER = /^[^\p{L}\p{N}]*(seite|page)?[^\p{L}\p{N}]*\d{1,4}[^\p{L}\p{N}]*$/iu;
const SENTENCE_END = /[.!?:…]["'»«”“’)\]]*$/;
export const STARTS_LOWER = /^\p{Ll}/u;

/**
 * Groups the positioned text items of one page into lines in reading order. Each part is an
 * item; `spaced` marks a visible gap before it, which separates words like a space.
 * The page view uses the same grouping to find the extracted words on the page.
 */
export function groupLines(content) {
  const lines = [];
  let line = null;
  let lastEnd = null;

  const close = () => {
    if (line?.parts.length) lines.push(line);
    line = null;
  };

  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    const [, , c, d, x, y] = item.transform;
    const size = Math.hypot(c, d) || item.height || 10;
    // a different baseline, or a jump back to the left on the same one, starts a new line
    if (line && (Math.abs(y - line.y) > size * 0.5 || (lastEnd !== null && x < lastEnd - size))) close();
    if (!line) {
      line = { parts: [], y, size };
      lastEnd = null;
    }
    if (item.str) {
      line.parts.push({ item, spaced: lastEnd !== null && x - lastEnd > size * 0.15 });
      line.size = Math.max(line.size, size);
    }
    lastEnd = x + (item.width || 0);
    if (item.hasEOL) close();
  }
  close();
  return lines;
}

/** Text lines of one page in reading order, each with its baseline and font size. */
function pageLines(content) {
  return groupLines(content).flatMap((line) => {
    const text = line.parts
      .map(({ item, spaced }) => (spaced ? ` ${item.str}` : item.str))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? [{ text, y: line.y, size: line.size }] : [];
  });
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Turns positioned lines into plain strings; an empty string marks a paragraph gap.
 * Line spacing is measured relative to the font size, so footnotes in a smaller size space
 * alike, and the usual spacing is the most common one: body text outnumbers gaps.
 */
function withGaps(pages) {
  const steps = (lines) => lines.map((line, i) => (i > 0 ? (lines[i - 1].y - line.y) / line.size : 0));
  const counts = new Map();
  for (const lines of pages) {
    for (const step of steps(lines).slice(1)) {
      if (step <= 0) continue;
      const bin = Math.round(step * 20) / 20;
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
  }
  let usual = 1.2;
  let seen = 0;
  for (const [bin, count] of counts) {
    if (count > seen || (count === seen && bin < usual)) [usual, seen] = [bin, count];
  }
  return pages.map((lines) => {
    const ratios = steps(lines);
    const out = [];
    lines.forEach((line, i) => {
      if (i > 0 && ratios[i] > usual * 1.3 + 0.05) out.push('');
      out.push(line.text);
    });
    return out;
  });
}

/** Drops headers and footers that repeat on most pages, and bare page numbers. */
function stripRunningLines(pages) {
  const key = (line) => line.trim().toLowerCase().replace(/\d+/g, '#');
  for (const position of [0, -1]) {
    const repeated = new Set();
    if (pages.length >= 4) {
      const counts = new Map();
      for (const lines of pages) {
        if (lines.length) counts.set(key(lines.at(position)), (counts.get(key(lines.at(position))) ?? 0) + 1);
      }
      for (const [text, count] of counts) if (text && count > pages.length * 0.5) repeated.add(text);
    }
    for (const lines of pages) {
      if (lines.length && (repeated.has(key(lines.at(position))) || PAGE_NUMBER.test(lines.at(position)))) {
        lines.splice(position, 1);
      }
    }
  }
}

async function destinationPage(pdf, dest) {
  if (typeof dest === 'string') dest = await pdf.getDestination(dest);
  if (!Array.isArray(dest) || dest[0] == null) return null;
  return (typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])) + 1;
}

/**
 * @param {Uint8Array} data  handed to pdf.js, which takes ownership of the buffer
 * @param {object} pdfjs     the pdf.js module
 * @param {(fraction: number) => void} [onprogress]
 */
export async function extractPdf(data, fallbackTitle, pdfjs, onprogress) {
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  } catch (error) {
    if (error?.name === 'PasswordException') throw new ExtractError('Das PDF ist passwortgeschützt.');
    throw new ExtractError('Das PDF ließ sich nicht lesen.');
  }

  try {
    const positioned = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      try {
        positioned.push(pageLines(await (await pdf.getPage(number)).getTextContent()));
      } catch {
        positioned.push([]); // a single broken page should not sink the whole book
      }
      onprogress?.(number / pdf.numPages);
    }

    const pages = withGaps(positioned);
    const trim = (lines) => {
      while (lines.length && !lines[0]) lines.shift();
      while (lines.length && !lines.at(-1)) lines.pop();
    };
    pages.forEach(trim);
    stripRunningLines(pages);
    // the gap below a removed header must not end a paragraph that runs on from the last page
    pages.forEach(trim);

    const lengths = pages.flatMap((lines) => lines.filter(Boolean).map((line) => line.length));
    if (lengths.length === 0) {
      throw new ExtractError('Das PDF enthält keinen Text, vermutlich ein Scan. Vorher mit OCR behandeln, zum Beispiel mit ocrmypdf.');
    }
    const typical = median(lengths);

    const paras = [];
    let current = '';
    let currentPage = 1;
    let openAcrossPage = false;

    const close = () => {
      const text = clean(current);
      if (text) paras.push({ t: text, pg: currentPage });
      current = '';
    };

    pages.forEach((lines, index) => {
      const number = index + 1;
      lines.forEach((line, position) => {
        if (!line) return close();
        if (position === 0 && current && !(openAcrossPage && STARTS_LOWER.test(line))) close();
        if (!current) {
          currentPage = number;
          current = line;
        } else if (/[-‐]$/.test(current) && STARTS_LOWER.test(line)) {
          current = current.slice(0, -1) + line;
        } else {
          current += ' ' + line;
        }
        if (SENTENCE_END.test(line) && line.length < typical * 0.8) close();
      });
      openAcrossPage = Boolean(current) && !SENTENCE_END.test(current);
    });
    close();

    let chapters = [];
    const walk = async (items) => {
      for (const item of items ?? []) {
        let pageNumber = null;
        try {
          pageNumber = await destinationPage(pdf, item.dest);
        } catch {
          /* broken outline entry */
        }
        const title = clean(String(item.title ?? ''));
        let start = pageNumber === null ? -1 : paras.findIndex((p) => p.pg >= pageNumber);
        if (start >= 0 && title) {
          // prefer the paragraph that repeats the outline title: it is the heading itself
          for (let i = start; i < paras.length && paras[i].pg === paras[start].pg; i++) {
            if (paras[i].t.toLowerCase() === title.toLowerCase()) {
              start = i;
              paras[i].h = 1;
              break;
            }
          }
          chapters.push({ title, start });
        }
        await walk(item.items);
      }
    };
    try {
      await walk(await pdf.getOutline());
    } catch {
      chapters = [];
    }

    if (chapters.length === 0) {
      const step = 10;
      for (let first = 1; first <= pages.length; first += step) {
        const start = paras.findIndex((p) => p.pg >= first);
        if (start >= 0) chapters.push({ title: `Seite ${first}–${Math.min(first + step - 1, pages.length)}`, start });
      }
    }

    const info = (await pdf.getMetadata().catch(() => null))?.info ?? {};
    const title = (typeof info.Title === 'string' && info.Title.trim()) || fallbackTitle;
    const author = typeof info.Author === 'string' ? info.Author.trim() : '';
    return finish(title, author, paras, chapters);
  } finally {
    pdf.destroy();
  }
}
