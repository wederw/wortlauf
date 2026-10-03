// A few extra figures for the session summary.
export default {
  name: 'Sitzungswerte',
  description: 'Tatsächliches Tempo, Unterbrechungen und längstes Wort der Sitzung.',
  hooks: {
    stats(session, { tokens }) {
      const rows = [];
      if (session.activeMs > 0) {
        rows.push({ label: 'Tatsächliches Tempo', value: `${Math.round(session.words / (session.activeMs / 60000))} Wörter/min` });
      }
      rows.push({ label: 'Unterbrechungen', value: session.pauses });
      let longest = '';
      for (let i = session.from; i <= session.to && i < tokens.length; i++) {
        const word = tokens[i].text.replace(/[^\p{L}\p{N}-]/gu, '');
        if (word.length > longest.length) longest = word;
      }
      if (longest) rows.push({ label: 'Längstes Wort', value: longest });
      return rows;
    },
  },
};
