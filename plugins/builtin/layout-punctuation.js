// Fades punctuation and brackets at the edges of a unit so the letters stand out.
const LEADING = /^[^\p{L}\p{N}]+/u;
const TRAILING = /[^\p{L}\p{N}]+$/u;

export default {
  name: 'Satzzeichen abblenden',
  description: 'Satzzeichen am Anfang und Ende werden blasser dargestellt.',
  hooks: {
    layout(token, { layout }) {
      const segments = [...layout.segments];
      const lead = token.text.match(LEADING);
      const trail = token.text.match(TRAILING);
      if (lead && lead[0].length < token.text.length) segments.push({ start: 0, end: lead[0].length, style: 'dim' });
      if (trail && trail[0].length < token.text.length) {
        segments.push({ start: token.text.length - trail[0].length, end: token.text.length, style: 'dim' });
      }
      return { segments };
    },
  },
};
