// Shows several words at once. Chunks never cross a sentence or paragraph boundary.
export default {
  name: 'Wortgruppen',
  description: 'Zeigt bis zu drei Wörter gleichzeitig an.',
  settings: {
    words: { type: 'number', label: 'Wörter je Anzeige', default: 2, min: 1, max: 3, step: 1 },
    maxChars: { type: 'number', label: 'Höchstens Zeichen', default: 18, min: 8, max: 40, step: 1 },
    breakAtComma: { type: 'boolean', label: 'Nach Komma neu beginnen', default: true },
  },
  hooks: {
    tokenize(tokens, { settings, FLAG }) {
      if (settings.words <= 1) return tokens;
      const out = [];
      let current = null;
      let count = 0;
      for (const token of tokens) {
        const fits =
          current &&
          count < settings.words &&
          current.para === token.para &&
          !(current.flags & (FLAG.SENTENCE_END | FLAG.PARA_END)) &&
          !(settings.breakAtComma && /[,;:]$/.test(current.text)) &&
          current.text.length + 1 + token.text.length <= settings.maxChars;
        if (fits) {
          current.text += ' ' + token.text;
          current.end = token.end;
          current.words += token.words;
          current.flags |= token.flags;
          count++;
        } else {
          current = { ...token };
          out.push(current);
          count = 1;
        }
      }
      return out;
    },
  },
};
