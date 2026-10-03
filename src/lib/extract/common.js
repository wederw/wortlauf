// Shared helpers for turning a file into a neutral document.
//
// Output shape (stored per book, consumed by the views and the script engine):
//   { title, author, words, chapters: [{ title, start }], paras: [{ t, h?, pg? }] }
// `start` is the index of the chapter's first paragraph, `h` a heading level, `pg` a 1-based page.

export class ExtractError extends Error {}

export const clean = (text) => text.replaceAll('­', '').replace(/\s+/g, ' ').trim();

export const countWords = (text) => text.match(/\S+/g)?.length ?? 0;

export function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('XML');
  return doc;
}

/** Elements with this local name below `node`, in document order, whatever their namespace. */
export const byTag = (node, name) => (node ? [...node.getElementsByTagNameNS('*', name)] : []);
export const childByTag = (node, name) => (node ? [...node.children].find((child) => child.localName === name) : undefined);
export const textOf = (node) => node?.textContent ?? '';

export function finish(title, author, paras, chapters) {
  if (paras.length === 0) throw new ExtractError('In der Datei wurde kein Text gefunden.');
  for (const para of paras) delete para.ids;

  if (chapters.length === 0) {
    chapters = paras.flatMap((p, i) => (p.h === 1 || p.h === 2 ? [{ title: p.t.slice(0, 120), start: i }] : []));
  }
  chapters = chapters.filter((c) => c.start >= 0 && c.start < paras.length).sort((a, b) => a.start - b.start);

  const unique = [];
  for (const chapter of chapters) {
    if (unique.length && unique.at(-1).start === chapter.start) continue;
    unique.push({ title: clean(chapter.title).slice(0, 120) || 'Ohne Titel', start: chapter.start });
  }
  if (unique.length === 0) unique.push({ title: title || 'Text', start: 0 });
  else if (unique[0].start > 0) unique.unshift({ title: 'Anfang', start: 0 });

  return {
    title: clean(title).slice(0, 300),
    author: clean(author).slice(0, 300),
    words: paras.reduce((sum, p) => sum + countWords(p.t), 0),
    chapters: unique,
    paras,
  };
}
