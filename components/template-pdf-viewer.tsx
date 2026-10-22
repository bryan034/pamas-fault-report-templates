"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
type RenderedPage = {
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
};

function PageFrame({
  page,
  index,
  overlay,
}: {
  page: RenderedPage;
  index: number;
  overlay?: ReactNode;
}) {
  const target = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = target.current;
    if (!canvas) return;
    // Paint an already rendered buffer; don't clear the visible page while PDF.js works.
    if (canvas.width !== page.canvas.width) canvas.width = page.canvas.width;
    if (canvas.height !== page.canvas.height)
      canvas.height = page.canvas.height;
    canvas.getContext("2d")?.drawImage(page.canvas, 0, 0);
  }, [page.canvas]);
  return (
    <div
      className="template-paper"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      <canvas ref={target} aria-label={`PDF page ${index + 1}`} />
      {overlay}
    </div>
  );
}

export default function TemplatePdfViewer({
  source,
  overlay,
}: {
  source: Uint8Array | string | null;
  overlay?: (
    page: number,
    size: { width: number; height: number },
  ) => ReactNode;
}) {
  const [pages, setPages] = useState<RenderedPage[]>([]),
    [error, setError] = useState("");
  const [width, setWidth] = useState(600),
    [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(100, Math.round(entries[0].contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!source) return;
    let cancelled = false,
      loading: { destroy: () => Promise<void> } | undefined;
    const tasks: { cancel: () => void }[] = [];
    void (async () => {
      setBusy(true);
      setError("");
      try {
        const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
        GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = getDocument(
          typeof source === "string"
            // PDF.js fetches URLs itself, outside our credentialed API helper.
            // Local UI/API ports are different origins, so opt in to cookies.
            ? { url: source, withCredentials: true }
            : { data: source.slice() },
        );
        loading = task;
        const pdf = await task.promise,
          next: RenderedPage[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          if (cancelled) return;
          const page = await pdf.getPage(index),
            size = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale:
              (width / size.width) * Math.min(window.devicePixelRatio || 1, 2),
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas unavailable");
          const render = page.render({
            canvas,
            canvasContext: context,
            viewport,
          });
          tasks.push(render);
          await render.promise;
          next.push({ width: size.width, height: size.height, canvas });
        }
        if (!cancelled) setPages(next);
      } catch (cause) {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "PDF preview unavailable",
          );
      } finally {
        if (!cancelled) setBusy(false);
        void loading?.destroy().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((task) => task.cancel());
      void loading?.destroy().catch(() => undefined);
    };
  }, [source, width]);
  return (
    <div className="template-pdf-pages" ref={container} aria-busy={busy}>
      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}
      {!pages.length && !error && (
        <p className="list-state">Loading PDF preview…</p>
      )}
      {pages.map((page, index) => (
        <PageFrame
          key={index}
          page={page}
          index={index}
          overlay={overlay?.(index, page)}
        />
      ))}
    </div>
  );
}
