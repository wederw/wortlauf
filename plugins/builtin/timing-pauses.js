// Adds a breath after commas, sentences, paragraphs and headings.
export default {
  name: 'Atempausen',
  description: 'Zusätzliche Zeit nach Komma, Satzende, Absatz und Überschrift.',
  settings: {
    comma: { type: 'number', label: 'Nach Komma (%)', default: 35, min: 0, max: 200, step: 5 },
    sentence: { type: 'number', label: 'Nach Satzende (%)', default: 120, min: 0, max: 400, step: 10 },
    paragraph: { type: 'number', label: 'Nach Absatz (%)', default: 200, min: 0, max: 600, step: 10 },
    heading: { type: 'number', label: 'Überschriften (%)', default: 80, min: 0, max: 400, step: 10 },
  },
  hooks: {
    timing(token, { ms, baseMs, settings, FLAG }) {
      let extra = 0;
      if (token.flags & FLAG.PARA_END) extra = settings.paragraph;
      else if (token.flags & FLAG.SENTENCE_END) extra = settings.sentence;
      else if (/[,;:–—]["'»«”“’)\]]*$/.test(token.text)) extra = settings.comma;
      if (token.flags & FLAG.HEADING) extra += settings.heading;
      return ms + (baseMs / Math.max(token.words, 1)) * (extra / 100);
    },
  },
};
