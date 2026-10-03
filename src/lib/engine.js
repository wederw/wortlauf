// Main-thread side of the script engine: owns the worker and exposes its commands as promises.
import EngineWorker from '../engine/worker.js?worker&inline';
import { app, syncProfiles } from './state.svelte.js';
import * as store from './store.js';

// The built-in scripts ship as source text and run in the worker exactly like imported ones.
const BUILTIN = Object.entries(import.meta.glob('../plugins/*.js', { query: '?raw', import: 'default', eager: true }))
  .map(([path, source]) => ({ id: `builtin/${path.match(/([^/]+)\.js$/)[1]}`, source }))
  .sort((a, b) => a.id.localeCompare(b.id));

let worker = null;
let sequence = 0;
let fingerprint = '';
let ready = Promise.resolve(false); // the latest (re)load of the scripts
const pending = new Map();

function spawn() {
  const next = new EngineWorker({ name: 'wortlauf-scripts' });
  next.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error));
  };
  next.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || 'Die Script-Engine ist abgestürzt.'));
    pending.clear();
  };
  return next;
}

function send(cmd, args) {
  if (!worker) return Promise.reject(new Error('Die Script-Engine ist nicht geladen.'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, args });
  });
}

/** Commands wait until the scripts are loaded, so nothing runs against a half-filled registry. */
async function call(cmd, args) {
  await ready.catch(() => {});
  return send(cmd, args);
}

/** Imported scripts, sorted by id. */
export async function localScripts() {
  const scripts = await store.getAll('scripts');
  return scripts.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Loads the built-in and the imported scripts into a fresh worker. Resolves to true when the
 * set of scripts changed since the last load.
 */
export function loadPlugins() {
  ready = ready
    .catch(() => {})
    .then(async () => {
      const local = await localScripts();
      const next = JSON.stringify(local.map((s) => [s.id, s.updated]));
      if (worker && next === fingerprint) return false;
      worker?.terminate();
      for (const entry of pending.values()) entry.reject(new Error('Scripts wurden neu geladen.'));
      pending.clear();
      worker = spawn();
      app.plugins = await send('load', { plugins: [...BUILTIN, ...local.map(({ id, source }) => ({ id, source }))] });
      fingerprint = next;
      syncProfiles();
      return true;
    });
  return ready;
}

/** Stores a script file the reader picked. Its id comes from the file name. */
export async function importScript(file) {
  const base = file.name.replace(/\.m?js$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  if (!base) throw new Error('Der Dateiname taugt nicht als Name für ein Script.');
  if (file.size > 512 * 1024) throw new Error('Das Script ist größer als 512 KB.');
  const script = { id: `local/${base}`, name: file.name, source: await file.text(), updated: Date.now() };
  await store.put('scripts', script);
  await loadPlugins();
  return script;
}

export async function removeScript(id) {
  // profiles keep the script's entry, so its settings return if it is imported again
  await store.remove('scripts', id);
  await loadPlugins();
}

export const engine = {
  prepare: (args) => call('prepare', args),
  retime: (wpm) => call('retime', { wpm }),
  flow: (event) => call('flow', { event }),
  stats: (session) => call('stats', { session }),
};
