// Builds small test documents in memory.
import { strToU8, zipSync } from 'fflate';

export function makeEpub() {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>' +
        '<rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    ),
    'OEBPS/content.opf': strToU8(
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<metadata><dc:title>Der Testband</dc:title><dc:creator>A. Autorin</dc:creator></metadata>' +
        '<manifest><item id="a" href="text/a.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="b" href="text/b.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>' +
        '<spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    ),
    'OEBPS/toc.ncx': strToU8(
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>' +
        '<navPoint><navLabel><text>Erstes Kapitel</text></navLabel><content src="text/a.xhtml"/></navPoint>' +
        '<navPoint><navLabel><text>Zweites Kapitel</text></navLabel><content src="text/b.xhtml"/></navPoint>' +
        '<navPoint><navLabel><text>Zweites, Teil B</text></navLabel><content src="text/b.xhtml#teil-b"/></navPoint>' +
        '</navMap></ncx>',
    ),
    'OEBPS/text/a.xhtml': strToU8(
      '<html><head><title>x</title><style>p{}</style></head><body><h1>Erstes Kapitel</h1>' +
        '<p>Ein Satz mit <em>Betonung</em> und&nbsp;Umbruch.</p><p>Zweiter Absatz.</p></body></html>',
    ),
    'OEBPS/text/b.xhtml': strToU8(
      '<html><body><h1>Zweites Kapitel</h1><p>Text.</p><h2 id="teil-b">Teil B</h2><p>Mehr Text.</p></body></html>',
    ),
  });
}

export function makeDocx() {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zipSync({
    'word/document.xml': strToU8(
      `<w:document ${w}><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Überschrift</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve">Absatz im </w:t></w:r><w:r><w:t>Dokument.</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    ),
  });
}

/** PDF string literal in WinAnsiEncoding; enough for Latin-1 test text. */
function pdfString(text) {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += char;
  }
  return `(${out})`;
}

/**
 * A PDF with Helvetica text. `pages` is a list of pages, each a list of [x, y, text, size?]
 * or of raw content-stream operators as a string. `outline` is a list of [title, page number].
 */
export function makePdf(pages, { title, outline = [] } = {}) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const tree = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds = pages.map((lines) => {
    const stream = lines
      .map((entry) => (typeof entry === 'string' ? entry : `BT /F1 ${entry[3] ?? 10} Tf ${entry[0]} ${entry[1]} Td ${pdfString(entry[2])} Tj ET`))
      .join('\n');
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`);
  });
  objects[tree - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let outlines = '';
  if (outline.length) {
    const root = add(null);
    const ids = outline.map(() => add(null));
    outline.forEach(([entry, page], i) => {
      const links = `${i > 0 ? `/Prev ${ids[i - 1]} 0 R ` : ''}${i < ids.length - 1 ? `/Next ${ids[i + 1]} 0 R ` : ''}`;
      objects[ids[i] - 1] = `<< /Title ${pdfString(entry)} /Parent ${root} 0 R ${links}/Dest [${pageIds[page - 1]} 0 R /XYZ 0 595 0] >>`;
    });
    objects[root - 1] = `<< /Type /Outlines /First ${ids[0]} 0 R /Last ${ids.at(-1)} 0 R /Count ${ids.length} >>`;
    outlines = ` /Outlines ${root} 0 R`;
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R${outlines} >>`;
  const info = title ? add(`<< /Title ${pdfString(title)} >>`) : 0;

  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array([...out].map((char) => char.charCodeAt(0)));
}
