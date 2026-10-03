import * as store from './store.js';

const on = (id, settings = {}) => ({ id: `builtin/${id}`, on: true, settings });
const off = (id, settings = {}) => ({ id: `builtin/${id}`, on: false, settings });

export const DEFAULT_SETTINGS = {
  theme: 'dusk',
  readerFont: 'literata',
  wordSize: 56,
  guides: true,
  pdfView: 'original', // how PDFs are shown: 'original' pages or the extracted 'text'
  defaultWpm: 300,
  activeProfile: 'standard',
  profiles: [
    {
      id: 'standard',
      name: 'Standard',
      plugins: [
        on('tokenize-split-long'),
        off('tokenize-chunks'),
        on('timing-adaptive'),
        on('timing-pauses'),
        on('layout-center'),
        off('layout-left'),
        off('layout-punctuation'),
        on('flow-rampup'),
        on('flow-chapter-pause'),
        off('flow-pomodoro'),
        on('stats-basics'),
      ],
    },
    {
      id: 'roman',
      name: 'Roman',
      plugins: [
        on('tokenize-split-long'),
        on('tokenize-chunks', { words: 2, maxChars: 16 }),
        on('timing-adaptive', { perChar: 3 }),
        on('timing-pauses', { sentence: 90, paragraph: 150 }),
        on('layout-center'),
        off('layout-left'),
        off('layout-punctuation'),
        on('flow-rampup'),
        off('flow-chapter-pause'),
        off('flow-pomodoro'),
        on('stats-basics'),
      ],
    },
    {
      id: 'fachtext',
      name: 'Fachtext',
      plugins: [
        on('tokenize-split-long', { maxLength: 13 }),
        off('tokenize-chunks'),
        on('timing-adaptive', { perChar: 8, numbers: 100 }),
        on('timing-pauses', { comma: 50, sentence: 180, paragraph: 300 }),
        on('layout-center'),
        off('layout-left'),
        on('layout-punctuation'),
        on('flow-rampup', { rewind: 5 }),
        on('flow-chapter-pause'),
        on('flow-pomodoro'),
        on('stats-basics'),
      ],
    },
  ],
};

function parseRoute() {
  const [name = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'library', arg };
}

export const app = $state({
  loading: true,
  route: parseRoute(),
  settings: structuredClone(DEFAULT_SETTINGS),
  plugins: [], // manifests reported by the script engine
  toast: null,
});

window.addEventListener('hashchange', () => (app.route = parseRoute()));
export const go = (path) => (location.hash = `#/${path}`);

let toastTimer;
export function toast(message, kind = 'info') {
  app.toast = { message, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (app.toast = null), kind === 'error' ? 7000 : 3500);
}

export async function loadSettings() {
  const stored = (await store.get('settings', 'ui')) ?? {};
  const merged = { ...structuredClone(DEFAULT_SETTINGS), ...stored };
  if (!Array.isArray(merged.profiles) || merged.profiles.length === 0) {
    merged.profiles = structuredClone(DEFAULT_SETTINGS.profiles);
  }
  if (!merged.profiles.some((p) => p.id === merged.activeProfile)) merged.activeProfile = merged.profiles[0].id;
  app.settings = merged;
}

let saveTimer;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.put('settings', $state.snapshot(app.settings), 'ui').catch((error) => toast(error.message, 'error'));
  }, 400);
}

/** Makes every installed script appear in every profile; new ones start switched off. */
export function syncProfiles() {
  const known = app.plugins.map((p) => p.id);
  let changed = false;
  for (const profile of app.settings.profiles) {
    for (const id of known) {
      if (!profile.plugins.some((entry) => entry.id === id)) {
        profile.plugins.push({ id, on: false, settings: {} });
        changed = true;
      }
    }
  }
  if (changed) saveSettings();
}

export function activeProfile() {
  return app.settings.profiles.find((p) => p.id === app.settings.activeProfile) ?? app.settings.profiles[0];
}

/** The enabled, installed scripts of a profile in pipeline order, as plain data for the worker. */
export function profileStack(profile) {
  const installed = new Set(app.plugins.filter((p) => !p.error).map((p) => p.id));
  return $state
    .snapshot(profile.plugins)
    .filter((entry) => entry.on && installed.has(entry.id))
    .map((entry) => ({ id: entry.id, settings: entry.settings ?? {} }));
}

export const READER_FONTS = {
  literata: { label: 'Literata', family: "'Literata Variable', Georgia, serif" },
  atkinson: { label: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  mono: { label: 'Monospace', family: "ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace" },
};

export const THEMES = { dusk: 'Dämmerung', paper: 'Papier', sepia: 'Sepia' };

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'unter 1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export const formatNumber = (value) => new Intl.NumberFormat('de-DE').format(Math.round(value));
