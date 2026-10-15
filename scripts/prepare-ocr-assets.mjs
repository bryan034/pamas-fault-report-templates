import { copyFile, mkdir, readdir } from "node:fs/promises";

// Serve OCR workers and WASM locally; document/image text never needs a cloud API.
const root = new URL("../public/ocr/", import.meta.url);
// PDF.js must receive a static worker, without Vite's browser-only HMR prelude.
await copyFile(
  new URL(
    "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ),
  new URL("../public/pdf.worker.min.mjs", import.meta.url),
);
await mkdir(new URL("core/", root), { recursive: true });
await copyFile(
  new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url),
  new URL("worker.min.js", root),
);
const core = new URL("../node_modules/tesseract.js-core/", import.meta.url);
for (const filename of await readdir(core)) {
  if (filename.endsWith(".wasm") || filename.endsWith(".wasm.js"))
    await copyFile(new URL(filename, core), new URL(`core/${filename}`, root));
}
