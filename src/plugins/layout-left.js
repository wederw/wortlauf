// Every display unit starts at the same horizontal position, like a line of ordinary text.
export default {
  name: 'Linksbündig',
  description: 'Jede Einheit beginnt an derselben Stelle.',
  settings: {
    origin: { type: 'number', label: 'Abstand vom linken Rand (%)', default: 30, min: 10, max: 50, step: 5 },
  },
  hooks: {
    layout: (token, { settings }) => ({ anchor: 0, origin: settings.origin / 100 }),
  },
};
