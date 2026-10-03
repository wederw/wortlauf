// pdf.js is large, so it is loaded only when a PDF is added or shown. The legacy build is
// used on purpose: the default build needs very recent browsers.
let loading = null;

export function loadPdfjs() {
  loading ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    return pdfjs;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Opens a stored PDF for display. The caller destroys it when done. */
export async function openPdf(blob) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}
