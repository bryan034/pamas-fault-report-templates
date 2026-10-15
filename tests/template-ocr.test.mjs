import assert from "node:assert/strict";
import { test } from "node:test";
import { extractQuotedReading } from "../lib/template-ocr.ts";

test("extracts any quoted photo label and selected measurement", () => {
  const text = "Bx1 Max 66.1 °C Min 24.3 °C\nBx2 Max 53.0 °C\nSp3: -4,5 °C";
  assert.equal(extractQuotedReading(text, "Bx1", "Max"), 66.1);
  assert.equal(extractQuotedReading(text, "Bx1", "Min"), 24.3);
  assert.equal(extractQuotedReading(text, "Bx2", "Max"), 53);
  assert.equal(extractQuotedReading(text, "Sp3"), -4.5);
});
test("does not match longer labels, missing qualifiers, or a distant reading", () => {
  assert.equal(extractQuotedReading("Bx10: 60", "Bx1"), null);
  assert.equal(extractQuotedReading("Bx1 Min 20", "Bx1", "Max"), null);
  assert.equal(extractQuotedReading("Bx1\nBx2 Max 60", "Bx1"), null);
});
test("flags conflicting repeated readings instead of silently choosing one", () => {
  assert.equal(extractQuotedReading("Sp1: 30\nSp1: 80", "Sp1"), null);
});
test("literal labels may contain punctuation and OCR whitespace", () => {
  assert.equal(extractQuotedReading("Spot (1): 12.3", "Spot (1)"), 12.3);
  assert.equal(extractQuotedReading("Box  A Max 40", "Box A", "Max"), 40);
});
