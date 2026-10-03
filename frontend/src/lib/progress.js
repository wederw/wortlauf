// Reading positions survive a lost connection: every save is written to localStorage
// first and removed once the server has accepted it. The newer timestamp wins.
import { api } from './api.js';

const key = (bookId) => `wortlauf:progress:${bookId}`;

function readLocal(bookId) {
  try {
    return JSON.parse(localStorage.getItem(key(bookId)));
  } catch {
    return null;
  }
}

export async function saveProgress(bookId, progress) {
  const record = { ...progress, updated: Date.now() / 1000 };
  try {
    localStorage.setItem(key(bookId), JSON.stringify(record));
  } catch {
    /* storage unavailable: the server copy is still written below */
  }
  try {
    await api.put(`/api/books/${bookId}/progress`, record);
    localStorage.removeItem(key(bookId));
  } catch {
    /* stays queued locally */
  }
}

export async function loadProgress(bookId) {
  let server = null;
  try {
    server = await api.get(`/api/books/${bookId}/progress`);
  } catch {
    /* offline */
  }
  const local = readLocal(bookId);
  if (local && (!server || local.updated > server.updated)) {
    api.put(`/api/books/${bookId}/progress`, local).then(() => localStorage.removeItem(key(bookId))).catch(() => {});
    return local;
  }
  return server;
}

export function flushQueuedProgress() {
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (!name?.startsWith('wortlauf:progress:')) continue;
    const bookId = name.split(':')[2];
    const local = readLocal(bookId);
    if (local) api.put(`/api/books/${bookId}/progress`, local).then(() => localStorage.removeItem(name)).catch(() => {});
  }
}
