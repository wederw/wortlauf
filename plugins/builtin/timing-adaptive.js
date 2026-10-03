// Gives long words and numbers more time and short words a little less.
export default {
  name: 'Tempo nach Wortlänge',
  description: 'Lange Wörter und Zahlen bleiben länger stehen, kurze etwas kürzer.',
  settings: {
    threshold: { type: 'number', label: 'Lang ab (Zeichen)', default: 7, min: 4, max: 20, step: 1 },
    perChar: { type: 'number', label: 'Zuschlag je weiterem Zeichen (%)', default: 5, min: 0, max: 20, step: 1 },
    numbers: { type: 'number', label: 'Zuschlag für Zahlen (%)', default: 60, min: 0, max: 200, step: 10 },
    short: { type: 'number', label: 'Dauer kurzer Wörter (%)', default: 85, min: 50, max: 100, step: 5 },
  },
  hooks: {
    timing(token, { ms, settings }) {
      const longest = Math.max(...token.text.split(' ').map((part) => part.replace(/[^\p{L}\p{N}]/gu, '').length));
      let factor = 1;
      if (longest > settings.threshold) factor += ((longest - settings.threshold) * settings.perChar) / 100;
      else if (longest <= 3 && token.words <= 1) factor = settings.short / 100;
      if (/\d/.test(token.text)) factor += settings.numbers / 100;
      return ms * Math.min(factor, 3);
    },
  },
};
