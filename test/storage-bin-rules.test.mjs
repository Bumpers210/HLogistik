import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSsiStorageBin } from "../server/rules/storage-bin-rules.mjs";

test("SSI-Hallenbereiche normalisieren auf kanonische 022-IDs", () => {
  assert.equal(normalizeSsiStorageBin("H1R16"), "022-H1-R16");
  assert.equal(normalizeSsiStorageBin("002-H1-SAG1"), "022-H1-AG1");
  assert.equal(normalizeSsiStorageBin("H2R56"), "022-H2-R56");
  assert.equal(normalizeSsiStorageBin("H3P1"), "022-H3-P1");
  assert.equal(normalizeSsiStorageBin("002-H3-T1"), "022-H3-T1");
  assert.equal(normalizeSsiStorageBin("H4R21"), "022-H4-R21");
  assert.equal(normalizeSsiStorageBin("H5R50"), "022-H5-R50");
  assert.equal(normalizeSsiStorageBin("002-H7-S2R1"), "022-H7-2R1");
  assert.equal(normalizeSsiStorageBin("H75R3"), "022-H7-5R3");
});

test("SSI-Hallenbereiche lehnen Werte außerhalb der freigegebenen Grenzen ab", () => {
  assert.equal(normalizeSsiStorageBin("H1R17"), null);
  assert.equal(normalizeSsiStorageBin("H1AF1"), null);
  assert.equal(normalizeSsiStorageBin("H2R57"), null);
  assert.equal(normalizeSsiStorageBin("H3O1"), null);
  assert.equal(normalizeSsiStorageBin("022-H3-R3"), null);
  assert.equal(normalizeSsiStorageBin("022-H3-S3"), null);
  assert.equal(normalizeSsiStorageBin("H4R22"), null);
  assert.equal(normalizeSsiStorageBin("H5R51"), null);
  assert.equal(normalizeSsiStorageBin("H76R1"), null);
});

test("SSI-Halle-2-Codes akzeptieren S#### und vier Ziffern", () => {
  assert.equal(normalizeSsiStorageBin("S0074"), "002-H2-S0074");
  assert.equal(normalizeSsiStorageBin("0074"), "002-H2-S0074");
  assert.equal(normalizeSsiStorageBin("S1234"), "002-H2-S1234");
  assert.equal(normalizeSsiStorageBin("1234"), "002-H2-S1234");
});

test("SSI-Kurznummern bleiben Halle 7 vorbehalten", () => {
  assert.equal(normalizeSsiStorageBin("74"), null);
  assert.equal(normalizeSsiStorageBin("12"), "002-H7-S12");
});
