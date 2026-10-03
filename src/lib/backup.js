// A backup is a JSON file with settings, scripts, reading positions, bookmarks and reading
// sessions. The books themselves are not part of it: they are the reader's own files and
// are matched again by content when added on another device.
import * as store from './store.js';

const FORMAT = 'wortlauf-backup';

export async function exportBackup() {
  const [settings, scripts, books, progressKeys, progress, bookmarks, readings] = await Promise.all([
    store.get('settings', 'ui'),
    store.getAll('scripts'),
    store.getAll('books'),
    store.getAllKeys('progress'),
    store.getAll('progress'),
    store.getAll('bookmarks'),
    store.getAll('readings'),
  ]);
  const data = {
    format: FORMAT,
    version: 1,
    exported: new Date().toISOString(),
    settings: settings ?? {},
    scripts,
    books: books.map(({ id, title, author, filename }) => ({ id, title, author, filename })),
    progress: progressKeys.map((book_id, i) => ({ book_id, ...progress[i] })),
    bookmarks: bookmarks.map(({ id, ...mark }) => mark),
    readings: readings.map(({ id, ...reading }) => reading),
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `wortlauf-sicherung-${data.exported.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isId = (value) => typeof value === 'string' && /^[0-9a-f]{1,64}$/.test(value);

/**
 * Merges a backup into this browser. Newer reading positions win, bookmarks and sessions
 * that already exist are skipped, scripts and settings from the backup replace these.
 * @returns {Promise<string>} a short summary
 */
export async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist keine Wortlauf-Sicherung.');
  }
  if (data?.format !== FORMAT) throw new Error('Die Datei ist keine Wortlauf-Sicherung.');

  const [progressKeys, progress, bookmarks, readings] = await Promise.all([
    store.getAllKeys('progress'),
    store.getAll('progress'),
    store.getAll('bookmarks'),
    store.getAll('readings'),
  ]);
  const positions = new Map(progressKeys.map((key, i) => [key, progress[i]]));
  const markKeys = new Set(bookmarks.map((m) => `${m.book_id}:${m.para}:${m.offset}`));
  const readingKeys = new Set(readings.map((r) => `${r.book_id}:${r.started}`));
  const counts = { progress: 0, bookmarks: 0, readings: 0 };

  await store.transaction(['settings', 'scripts', 'progress', 'bookmarks', 'readings'], (s) => {
    if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) s.settings.put(data.settings, 'ui');
    for (const script of Array.isArray(data.scripts) ? data.scripts : []) {
      if (typeof script?.id === 'string' && script.id.startsWith('local/') && typeof script.source === 'string') {
        s.scripts.put({ id: script.id, name: String(script.name ?? script.id), source: script.source, updated: Number(script.updated) || Date.now() });
      }
    }
    for (const entry of Array.isArray(data.progress) ? data.progress : []) {
      const { book_id, para, offset, fraction, wpm, updated } = entry ?? {};
      if (!isId(book_id) || ![para, offset, fraction, updated].every(isNumber)) continue;
      if ((positions.get(book_id)?.updated ?? -1) >= updated) continue;
      s.progress.put({ para, offset, fraction, wpm: isNumber(wpm) ? wpm : null, updated }, book_id);
      counts.progress++;
    }
    for (const mark of Array.isArray(data.bookmarks) ? data.bookmarks : []) {
      const { book_id, para, offset, snippet, created } = mark ?? {};
      if (!isId(book_id) || ![para, offset].every(isNumber) || markKeys.has(`${book_id}:${para}:${offset}`)) continue;
      s.bookmarks.add({ book_id, para, offset, snippet: String(snippet ?? '').slice(0, 300), created: isNumber(created) ? created : Date.now() / 1000 });
      counts.bookmarks++;
    }
    for (const reading of Array.isArray(data.readings) ? data.readings : []) {
      const { book_id, started, active_ms, words } = reading ?? {};
      if (!isId(book_id) || ![started, active_ms, words].every(isNumber) || readingKeys.has(`${book_id}:${started}`)) continue;
      s.readings.add({ book_id, started, active_ms, words });
      counts.readings++;
    }
  });
  return `${counts.progress} Lesestände, ${counts.bookmarks} Lesezeichen und ${counts.readings} Sitzungen übernommen.`;
}
