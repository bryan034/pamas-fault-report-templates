import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyReport, calculateValues, templateDefaults } from "../lib/template-api.ts";
import { nextReportField } from "../lib/template-editing.ts";

const fields = [
  { id: "second", kind: "number", page: 0, x: 0.5, y: 0.1, default_value: "20" },
  { id: "first", kind: "text", page: 0, x: 0.1, y: 0.1, default_value: "First\nSecond" },
  { id: "photo", kind: "image", page: 0, x: 0.2, y: 0.1 },
  { id: "total", kind: "calculated", page: 0, x: 0.3, y: 0.1, calculation: { operation: "sum", fields: ["second", "third"] } },
  { id: "third", kind: "number", page: 1, x: 0.1, y: 0.1, default_value: "5" },
];

test("report defaults are explicit, independent objects, not detected samples", () => {
  const definition = { fields };
  assert.deepEqual(templateDefaults(definition), { first: "First\nSecond", second: "20", third: "5" });
  const one = emptyReport(definition), two = emptyReport(definition);
  one.values.first = "Changed";
  assert.equal(two.values.first, "First\nSecond");
  assert.deepEqual(templateDefaults({ fields: [{ id: "sample", kind: "text", suggested_value: "Not a default" }] }), {});
  assert.equal(calculateValues(definition, {}).total, "25");
  assert.equal(calculateValues(definition, { second: "" }).total, "");
});
test("Enter advances in visual order, skips images/calculations and stops at the last field", () => {
  assert.equal(nextReportField(fields, {}, "report_title").id, "first");
  assert.equal(nextReportField(fields, {}, "first").id, "second");
  assert.equal(nextReportField(fields, {}, "second").id, "third");
  assert.equal(nextReportField(fields, {}, "third"), undefined);
  assert.equal(nextReportField(fields, {}, "unknown"), undefined);
  assert.equal(nextReportField(fields, { second: { page: 0, x: 0.05, y: 0.01 } }, "report_title").id, "second");
});
