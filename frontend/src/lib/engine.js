// Main-thread side of the script engine: owns the worker and exposes its commands as promises.
import { api } from './api.js';
import { app, syncProfiles } from './state.svelte.js';

let worker = null;
let sequence = 0;
let fingerprint = '';
const pending = new Map();

function spawn() {
  const next = new Worker('/engine/worker.js', { type: 'module' });
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

function call(cmd, args) {
  if (!worker) return Promise.reject(new Error('Die Script-Engine ist nicht geladen.'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, args });
  });
}

/**
 * Loads the scripts from the server. Returns true when the set of scripts changed, which
 * is how an edited file in plugins/local shows up without a page reload.
 */
export async function loadPlugins() {
  const list = await api.get('/api/plugins');
  const next = JSON.stringify(list);
  if (worker && next === fingerprint) return false;
  worker?.terminate();
  for (const entry of pending.values()) entry.reject(new Error('Scripts wurden neu geladen.'));
  pending.clear();
  worker = spawn();
  app.plugins = await call('load', { plugins: list });
  fingerprint = next;
  syncProfiles();
  return true;
}

export const engine = {
  prepare: (args) => call('prepare', args),
  retime: (wpm) => call('retime', { wpm }),
  flow: (event) => call('flow', { event }),
  stats: (session) => call('stats', { session }),
};
