// Breaks very long words into readable parts: at existing hyphens where possible,
// otherwise at a syllable-like boundary. A heuristic, not a hyphenation dictionary.
const VOWEL = /[aeiouyäöüàáâèéêìíîòóôùúû]/i;

const KEEP_TOGETHER = ['ch', 'ck', 'ph', 'th'];

// A syllable usually starts with the last consonant in front of a vowel.
function isBoundary(word, i) {
  if (i < 2 || i > word.length - 3) return false;
  if (word[i - 1] === '-') return true;
  if (VOWEL.test(word[i]) || !VOWEL.test(word[i + 1])) return false;
  return !KEEP_TOGETHER.includes((word[i - 1] + word[i]).toLowerCase());
}

function cutPoint(word, from, size, limit) {
  const target = from + size;
  for (let distance = 0; distance < size - 2; distance++) {
    for (const i of [target - distance, target + distance]) {
      if (i - from >= 3 && i - from <= limit && isBoundary(word, i)) return i;
    }
  }
  return target;
}

export default {
  name: 'Lange Wörter teilen',
  description: 'Teilt sehr lange Wörter an Bindestrichen oder Silbengrenzen.',
  settings: {
    maxLength: { type: 'number', label: 'Teilen ab (Zeichen)', default: 16, min: 8, max: 40, step: 1 },
  },
  hooks: {
    tokenize(tokens, { settings, FLAG }) {
      const limit = settings.maxLength;
      const out = [];
      for (const token of tokens) {
        const word = token.text;
        if (word.length <= limit || word.includes(' ')) {
          out.push(token);
          continue;
        }
        const size = Math.ceil(word.length / Math.ceil(word.length / limit));
        let from = 0;
        while (word.length - from > limit) {
          const cut = cutPoint(word, from, size, limit);
          const part = word.slice(from, cut);
          out.push({
            text: part.endsWith('-') ? part : part + '-',
            para: token.para,
            start: token.start + from,
            end: token.start + cut,
            words: (token.words * part.length) / word.length,
            flags: token.flags & FLAG.HEADING,
          });
          from = cut;
        }
        out.push({
          ...token,
          text: word.slice(from),
          start: token.start + from,
          words: (token.words * (word.length - from)) / word.length,
        });
      }
      return out;
    },
  },
};
