import type { PDFDocumentLoadingTask } from "pdfjs-dist";

export function loadPdf(source: string | Uint8Array) {
  let task: PDFDocumentLoadingTask | undefined;
  let destruction: Promise<void> | undefined;
  const promise = import("pdfjs-dist").then(({ getDocument, GlobalWorkerOptions }) => {
    if (destruction) throw new DOMException("PDF loading cancelled", "AbortError");
    GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    // PDF.js fetches background URLs across local UI/API ports with session cookies.
    task = getDocument(
      typeof source === "string" ? { url: source, withCredentials: true } : { data: source },
    );
    return task.promise;
  });

  return {
    promise,
    destroy() {
      return destruction ??= task?.destroy() ?? Promise.resolve();
    },
  };
}
