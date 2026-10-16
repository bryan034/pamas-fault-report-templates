import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/create-id.ts";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("HTTPS/localhost uses native randomUUID with the correct receiver", () => {
  const cryptoApi = {
    randomUUID() {
      assert.equal(this, cryptoApi);
      return "b2a6650a-62c7-4452-8abc-845eff4a0081";
    },
    getRandomValues() { throw new Error("Native UUID should take priority"); },
  };
  assert.equal(createId(cryptoApi), "b2a6650a-62c7-4452-8abc-845eff4a0081");
});

test("HTTP LAN fallback sets version/variant bits and preserves byte padding", () => {
  for (const [byte, expected] of [
    [0, "00000000-0000-4000-8000-000000000000"],
    [255, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
  ]) {
    const cryptoApi = {
      getRandomValues(bytes) {
        assert.equal(this, cryptoApi);
        assert.equal(bytes.byteLength, 16);
        bytes.fill(byte);
        return bytes;
      },
    };
    assert.equal(createId(cryptoApi), expected);
  }
});

test("missing randomUUID still produces distinct valid UUIDs using Web Crypto", () => {
  const fallback = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const ids = Array.from({ length: 1000 }, () => createId(fallback));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, uuidV4);
});

test("both paths produce the same UUID v4 shape", () => {
  assert.match(createId(), uuidV4);
  assert.match(createId({ randomUUID: undefined, getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }), uuidV4);
});

test("unsupported browsers fail clearly instead of using weak randomness", () => {
  assert.throws(() => createId({}), /cannot generate secure IDs/);
  assert.throws(() => createId(null), /cannot generate secure IDs/);
});
