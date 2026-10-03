// Turns a file into a neutral document. Everything runs in the browser; the file never
// leaves the device.
import { ExtractError } from './common.js';
import { extractDocx } from './docx.js';
import { extractEpub } from './epub.js';
import { extractHtml } from './html.js';
import { extractPdf } from './pdf.js';
import { extractText } from './text.js';
import { zipNames } from './zip.js';

export { ExtractError };

export const FORMATS = ['pdf', 'epub', 'docx', 'txt', 'md', 'html'];

export function detectFormat(filename, data) {
  const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  if (String.fromCharCode(...data.subarray(0, 5)) === '%PDF-') return 'pdf';
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const names = new Set(zipNames(data));
    if (names.has('META-INF/container.xml')) return 'epub';
    if (names.has('word/document.xml')) return 'docx';
    throw new ExtractError('Dieses Archivformat wird nicht unterstützt.');
  }
  if (extension === 'md' || extension === 'markdown') return 'md';
  if (['html', 'htm', 'xhtml'].includes(extension)) return 'html';
  if (['txt', 'text', ''].includes(extension)) return 'txt';
  throw new ExtractError(`Das Format .${extension} wird nicht unterstützt. Möglich sind PDF, ePub, DOCX, TXT, Markdown und HTML.`);
}

/**
 * @param {string} filename
 * @param {Uint8Array} data
 * @param {{ pdfjs?: () => Promise<object>, onprogress?: (fraction: number) => void }} [options]
 * @returns {Promise<{ format: string, doc: object }>}
 */
export async function extract(filename, data, { pdfjs, onprogress } = {}) {
  if (data.length === 0) throw new ExtractError('Die Datei ist leer.');
  const format = detectFormat(filename, data);
  const fallback = (filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename) || 'Ohne Titel';
  let doc;
  if (format === 'pdf') doc = await extractPdf(data.slice(), fallback, await pdfjs(), onprogress);
  else if (format === 'epub') doc = extractEpub(data, fallback);
  else if (format === 'docx') doc = extractDocx(data, fallback);
  else if (format === 'html') doc = extractHtml(data, fallback);
  else doc = extractText(data, fallback, format === 'md');
  return { format, doc };
}
