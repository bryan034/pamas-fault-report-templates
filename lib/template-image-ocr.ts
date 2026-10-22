import { createWorker, PSM } from "tesseract.js";
import type { PageBox, Region, TemplateField } from "./template-api";
import { createId } from "./create-id";
import { templateJson } from "./template-api";
import { bxTextInReadingOrder, extractBxReadings, mergeBxReadings } from "./bx-extraction";

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
      scale: Math.min(3, 1800 / size.width),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    worker = await localWorker();
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    // Read coloured headers as black text on white, while retaining the original
    // pixels below for border detection. Auto page segmentation often drops
    // orange phase labels and merges text with table rules.
    const originalPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const ocrCanvas = document.createElement("canvas");
    ocrCanvas.width = canvas.width;
    ocrCanvas.height = canvas.height;
    const ocrContext = ocrCanvas.getContext("2d");
    if (!ocrContext) throw new Error("Canvas unavailable");
    const normalized = new ImageData(new Uint8ClampedArray(originalPixels.data), canvas.width, canvas.height);
    const coloured = (x: number, y: number) => {
      if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return false;
      const i = (y * canvas.width + x) * 4, p = originalPixels.data;
      return p[i] > 180 && p[i + 1] > 65 && p[i + 1] < 200 && p[i + 2] < 65;
    };
    for (let y = 0; y < canvas.height; y++) {
      let start = -1, last = -1;
      const normalizeRun = () => {
        if (last - start < 8) return;
        for (let x = start; x <= last; x++) {
          const i = (y * canvas.width + x) * 4, p = originalPixels.data;
          // Blue separates white ink from orange fill, retaining antialiasing.
          // Preserve black ink too, for documents with black-on-orange labels.
          const value = Math.max(p[i], p[i+1], p[i+2]) < 120 ? 0 : 255-p[i+2];
          normalized.data.fill(value, i, i+3);
        }
      };
      for (let x = 0; x <= canvas.width; x++) {
        if (x < canvas.width && coloured(x,y)) {
          if (start < 0) start = x;
          last = x;
        } else if (start >= 0 && (x-last > 30 || x === canvas.width)) {
          normalizeRun();
          start = last = -1;
        }
      }
    }
    // Remove long rules from the OCR copy. Otherwise Tesseract can join a
    // header and the first reading into a single, unreadable connected shape.
    const eraseRuns = (vertical: boolean) => {
      const rows = vertical ? canvas.width : canvas.height;
      const length = vertical ? canvas.height : canvas.width;
      for (let row = 0; row < rows; row++) {
        let start = -1;
        for (let col = 0; col <= length; col++) {
          const index = (vertical ? col * canvas.width + row : row * canvas.width + col) * 4;
          const dark = col < length && normalized.data[index] < 150 && normalized.data[index + 1] < 150 && normalized.data[index + 2] < 150;
          if (dark && start < 0) start = col;
          if (!dark && start >= 0) {
            if (col - start > 80) for (let at = start; at < col; at++) {
              const i = (vertical ? at * canvas.width + row : row * canvas.width + at) * 4;
              normalized.data.fill(255, i, i + 3);
            }
            start = -1;
          }
        }
      }
    };
    eraseRuns(false);
    eraseRuns(true);
    ocrContext.putImageData(normalized, 0, 0);
    const { data } = await worker.recognize(
      ocrCanvas,
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
      // Orange fill is not a dark border; testing the darkest colour channel
      // incorrectly treated every orange pixel as a line.
      return .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2] < 110;
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
        // Long horizontal borders can span several columns. Split them at
        // continuous vertical separators rather than treating a whole row as a field.
        const cuts = [upper.x];
        for (let x = upper.x + 12; x < upper.end - 12; x++) {
          if (intact(x) && x - cuts[cuts.length - 1] > 6) cuts.push(x);
        }
        cuts.push(upper.end);
        for (let i = 0; i < cuts.length - 1; i++) boxes.push({
          x: cuts[i] / canvas.width,
          y: upper.y / canvas.height,
          width: (cuts[i + 1] - cuts[i]) / canvas.width,
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
    // Sparse-text mode can omit a lone N on an otherwise empty row. Read the
    // identified phase column again as a text block, without guessing missing labels.
    const phaseHeader = words.find((word) => word.text.toUpperCase() === "PHASE");
    if (phaseHeader) {
      const center = (phaseHeader.bbox.x0 + phaseHeader.bbox.x1) / 2 / canvas.width;
      const columnCells = cells.filter((box) => box.x <= center && center <= box.x + box.width
        && box.y * canvas.height >= phaseHeader.bbox.y1)
        .sort((a,b) => a.y-b.y);
      const column = columnCells[0] ? { ...columnCells[0] } : null;
      if (column) for (const next of columnCells.slice(1)) {
        if (Math.abs(next.x-column.x)*canvas.width > 4
          || Math.abs(next.width-column.width)*canvas.width > 4
          || (next.y-column.y-column.height)*canvas.height > 6) break;
        column.height = Math.max(column.height, next.y+next.height-column.y);
      }
      if (column) {
        const left = Math.ceil(column.x * canvas.width + 4), top = Math.ceil(column.y * canvas.height + 4);
        const crop = document.createElement("canvas");
        crop.width = Math.max(1, Math.floor(column.width * canvas.width - 8));
        crop.height = Math.max(1, Math.floor(column.height * canvas.height - 8));
        crop.getContext("2d")!.drawImage(ocrCanvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        const retry = await worker.recognize(crop, {}, { blocks: true });
        for (const block of retry.data.blocks ?? []) for (const paragraph of block.paragraphs)
          for (const line of paragraph.lines) for (const word of line.words) {
            if (!/^(L[123]|N)$/i.test(word.text)) continue;
            const bbox = { x0: word.bbox.x0 + left, x1: word.bbox.x1 + left,
              y0: word.bbox.y0 + top, y1: word.bbox.y1 + top };
            if (!words.some((existing) => existing.text.toUpperCase() === word.text.toUpperCase()
              && Math.abs(existing.bbox.y0 - bbox.y0) < 10 && Math.abs(existing.bbox.x0 - bbox.x0) < 10))
              words.push({ ...word, bbox });
          }
      }
    }
    const layout = await templateJson<{ cells: number[][]; fields: TemplateField[] }>(
      "/api/templates/analyze-scanned-layout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: pageNumber, size: { width: size.width, height: size.height },
          words: words.map((word) => ({
            text: word.text,
            x0: word.bbox.x0 / canvas.width * size.width,
            x1: word.bbox.x1 / canvas.width * size.width,
            top: word.bbox.y0 / canvas.height * size.height,
            bottom: word.bbox.y1 / canvas.height * size.height,
            size: (word.bbox.y1 - word.bbox.y0) / canvas.height * size.height,
            fontname: "",
          })),
          cells: cells.map((b) => [b.x * size.width, b.y * size.height,
            (b.x + b.width) * size.width, (b.y + b.height) * size.height]),
          shaded: cells.filter((b) => {
            let count = 0;
            for (const x of [.2,.5,.8]) for (const y of [.2,.5,.8])
              if (coloured(Math.floor((b.x+b.width*x)*canvas.width), Math.floor((b.y+b.height*y)*canvas.height))) count++;
            return count >= 3;
          }).map((b) => [b.x * size.width, b.y * size.height,
            (b.x + b.width) * size.width, (b.y + b.height) * size.height]),
        }),
      },
    );
    const remaining = layout.cells.map(([l,t,r,b]) => ({
      x: l/size.width, y: t/size.height, width: (r-l)/size.width, height: (b-t)/size.height,
    }));
    const inferred: TemplateField[] = remaining.map((box, index) => {
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
    return [...layout.fields, ...inferred].slice(0, 300);
  } finally {
    await worker?.terminate();
    await pdf.destroy();
  }
}

/** Read all visible BX readings, without saved crop coordinates or a cloud OCR API. */
export async function readBxPhoto(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const scale = Math.min(3, 4096 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare photo for BX extraction");
    worker = await localWorker();
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const results = [];
    let text = "";
    for (const contrast of [false, true]) {
      context.filter = contrast ? "grayscale(1) contrast(1.8)" : "none";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const {data} = await worker.recognize(canvas, {}, {text: true, blocks: true});
      const words = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)));
      const ordered = words.length ? bxTextInReadingOrder(words) : data.text;
      text = ordered;
      const readings = extractBxReadings(ordered);
      // Do not auto-fill guesses from a poorly recognised photo.
      if (data.confidence < 45) readings.values = {};
      results.push(readings);
      if (Object.keys(readings.values).length === 3 && !readings.ambiguous.length) break;
    }
    return {...mergeBxReadings(results), text};
  } finally {
    bitmap.close();
    await worker?.terminate();
  }
}
