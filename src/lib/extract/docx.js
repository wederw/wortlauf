import { byTag, childByTag, clean, ExtractError, finish, parseXml, textOf } from './common.js';
import { readZip } from './zip.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function extractDocx(data, fallbackTitle) {
  let zip, body;
  try {
    zip = readZip(data, (name) => name === 'word/document.xml' || name === 'docProps/core.xml');
    body = parseXml(zip.text('word/document.xml'));
  } catch {
    throw new ExtractError('Die Word-Datei ließ sich nicht lesen.');
  }

  const paras = [];
  for (const node of body.getElementsByTagNameNS(W, 'p')) {
    const parts = [];
    for (const child of node.getElementsByTagName('*')) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === 't') parts.push(child.textContent);
      else if (child.localName === 'tab' || child.localName === 'br') parts.push(' ');
    }
    const text = clean(parts.join(''));
    if (!text) continue;
    const para = { t: text };
    const style = childByTag(childByTag(node, 'pPr'), 'pStyle');
    if (style) {
      const name = style.getAttributeNS(W, 'val') ?? '';
      const match = name.match(/(?:heading|berschrift)\s*(\d)/i);
      if (match) para.h = Number(match[1]);
      else if (['title', 'titel'].includes(name.toLowerCase())) para.h = 1;
    }
    paras.push(para);
  }

  let title = fallbackTitle;
  let author = '';
  try {
    const core = parseXml(zip.text('docProps/core.xml'));
    title = textOf(byTag(core, 'title')[0]) || fallbackTitle;
    author = textOf(byTag(core, 'creator')[0]);
  } catch {
    /* no metadata */
  }
  return finish(title, author, paras, []);
}
