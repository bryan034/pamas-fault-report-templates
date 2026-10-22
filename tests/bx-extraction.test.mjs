import assert from "node:assert/strict";
import {test} from "node:test";
import {extractBxReadings, mergeBxReadings, bxTextInReadingOrder, nearbyBxFields} from "../lib/bx-extraction.ts";

test("BX readings follow labels across arbitrary rows, spaces, case, decimals and negative values", () => {
  assert.deepEqual(extractBxReadings("Camera 2026\nbx 3: -4,5 °C\nBX1 42.6 C\nBx2\n38.1°C\nPalette 88°C"),
    {values: {BX1: "42.6", BX2: "38.1", BX3: "-4.5"}, ambiguous: []});
  assert.equal(extractBxReadings("BXl: 36.2°C").values.BX1, "36.2");
});
test("temperature decimals survive OCR spacing and retain trailing zeros", () => {
  assert.deepEqual(extractBxReadings("BX1 42 . 6°C\nBX2 38 , 0°C\nBX3 - 4 . 5°C"),
    {values:{BX1:"42.6",BX2:"38.0",BX3:"-4.5"},ambiguous:[]});
  assert.deepEqual(extractBxReadings("BX1 42.0°C\nBX2 38°C\nBX3 -4,0°C").values,
    {BX1:"42.0",BX2:"38.0",BX3:"-4.0"});
  assert.equal(extractBxReadings("BX1 426°C").values.BX1,"426.0");
  assert.equal(extractBxReadings("BX1 42.65°C").values.BX1,"42.65");
  assert.deepEqual(extractBxReadings("BX1 42.01°C\nBX1 42.04°C"),{values:{},ambiguous:["BX1"]});
  assert.deepEqual(extractBxReadings("BX1 42.0°C\nBX1 42°C"),{values:{BX1:"42.0"},ambiguous:[]});
});
test("missing and conflicting readings never borrow another label or a palette value", () => {
  assert.equal(extractBxReadings("BX1\nBX2 60°C").values.BX1, undefined);
  assert.equal(extractBxReadings("BX1 34.2\nPalette 88°C").values.BX1, "34.2");
  assert.deepEqual(extractBxReadings("BX1 Min 20°C Max 40°C"), {values: {}, ambiguous: ["BX1"]});
  assert.deepEqual(extractBxReadings("BX1 20°C\nBX1 40°C"), {values: {}, ambiguous: ["BX1"]});
  assert.deepEqual(mergeBxReadings([{values:{BX1:"20"},ambiguous:[]},{values:{BX1:"21",BX2:"30"},ambiguous:[]}]),
    {values:{BX2:"30"},ambiguous:["BX1"]});
  assert.deepEqual(extractBxReadings("BX10 50°C\nBX4 60°C\nSpot1 70°C"), {values:{},ambiguous:[]});
});
test("visual rows pair labels and readings even when OCR block ordering is scrambled", () => {
  const word = (text,x,y) => ({text,confidence:95,bbox:{x0:x,y0:y,x1:x+40,y1:y+20}});
  const text = bxTextInReadingOrder([word("42.6°C",140,15),word("38°C",140,60),word("BX2",10,61),word("BX1",10,14)]);
  assert.deepEqual(extractBxReadings(text).values, {BX1:"42.6",BX2:"38.0"});
});
const box = (id,label,kind,page,x,y) => ({id,label,kind,page,x,y,width:.1,height:.04});
const image = (id,page,x,y) => ({...box(id,"Photo","image",page,x,y),width:.3,height:.3});
test("repeated BX fields belong to their closest image on the same page, using report geometry", () => {
  const definition = {pages:[{width:600,height:800},{width:600,height:800}],fields:[
    image("left",0,.05,.1),image("right",0,.6,.1),
    box("left-bx1","BX1 temperature","number",0,.1,.43),box("right-bx1","BX1","number",0,.7,.43),
    box("other-page","BX1","number",1,.1,.43),box("calculation","BX2","calculated",0,.1,.5),
    box("difference","BX1 - BX2","number",0,.1,.6)]};
  assert.equal(nearbyBxFields(definition,"left").fields.BX1.id,"left-bx1");
  assert.equal(nearbyBxFields(definition,"right").fields.BX1.id,"right-bx1");
  assert.equal(nearbyBxFields(definition,"left").fields.BX2,undefined);
  const moved={"left-bx1":{...definition.fields[2],page:1}};
  assert.equal(nearbyBxFields(definition,"left",moved).fields.BX1,undefined);
});
test("equidistant BX fields are flagged instead of filling two unrelated boxes", () => {
  const definition={pages:[{width:600,height:800}],fields:[image("photo",0,.3,.1),
    box("a","BX1","text",0,.35,.43),box("b","BX1","text",0,.45,.43)]};
  assert.deepEqual(nearbyBxFields(definition,"photo").ambiguous,["BX1"]);
});
