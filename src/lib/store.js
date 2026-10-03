// Everything the app keeps lives in this browser's IndexedDB. Nothing is sent anywhere.
//
//   books      { id, title, author, format, filename, words, size, created }
//   docs       extracted text { chapters, paras }, keyed by book id
//   files      original PDF as a Blob, keyed by book id (for the page view)
//   progress   { para, offset, fraction, wpm, updated }, keyed by book id
//   bookmarks  { id, book_id, para, offset, snippet, created }
//   readings   { id, book_id, started, active_ms, words }
//   settings   the settings object under the key 'ui'
//   scripts    { id: 'local/<name>', name, source, updated }
//
// A book's id is derived from the file's content, so progress and bookmarks from a backup
// find their book again after the same file is added on another device.

const NAME = 'wortlauf';
const VERSION = 1;

let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Dieser Browser kann keine Daten speichern. Im privaten Modus ist das oft abgeschaltet.'));
      return;
    }
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = ({ oldVersion }) => {
      const db = request.result;
      if (oldVersion < 1) {
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('docs');
        db.createObjectStore('files');
        db.createObjectStore('progress');
        db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true }).createIndex('book', 'book_id');
        db.createObjectStore('readings', { keyPath: 'id', autoIncrement: true }).createIndex('book', 'book_id');
        db.createObjectStore('settings');
        db.createObjectStore('scripts', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close(); // a newer version of the app in another tab
      resolve(db);
    };
    request.onerror = () => reject(new Error('Der Speicher des Browsers ist nicht verfügbar.'));
    request.onblocked = () => reject(new Error('Wortlauf ist in einem anderen Tab mit einer älteren Version offen. Bitte dort schließen.'));
  });
  opening.catch(() => (opening = null));
  return opening;
}

const result = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function single(storeName, mode, action) {
  const db = await open();
  return result(action(db.transaction(storeName, mode).objectStore(storeName)));
}

export const get = (store, key) => single(store, 'readonly', (s) => s.get(key));
export const getAll = (store) => single(store, 'readonly', (s) => s.getAll());
export const getAllKeys = (store) => single(store, 'readonly', (s) => s.getAllKeys());
export const put = (store, value, key) => single(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
export const add = (store, value) => single(store, 'readwrite', (s) => s.add(value));
export const remove = (store, key) => single(store, 'readwrite', (s) => s.delete(key));
export const byBook = (store, bookId) => single(store, 'readonly', (s) => s.index('book').getAll(bookId));

/**
 * Runs `work` with the named object stores inside one transaction and resolves once
 * everything is written. `work` must issue its requests synchronously or chain them
 * through request callbacks; awaiting anything else would end the transaction.
 */
export async function transaction(names, work) {
  const db = await open();
  const tx = db.transaction(names, 'readwrite');
  const stores = Object.fromEntries(names.map((name) => [name, tx.objectStore(name)]));
  work(stores);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Speichern abgebrochen.'));
  });
}

/** Asks the browser not to evict the library when storage runs low. */
export async function persist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}
