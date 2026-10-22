import type { Definition, PageBox, TemplateField } from "./template-api.ts";

export type BxLabel = "BX1" | "BX2" | "BX3";
export type BxReadings = {
  values: Partial<Record<BxLabel, string>>;
  ambiguous: BxLabel[];
};
export type OcrWord = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};
const labels: BxLabel[] = ["BX1", "BX2", "BX3"];
const labelPattern = () => /\bB\s*[X×]\s*([123Il])\b/gi;
// Keep the usual temperature precision, including trailing .0, without rounding
// away extra digits that could distinguish conflicting OCR readings.
const formatReading = (value: number) => Number.isInteger(value) ? value.toFixed(1) : String(value);

/** Reconstruct visual rows even when OCR's block order separates labels from values. */
export function bxTextInReadingOrder(words: OcrWord[]): string {
  const rows: { words: OcrWord[]; y: number; height: number }[] = [];
  for (const word of [...words].sort((a,b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const row = rows.find(row => Math.abs(row.y - y) <= Math.max(row.height, height) * .5);
    if (row) row.words.push(word);
    else rows.push({ words: [word], y, height });
  }
  return rows.sort((a,b) => a.y - b.y)
    .map(row => row.words.sort((a,b) => a.bbox.x0 - b.bbox.x0).map(word => word.text).join(" "))
    .join("\n");
}

/** Read each BX's own segment; conflicting/multiple readings are never guessed. */
export function extractBxReadings(text: string): BxReadings {
  const normalized = text.replace(/[−–]/g, "-").replace(/-\s+(?=\d)/g, "-").replace(/(\d)[ \t]*[.,][ \t]*(?=\d)/g, "$1.");
  const matches = [...normalized.matchAll(labelPattern())];
  const found = new Map<BxLabel, Set<string>>();
  const ambiguous = new Set<BxLabel>();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const label = `BX${/^[il]$/i.test(match[1]) ? "1" : match[1]}` as BxLabel;
    const following = normalized.slice(match.index! + match[0].length, matches[index+1]?.index)
      .split("\n").map(line => line.trim()).filter(Boolean);
    // Use this label's visual row, or the immediately following value row.
    // Never collect unrelated palette/date/spot readings further down the image.
    let segment = following[0] || "";
    if (/^[:=|\s]*(?:(?:temp(?:erature)?|max|min|avg|average)[:=|\s]*)?$/i.test(segment))
      segment += " " + (following[1] || "");
    segment = segment.slice(0, 100);
    const temperatures = [...segment.matchAll(/(?<![a-z\d.])(-?\d{1,4}(?:\.\d+)?)\s*(?:°\s*|º\s*)?[CF]\b/gi)]
      .map(reading => Number(reading[1]));
    const plain = segment.match(/^\s*[:=|]?\s*(?:(?:temp(?:erature)?|max|min|avg|average)\s*[:=]?\s*)?(-?\d{1,4}(?:\.\d+)?)(?![\d.])/i);
    const numbers = [...segment.matchAll(/(?<![a-z\d.])(-?\d{1,4}(?:\.\d+)?)(?![\d.])/gi)].map(reading => Number(reading[1]));
    const readings = temperatures.length ? temperatures : plain ? numbers : [];
    const unique = [...new Set(readings.filter(Number.isFinite).map(formatReading))];
    if (unique.length > 1) ambiguous.add(label);
    if (unique.length === 1) {
      const values = found.get(label) || new Set<string>();
      values.add(unique[0]);
      found.set(label, values);
    }
  }
  const values: BxReadings["values"] = {};
  for (const label of labels) {
    const readings = found.get(label);
    if (readings && readings.size > 1) ambiguous.add(label);
    if (readings?.size === 1 && !ambiguous.has(label)) values[label] = [...readings][0];
  }
  return { values, ambiguous: [...ambiguous] };
}

export function mergeBxReadings(results: BxReadings[]): BxReadings {
  const ambiguous = new Set(results.flatMap(result => result.ambiguous));
  const values: BxReadings["values"] = {};
  for (const label of labels) {
    const readings = new Set(results.map(result => result.values[label]).filter(value => value !== undefined));
    if (readings.size > 1) ambiguous.add(label);
    if (readings.size === 1 && !ambiguous.has(label)) values[label] = [...readings][0];
  }
  return { values, ambiguous: [...ambiguous] };
}

export function fieldBxLabel(field: TemplateField): BxLabel | null {
  if (!["text", "textarea", "number"].includes(field.kind)) return null;
  const matches = [...field.label.matchAll(labelPattern())];
  const unique = new Set(matches.map(match => `BX${/^[il]$/i.test(match[1]) ? "1" : match[1]}` as BxLabel));
  return unique.size === 1 ? [...unique][0] : null;
}

/** Assign each field to its nearest image first, then choose the nearest BX of each kind. */
export function nearbyBxFields(definition: Definition, imageId: string, layout: Record<string, PageBox> = {}) {
  const image = definition.fields.find(field => field.id === imageId && field.kind === "image");
  if (!image) return { fields: {} as Partial<Record<BxLabel, TemplateField>>, ambiguous: [] as BxLabel[] };
  const boxFor = (field: TemplateField) => layout[field.id] || field;
  const source = boxFor(image), page = definition.pages[source.page];
  const images = definition.fields.filter(field => field.kind === "image" && boxFor(field).page === source.page);
  const distance = (a: PageBox, b: PageBox) => Math.hypot(
    (a.x + a.width/2 - b.x - b.width/2) * page.width,
    (a.y + a.height/2 - b.y - b.height/2) * page.height,
  );
  const fields: Partial<Record<BxLabel, TemplateField>> = {}, ambiguous: BxLabel[] = [];
  for (const label of labels) {
    const candidates = definition.fields.filter(field => {
      const box = boxFor(field);
      if (fieldBxLabel(field) !== label || box.page !== source.page) return false;
      const owners = images.map(item => ({id: item.id, distance: distance(box, boxFor(item))})).sort((a,b) => a.distance-b.distance);
      if (owners[0]?.id !== imageId) return false;
      return owners.length < 2 || owners[1].distance - owners[0].distance > 1;
    }).map(field => ({field, distance: distance(source, boxFor(field))})).sort((a,b) => a.distance-b.distance);
    if (candidates[0] && candidates[1] && candidates[1].distance-candidates[0].distance <= 1) ambiguous.push(label);
    else if (candidates[0]) fields[label] = candidates[0].field;
  }
  return { fields, ambiguous };
}
