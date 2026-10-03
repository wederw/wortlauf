import { clean, decode, finish } from './common.js';

const MD_HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;
const PLAIN_HEADING = /^(kapitel|chapter|teil|part|buch|book|abschnitt|prolog|epilog|prologue|epilogue)\b.{0,60}$/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+/;

function stripMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(LIST_ITEM, '');
}

export function extractText(data, fallbackTitle, markdown) {
  const text = decode(data).replace(/\r\n?/g, '\n');
  let blocks = text.split(/\n\s*\n/);
  if (blocks.length < 3 && (text.match(/\n/g)?.length ?? 0) > 20) {
    blocks = text.split('\n'); // no blank lines at all: every line is a paragraph
  }

  const paras = [];
  let fenced = false;
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim());
    const pending = [];

    const close = () => {
      if (pending.length === 0) return;
      const joined = clean(pending.join(' '));
      if (joined) paras.push({ t: markdown ? stripMarkdown(joined) : joined });
      pending.length = 0;
    };

    for (const line of lines) {
      if (markdown && line.trim().startsWith('```')) {
        fenced = !fenced;
        close();
        continue;
      }
      const heading = markdown && !fenced ? line.trim().match(MD_HEADING) : null;
      if (heading) {
        close();
        paras.push({ t: stripMarkdown(heading[2]), h: heading[1].length });
      } else if (!markdown && lines.length === 1 && PLAIN_HEADING.test(line.trim())) {
        paras.push({ t: clean(line), h: 2 });
      } else if (markdown && /^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        close();
      } else if (markdown && !fenced && LIST_ITEM.test(line)) {
        close();
        pending.push(line);
      } else {
        pending.push(line);
      }
    }
    close();
  }
  return finish(fallbackTitle, '', paras, []);
}
