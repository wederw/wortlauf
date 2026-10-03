import { byTag, childByTag, clean, ExtractError, finish, parseXml, textOf } from './common.js';
import { htmlBlocks, parseHtml } from './html.js';
import { readZip } from './zip.js';

// images, fonts and media are never needed for the text
const MEDIA = /\.(jpe?g|png|gif|webp|avif|bmp|svg|ttf|otf|woff2?|mp3|mp4|m4a|ogg|webm)$/i;

const unquote = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
const dirname = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const join = (dir, relative) => normalize(dir ? `${dir}/${relative}` : relative);

/** Resolves a link inside `docPath` to [archive path, fragment]. */
function resolve(docPath, href) {
  const hash = href.indexOf('#');
  const target = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 ? '' : href.slice(hash + 1);
  return [target ? join(dirname(docPath), unquote(target)) : docPath, unquote(fragment)];
}

/** Table of contents as [path, fragment, title] in reading order. */
function tableOfContents(zip, manifest, base) {
  const entries = [];
  const items = [...manifest.values()];

  const nav = items.find((item) => (item.getAttribute('properties') ?? '').split(/\s+/).includes('nav'));
  if (nav) {
    const navPath = join(base, unquote(nav.getAttribute('href') ?? ''));
    const doc = parseHtml(zip.text(navPath));
    const toc = [...doc.querySelectorAll('nav')].find((n) => (n.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc'));
    for (const link of (toc ?? doc).querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      const title = clean(link.textContent);
      if (title && href && !/^[a-z]+:/i.test(href)) entries.push([...resolve(navPath, href), title]);
    }
  }
  if (entries.length) return entries;

  const ncx = items.find((item) => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
  if (ncx) {
    const ncxPath = join(base, unquote(ncx.getAttribute('href') ?? ''));
    let doc;
    try {
      doc = parseXml(zip.text(ncxPath));
    } catch {
      return entries;
    }
    for (const point of byTag(doc, 'navPoint')) {
      const label = childByTag(childByTag(point, 'navLabel'), 'text');
      const src = childByTag(point, 'content')?.getAttribute('src');
      if (label && src) entries.push([...resolve(ncxPath, src), textOf(label)]);
    }
  }
  return entries;
}

export function extractEpub(data, fallbackTitle) {
  let zip, opfPath, opf;
  try {
    zip = readZip(data, (name) => !MEDIA.test(name));
    const container = parseXml(zip.text('META-INF/container.xml'));
    opfPath = byTag(container, 'rootfile')[0].getAttribute('full-path');
    opf = parseXml(zip.text(opfPath));
  } catch {
    throw new ExtractError('Die ePub-Datei ist beschädigt oder kein gültiges ePub.');
  }

  const base = dirname(opfPath);
  const metadata = byTag(opf, 'metadata')[0];
  const title = textOf(byTag(metadata, 'title')[0]) || fallbackTitle;
  const author = textOf(byTag(metadata, 'creator')[0]);
  const manifest = new Map(byTag(byTag(opf, 'manifest')[0], 'item').map((item) => [item.getAttribute('id'), item]));
  const spine = byTag(byTag(opf, 'spine')[0], 'itemref')
    .filter((ref) => manifest.has(ref.getAttribute('idref')) && ref.getAttribute('linear') !== 'no')
    .map((ref) => manifest.get(ref.getAttribute('idref')));

  const tocByFile = new Map();
  for (const [path, fragment, entryTitle] of tableOfContents(zip, manifest, base)) {
    if (!tocByFile.has(path)) tocByFile.set(path, []);
    tocByFile.get(path).push([fragment, entryTitle]);
  }

  const paras = [];
  const chapters = [];
  for (const item of spine) {
    const path = join(base, unquote(item.getAttribute('href') ?? ''));
    const blocks = htmlBlocks(zip.text(path)).out;
    if (blocks.length === 0) continue;
    const start = paras.length;
    paras.push(...blocks);
    if (tocByFile.size) {
      for (const [fragment, entryTitle] of tocByFile.get(path) ?? []) {
        const found = fragment ? blocks.findIndex((block) => block.ids.includes(fragment)) : 0;
        chapters.push({ title: entryTitle, start: start + Math.max(0, found) });
      }
    } else {
      const heading = blocks.find((block) => block.h)?.t;
      chapters.push({ title: heading ?? `Abschnitt ${chapters.length + 1}`, start });
    }
  }

  if (paras.length === 0 && zip.names.includes('META-INF/encryption.xml')) {
    throw new ExtractError('Das ePub ist kopiergeschützt (DRM) und lässt sich nicht lesen.');
  }
  return finish(title, author, paras, chapters);
}
