import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../offline-store.js", import.meta.url), "utf8");

function cacheApi() {
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  const context = vm.createContext({ window: { localStorage }, JSON, Date, Array, String, Number, Math, Error, Promise });
  vm.runInContext(source, context, { filename: "offline-store.js" });
  return { cache: context.window.OfflineStore, values };
}

test("Hallenplan-Cache speichert Lager getrennt und ignoriert unvollständige Werte", () => {
  const { cache, values } = cacheApi();
  const ssiOverview = { warehouse: "SSI", summary: { total: 15, free: 14, occupied: 1 }, halls: [{ id: "H1" }] };
  const siOverview = { warehouse: "SI", summary: { total: 0, free: 0, occupied: 0 }, halls: [] };

  cache.saveHallPlanCache("SSI", ssiOverview);
  cache.saveHallPlanCache("SI", siOverview);

  assert.equal(cache.loadHallPlanCache("SSI").overview.summary.occupied, 1);
  assert.equal(cache.loadHallPlanCache("SI").overview.summary.total, 0);

  values.set("hlogistik-hall-plan-v1-SSI", JSON.stringify({ warehouse: "SSI", overview: { halls: [] } }));
  assert.equal(cache.loadHallPlanCache("SSI"), null);
});

test("Regalplan-Cache trennt Ebenen und verwirft unvollstaendige Werte", () => {
  const { cache, values } = cacheApi();
  const levelA = { warehouse: "SSI", hall: { id: "H1" }, level: "A", summary: { total: 546, free: 545, occupied: 1 }, rows: [{ id: "AA" }] };
  const levelB = { warehouse: "SSI", hall: { id: "H1" }, level: "B", summary: { total: 546, free: 546, occupied: 0 }, rows: [{ id: "AA" }] };

  cache.saveShelfPlanCache("SSI", "H1", "A", levelA);
  cache.saveShelfPlanCache("SSI", "H1", "B", levelB);

  assert.equal(cache.loadShelfPlanCache("SSI", "H1", "A").overview.summary.occupied, 1);
  assert.equal(cache.loadShelfPlanCache("SSI", "H1", "B").overview.summary.free, 546);

  values.set("hlogistik-shelf-plan-v1-SSI-H1-C", JSON.stringify({ warehouse: "SSI", hall: "H1", level: "C", overview: { rows: [] } }));
  assert.equal(cache.loadShelfPlanCache("SSI", "H1", "C"), null);
});
