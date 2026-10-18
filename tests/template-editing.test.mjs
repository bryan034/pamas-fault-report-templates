import assert from "node:assert/strict";
import { test } from "node:test";
import {
  duplicateBox,
  selectionBoxes,
  moveBoxes,
  fieldsInPageOrder,
  firstEditableField,
  resizeBox,
  tickPath,
} from "../lib/template-editing.ts";
import { calculationProblems } from "../lib/template-calculations.ts";

const field = (id, x, y, page = 0) => ({
  id,
  label: id,
  kind: "number",
  page,
  x,
  y,
  width: 0.2,
  height: 0.05,
  role: null,
  alignment: "center",
});
const definition = {
  version: 1,
  pages: [{ width: 600, height: 800 }],
  fields: [field("n1", 0.1, 0.2), field("n2", 0.4, 0.2)],
  clear_areas: [],
  ocr_mappings: [],
  extractions: [],
};
test("initial field selection uses page position and skips images and calculations when editable fields exist", () => {
  const fields = [
    field("page2", 0.1, 0.1, 1),
    { ...field("photo", 0.1, 0.01), kind: "image" },
    { ...field("derived", 0.1, 0.02), kind: "calculated" },
    field("later", 0.1, 0.7),
    field("first", 0.1, 0.2),
  ];
  assert.equal(firstEditableField(fields).id, "first");
  assert.equal(firstEditableField(fields.slice(1, 3)).id, "photo");
  assert.equal(firstEditableField([]), undefined);
  assert.equal(fields[0].id, "page2");
});
test("copy/paste keeps styles and matching cover but gives them a new ID and removes role", () => {
  const source = {
    ...definition.fields[0],
    role: "company",
    font: "Helvetica",
    color: "#ff0000",
  };
  const copy = duplicateBox(
    definition,
    { kind: "field", box: source, cover: { ...source, color: "#ffffff" } },
    "new",
  );
  assert.equal(copy.fields[2].id, "new");
  assert.equal(copy.fields[2].role, null);
  assert.equal(copy.fields[2].color, "#ff0000");
  assert.equal(copy.clear_areas[0].id, "new");
  assert.equal(copy.clear_areas[0].x, copy.fields[2].x);
  const cover = duplicateBox(
    definition,
    { kind: "cover", box: { ...source, x: 0.8, width: 0.2 } },
    "cover",
    0.5,
  );
  assert.equal(cover.clear_areas[0].x, 0.8);
  assert.equal(definition.clear_areas.length, 0);
});
test("pasting an older uncovered text or image field creates an attached cover with exact geometry", () => {
  for (const kind of ["text", "image"]) {
    const source = {...definition.fields[0], kind};
    const copy = duplicateBox(definition, {kind: "field", box: source}, "pasted");
    const pasted = copy.fields.at(-1), cover = copy.clear_areas.at(-1);
    for (const key of ["id", "page", "x", "y", "width", "height"])
      assert.equal(cover[key], pasted[key]);
    assert.equal(cover.color, "#ffffff");
  }
});
test("selection deduplicates attached covers and group movement preserves spacing, colour and page bounds", () => {
  const schema = {...definition, clear_areas: [{...definition.fields[0], color: "#ffffff"}]};
  const boxes = selectionBoxes(schema, [
    {kind: "field", id: "n1"}, {kind: "cover", id: "n1"},
    {kind: "field", id: "n2"}, {kind: "field", id: "n2"}, {kind: "cover", id: "missing"},
  ]);
  assert.equal(boxes.length, 2);
  const moved = moveBoxes(schema, boxes, 1, -1);
  assert.ok(Math.abs(moved.fields[1].x + moved.fields[1].width - 1) < 1e-9);
  assert.ok(Math.abs(moved.fields[1].x - moved.fields[0].x - 0.3) < 1e-9);
  assert.equal(moved.fields[0].y, 0);
  assert.equal(moved.clear_areas[0].color, "#ffffff");
  assert.equal(moved.clear_areas[0].x, moved.fields[0].x);
  assert.equal(moved.clear_areas[0].y, moved.fields[0].y);
  assert.equal(schema.fields[0].x, 0.1);
  assert.equal(moveBoxes(schema, [], 1, 1), schema);
});
test("sidebar reading order uses page, vertical position, horizontal position and report overrides", () => {
  const fields = [
    field("later", 0.1, 0.7),
    field("right", 0.7, 0.2),
    field("left", 0.1, 0.2),
    field("page2", 0.1, 0.1, 1),
  ];
  assert.deepEqual(
    fieldsInPageOrder(fields, {}).map((f) => f.id),
    ["left", "right", "later", "page2"],
  );
  assert.equal(
    fieldsInPageOrder(fields, { later: { ...fields[0], y: 0.1 } })[0].id,
    "later",
  );
});
test("calculation errors name source fields and identify fields to highlight", () => {
  const calculated = {
    ...field("load", 0.1, 0.4),
    kind: "calculated",
    calculation: { operation: "percentage", fields: ["n1", "n2"] },
  };
  const schema = { ...definition, fields: [...definition.fields, calculated] };
  const issues = calculationProblems(schema, { n1: "30", n2: "0" });
  assert.match(issues[0].message, /load: n2 .* cannot be zero/);
  assert.deepEqual(issues[0].fieldIds, ["load", "n2"]);
  assert.deepEqual(calculationProblems(schema, { n1: "30", n2: "60" }), []);
  assert.deepEqual(calculationProblems(schema, {}), []);
  assert.match(
    calculationProblems(schema, { n1: "1e308", n2: "1e-308" })[0].message,
    /overflow/,
  );
  assert.match(
    calculationProblems({
      ...schema,
      fields: [
        {
          ...calculated,
          calculation: { operation: "sum", fields: ["missing", ""] },
        },
      ],
    })[0].message,
    /missing/,
  );
});
test("report resize remains within page boundaries and tick uses curved geometry", () => {
  const resized = resizeBox(field("n1", 0.1, 0.2), "nw", -0.9, -0.9);
  assert.equal(resized.x, 0);
  assert.equal(resized.y, 0);
  assert.ok(resized.width > 0);
  assert.match(tickPath, / C /);
  assert.match(tickPath, / Z$/);
});
