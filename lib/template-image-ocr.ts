import { createWorker } from "tesseract.js";
import type { PageBox, Region, TemplateField } from "./template-api";
import { createId } from "./create-id";

const localWorker = () =>
  createWorker("eng", 1, {
    langPath: "/",
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    workerBlobURL: false,
  });

export async function readPhotos(file: File, regions: Region[]) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    worker = await localWorker();
    const results: { text: string; confidence: number }[] = [];
    for (const region of regions) {
      const cropWidth = bitmap.width * region.width,
        cropHeight = bitmap.height * region.height;
      const scale = Math.min(3, 4096 / Math.max(cropWidth, cropHeight));
      canvas.width = Math.max(1, Math.round(cropWidth * scale));
      canvas.height = Math.max(1, Math.round(cropHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare image for OCR");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        bitmap,
        bitmap.width * region.x,
        bitmap.height * region.y,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const result = await worker.recognize(canvas);
      results.push({
        text: result.data.text,
        confidence: result.data.confidence,
      });
    }
    return results;
  } finally {
    bitmap.close();
    await worker?.terminate();
  }
}

export async function readPhoto(file: File, region: Region) {
  return (await readPhotos(file, [region]))[0];
}

/** Use an existing PDF photo as the reference image without another upload. */
export async function pdfRegionImage(
  source: Uint8Array,
  box: PageBox,
): Promise<File> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await getDocument({ data: source.slice() }).promise;
  try {
    const page = await pdf.getPage(box.page + 1),
      size = page.getViewport({ scale: 1 }),
      viewport = page.getViewport({
        scale: Math.min(2, 4096 / Math.max(size.width, size.height)),
      });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(box.width * canvas.width));
    crop.height = Math.max(1, Math.round(box.height * canvas.height));
    const cropped = crop.getContext("2d");
    if (!cropped) throw new Error("Canvas unavailable");
    cropped.drawImage(
      canvas,
      box.x * canvas.width,
      box.y * canvas.height,
      box.width * canvas.width,
      box.height * canvas.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      crop.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Could not prepare PDF photo")),
        "image/png",
      ),
    );
    return new File([blob], "template-photo.png", { type: "image/png" });
  } finally {
    await pdf.destroy();
  }
}

/** Raster pages have no PDF text objects: use local OCR plus visible line geometry. */
export async function detectScannedPage(
  source: Uint8Array,
  pageNumber: number,
): Promise<TemplateField[]> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await getDocument({ data: source.slice() }).promise;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const page = await pdf.getPage(pageNumber + 1);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(2, 1200 / size.width),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    worker = await localWorker();
    const { data } = await worker.recognize(
      canvas,
      {},
      { text: true, blocks: true },
    );
    const words = (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) => line.words),
      ),
    );
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const dark = (x: number, y: number) => {
      const i = (y * canvas.width + x) * 4;
      return Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 110;
    };
    const horizontal: { x: number; y: number; end: number }[] = [];
    for (let y = 0; y < canvas.height; y++) {
      let start = -1;
      for (let x = 0; x <= canvas.width; x++) {
        if (x < canvas.width && dark(x, y)) {
          if (start < 0) start = x;
        } else if (start >= 0) {
          if (x - start > 35) horizontal.push({ x: start, y, end: x });
          start = -1;
        }
      }
    }
    const edges = horizontal
      .filter(
        (line, index) =>
          !horizontal
            .slice(Math.max(0, index - 30), index)
            .some(
              (other) =>
                Math.abs(other.y - line.y) < 3 &&
                Math.abs(other.x - line.x) < 3 &&
                Math.abs(other.end - line.end) < 3,
            ),
      )
      .slice(0, 1500);
    const boxes: Region[] = [];
    for (const upper of edges)
      for (const lower of edges) {
        const height = lower.y - upper.y;
        if (
          height < 14 ||
          Math.abs(upper.x - lower.x) > 4 ||
          Math.abs(upper.end - lower.end) > 4
        )
          continue;
        const intact = (x: number) => {
          let count = 0;
          for (let y = upper.y; y <= lower.y; y++)
            if (
              dark(Math.min(canvas.width - 1, x), y) ||
              dark(Math.max(0, x - 1), y) ||
              dark(Math.min(canvas.width - 1, x + 1), y)
            )
              count++;
          return count / (height + 1) > 0.8;
        };
        if (!intact(upper.x) || !intact(upper.end - 1)) continue;
        boxes.push({
          x: upper.x / canvas.width,
          y: upper.y / canvas.height,
          width: (upper.end - upper.x) / canvas.width,
          height: height / canvas.height,
        });
      }
    const cells = boxes
      .filter(
        (box) =>
          !boxes.some(
            (other) =>
              other !== box &&
              other.x >= box.x - 0.002 &&
              other.y >= box.y - 0.002 &&
              other.x + other.width <= box.x + box.width + 0.002 &&
              other.y + other.height <= box.y + box.height + 0.002 &&
              other.width * other.height < box.width * box.height * 0.8,
          ),
      )
      .slice(0, 300);
    return cells.map((box, index) => {
      const inside = words.filter(
        (word) =>
          word.bbox.x0 / canvas.width >= box.x &&
          word.bbox.x1 / canvas.width <= box.x + box.width &&
          word.bbox.y0 / canvas.height >= box.y &&
          word.bbox.y1 / canvas.height <= box.y + box.height,
      );
      const first = inside.filter(
        (word) =>
          word.bbox.y0 / canvas.height <
          box.y + Math.min(0.025, box.height * 0.3),
      );
      const label =
        first
          .map((word) => word.text)
          .join(" ")
          .replace(/:$/, "") || `Scanned field ${index + 1}`;
      const top = first.length
        ? Math.max(...first.map((word) => word.bbox.y1 / canvas.height)) + 0.004
        : box.y + 0.004;
      return {
        id: createId(),
        page: pageNumber,
        x: box.x + 0.004,
        y: top,
        width: Math.max(0.002, box.width - 0.008),
        height: Math.max(0.002, box.y + box.height - top - 0.004),
        label,
        kind: "text",
        role: null,
        required: true,
        font: "Times-Roman",
        font_size: 16,
        color: "#000000",
        alignment: "center",
        options: [],
        calculation: null,
        suggested_value: inside
          .filter((word) => !first.includes(word))
          .map((word) => word.text)
          .join(" "),
      };
    });
  } finally {
    await worker?.terminate();
    await pdf.destroy();
  }
}
