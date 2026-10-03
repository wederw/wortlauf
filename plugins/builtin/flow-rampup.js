// Eases back in after a pause: steps a few words back and starts slower.
export default {
  name: 'Sanft anfahren',
  description: 'Springt nach einer Pause ein paar Wörter zurück und beginnt langsamer.',
  settings: {
    rewind: { type: 'number', label: 'Wörter zurück', default: 3, min: 0, max: 20, step: 1 },
    start: { type: 'number', label: 'Anfangstempo (%)', default: 60, min: 30, max: 100, step: 5 },
    tokens: { type: 'number', label: 'Volles Tempo nach (Wörtern)', default: 12, min: 1, max: 50, step: 1 },
  },
  hooks: {
    flow(event, { settings }) {
      if (event.type === 'start') return [{ type: 'speed', factor: settings.start / 100, tokens: settings.tokens }];
      if (event.type === 'resume') {
        return [
          { type: 'rewind', tokens: settings.rewind },
          { type: 'speed', factor: settings.start / 100, tokens: settings.tokens },
        ];
      }
      return [];
    },
  },
};
