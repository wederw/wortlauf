// Host for reading scripts. Runs as a module worker created from a blob URL, so it has no
// DOM and inherits the page's Content-Security-Policy, which forbids every network request.
// The globals below are removed as a second line of defence.
import { createEngine, describe } from './kernel.js';

for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator']) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* some globals cannot be redefined in every browser; the CSP still applies */
  }
}

const registry = new Map();
let engine = createEngine(registry);

const commands = {
  /** `plugins` is a list of { id, source }; each source is an ES module. */
  async load({ plugins }) {
    registry.clear();
    const manifests = [];
    for (const plugin of plugins) {
      const url = URL.createObjectURL(new Blob([plugin.source], { type: 'text/javascript' }));
      try {
        const module = await import(url);
        const manifest = describe(plugin.id, module.default);
        registry.set(plugin.id, module.default);
        manifests.push(manifest);
      } catch (error) {
        manifests.push({ id: plugin.id, name: plugin.id, description: '', hooks: [], settings: {}, error: String(error?.message ?? error) });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    engine = createEngine(registry);
    return manifests;
  },
  prepare: (args) => engine.prepare(args),
  retime: ({ wpm }) => engine.retime(wpm),
  flow: ({ event }) => engine.flow(event),
  stats: ({ session }) => engine.stats(session),
};

self.onmessage = async ({ data }) => {
  const { id, cmd, args } = data;
  try {
    const result = await commands[cmd](args ?? {});
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
};
