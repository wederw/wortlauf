// Books, reading positions, bookmarks and reading sessions, all kept in the browser.
import { extract, ExtractError } from './extract/index.js';
import { loadPdfjs } from './pdfjs.js';
import * as store from './store.js';

export const MAX_FILE_MB = 300;

const MEDIA = { pdf: 'application/pdf' };

/** First 16 hex digits of the file's SHA-256: the same file gets the same id on every device. */
async function fingerprint(data) {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return [...digest.subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // crypto.subtle exists only on HTTPS and localhost; elsewhere ids are random
  return [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads a file, extracts its text and stores it.
 * @returns {Promise<{ book: object, existed: boolean }>}
 */
export async function addBook(file, onprogress) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new ExtractError(`Die Datei ist größer als ${MAX_FILE_MB} MB.`);
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length === 0) throw new ExtractError('Die Datei ist leer.');
  const id = await fingerprint(data);
  const existing = await store.get('books', id);
  if (existing) return { book: existing, existed: true };

  const { format, doc } = await extract(file.name, data, { pdfjs: loadPdfjs, onprogress });
  const { title, author, words, ...content } = doc;
  const book = { id, title: title || file.name, author, format, filename: file.name, words, size: file.size, created: Date.now() / 1000 };
  await store.transaction(['books', 'docs', 'files'], (s) => {
    s.books.put(book);
    s.docs.put(content, id);
    // only PDFs have an original page view; other formats are fully described by their text
    if (format === 'pdf') s.files.put(new Blob([data], { type: MEDIA.pdf }), id);
  });
  store.persist();
  return { book, existed: false };
}

/** All books, most recently read or added first, with their reading progress. */
export async function listBooks() {
  const [books, keys, positions] = await Promise.all([store.getAll('books'), store.getAllKeys('progress'), store.getAll('progress')]);
  const progress = new Map(keys.map((key, i) => [key, positions[i]]));
  return books
    .map((book) => ({ ...book, fraction: progress.get(book.id)?.fraction ?? 0, read_at: progress.get(book.id)?.updated ?? null }))
    .sort((a, b) => (b.read_at ?? b.created) - (a.read_at ?? a.created));
}

export async function getBook(id) {
  const [book, doc] = await Promise.all([store.get('books', id), store.get('docs', id)]);
  if (!book || !doc) throw new Error('Dieses Buch ist nicht (mehr) in der Bibliothek.');
  return { book, doc };
}

export const getOriginal = (id) => store.get('files', id);

export async function deleteBook(id) {
  const [marks, readings] = await Promise.all([store.byBook('bookmarks', id), store.byBook('readings', id)]);
  await store.transaction(['books', 'docs', 'files', 'progress', 'bookmarks', 'readings'], (s) => {
    for (const name of ['books', 'docs', 'files', 'progress']) s[name].delete(id);
    for (const mark of marks) s.bookmarks.delete(mark.id);
    for (const reading of readings) s.readings.delete(reading.id);
  });
}

// ---------------------------------------------------------------- reading position

export const loadProgress = (bookId) => store.get('progress', bookId);

export function saveProgress(bookId, { para, offset, fraction, wpm }) {
  return store.put('progress', { para, offset, fraction, wpm, updated: Date.now() / 1000 }, bookId).catch(() => {});
}

// ---------------------------------------------------------------- bookmarks

export async function listBookmarks(bookId) {
  const marks = await store.byBook('bookmarks', bookId);
  return marks.sort((a, b) => a.para - b.para || a.offset - b.offset);
}

export async function addBookmark(bookId, { para, offset, snippet }) {
  const mark = { book_id: bookId, para, offset, snippet, created: Date.now() / 1000 };
  mark.id = await store.add('bookmarks', mark);
  return mark;
}

export const removeBookmark = (id) => store.remove('bookmarks', id);

// ---------------------------------------------------------------- statistics

export function addReading({ book_id, started, active_ms, words }) {
  if (words === 0 || active_ms < 1000) return Promise.resolve();
  return store.add('readings', { book_id, started, active_ms, words }).catch(() => {});
}

const dayKey = (seconds) => {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export async function readingStats() {
  const [readings, books] = await Promise.all([store.getAll('readings'), store.getAll('books')]);
  const titles = new Map(books.map((book) => [book.id, book.title]));
  const total = { ms: 0, words: 0, n: readings.length };
  const days = new Map();
  const perBook = new Map();
  const since = Date.now() / 1000 - 30 * 86400;
  for (const r of readings) {
    total.ms += r.active_ms;
    total.words += r.words;
    if (r.started > since) {
      const day = days.get(dayKey(r.started)) ?? { day: dayKey(r.started), ms: 0, words: 0 };
      day.ms += r.active_ms;
      day.words += r.words;
      days.set(day.day, day);
    }
    if (titles.has(r.book_id)) {
      const entry = perBook.get(r.book_id) ?? { id: r.book_id, title: titles.get(r.book_id), ms: 0, words: 0 };
      entry.ms += r.active_ms;
      entry.words += r.words;
      perBook.set(r.book_id, entry);
    }
  }
  return {
    total,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    books: [...perBook.values()].sort((a, b) => b.ms - a.ms).slice(0, 20),
  };
}
