// Suggests a break after a set amount of reading time, at the next sentence end.
export default {
  name: 'Lesepausen',
  description: 'Hält nach einer festen Lesezeit am nächsten Satzende an.',
  settings: {
    minutes: { type: 'number', label: 'Lesezeit bis zur Pause (min)', default: 25, min: 1, max: 120, step: 1 },
  },
  hooks: {
    flow(event, { settings, state }) {
      state.since ??= 0;
      if (event.activeMs - state.since < settings.minutes * 60000) return [];
      if (!['sentenceEnd', 'paragraphEnd', 'chapterEnd'].includes(event.type)) return [];
      state.since = event.activeMs;
      return [{ type: 'pause', message: `${settings.minutes} Minuten gelesen. Zeit für eine Pause.` }];
    },
  },
};
