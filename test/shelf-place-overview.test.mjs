import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  configure,
  configureArticleDatabases,
  getArticleDb,
  getDb,
  initializeArticleDatabases,
  initializeDatabase,
} from "../server/db.mjs";
import { writeArticles } from "../server/articles.mjs";
import { bookStorageReceipt, readShelfPlaceOverview } from "../server/storage.mjs";
import { shelfPlacePlanForWarehouse } from "../server/rules/hall-plan-rules.mjs";

const tempRoot = mkdtempSync(path.join(tmpdir(), "hlogistik-shelf-places-"));
const warehouse = "SSI";
const otherWarehouse = "SI";

before(async () => {
  configure(path.join(tempRoot, "logistik.sqlite"));
  configureArticleDatabases(tempRoot);
  initializeDatabase();
  initializeArticleDatabases();
  await writeArticles([{
    id: "article-h1-shelf",
    materialnummer: "H1-SHELF-TEST",
    materialbezeichnung: "H1 Regal Testartikel",
    gebindeArt: "STK",
    mengeProKarton: 0,
    mengeProPalette: 1,
    barcode: "",
    lagerplatz: "",
    artikelgruppe: "",
    bemerkung: "",
    aktiv: true,
    erstelltAm: new Date().toISOString(),
    geaendertAm: new Date().toISOString(),
  }], warehouse);
  await writeArticles([{
    id: "article-h1-shelf-si",
    materialnummer: "H1-SHELF-SI",
    materialbezeichnung: "H1 Regal SI Testartikel",
    gebindeArt: "STK",
    mengeProKarton: 0,
    mengeProPalette: 1,
    barcode: "",
    lagerplatz: "",
    artikelgruppe: "",
    bemerkung: "",
    aktiv: true,
    erstelltAm: new Date().toISOString(),
    geaendertAm: new Date().toISOString(),
  }], otherWarehouse);
});

after(() => {
  getDb().close();
  getArticleDb("SSI").close();
  getArticleDb("SI").close();
  rmSync(tempRoot, { recursive: true, force: true });
});

test("H1-Regalplan erzeugt 546 Plaetze je Ebene mit kanonischen IDs", () => {
  const plan = shelfPlacePlanForWarehouse("SSI", "H1", "A");
  const places = plan.rows.flatMap((row) => row.places);

  assert.equal(plan.rows.length, 20);
  assert.equal(places.length, 546);
  assert.deepEqual(places[0], {
    id: "002-H1-SAA1A1",
    label: "AA1A1",
    bay: "AA1",
    position: 1,
  });
  assert.equal(places.at(-1).id, "002-H1-SAT10A3");
  assert.equal(shelfPlacePlanForWarehouse("SI", "H1", "A"), null);
  assert.equal(shelfPlacePlanForWarehouse("SSI", "H1", "E"), null);
});

test("positive H1-Regalbestaende belegen nur die passende Ebene und werden summiert", () => {
  bookStorageReceipt({
    materialnummer: "H1-SHELF-TEST",
    lagerplatz: "AA1A1",
    leNummer: "HU-SHELF-1",
    mengeStueck: 4,
    paletten: 1,
    referenz: "Test",
  }, warehouse);
  bookStorageReceipt({
    materialnummer: "H1-SHELF-TEST",
    lagerplatz: "002-H1-SAA1A1",
    leNummer: "HU-SHELF-2",
    mengeStueck: 6,
    paletten: 2,
    referenz: "Test",
  }, warehouse);
  bookStorageReceipt({
    materialnummer: "H1-SHELF-TEST",
    lagerplatz: "AT10D3",
    leNummer: "HU-SHELF-3",
    mengeStueck: 3,
    paletten: 1,
    referenz: "Test",
  }, warehouse);
  bookStorageReceipt({
    materialnummer: "H1-SHELF-SI",
    lagerplatz: "AA1A1",
    leNummer: "HU-SHELF-SI-1",
    mengeStueck: 5,
    paletten: 1,
    referenz: "Test",
  }, otherWarehouse);

  const levelA = readShelfPlaceOverview({ warehouse, hall: "H1", level: "A" });
  const aa1a1 = levelA.rows.flatMap((row) => row.places).find((place) => place.id === "002-H1-SAA1A1");
  const at10a3 = levelA.rows.flatMap((row) => row.places).find((place) => place.id === "002-H1-SAT10A3");

  assert.deepEqual(levelA.summary, { total: 546, occupied: 1, free: 545 });
  assert.deepEqual(levelA.occupancyWarehouses, ["SSI", "SI"]);
  assert.deepEqual(aa1a1, {
    id: "002-H1-SAA1A1",
    label: "AA1A1",
    bay: "AA1",
    position: 1,
    state: "occupied",
    stockRows: 3,
    articleCount: 2,
    materialNumbers: ["H1-SHELF-SI", "H1-SHELF-TEST"],
    pieces: 15,
    pallets: 4,
  });
  assert.equal(at10a3.state, "free");

  const levelD = readShelfPlaceOverview({ warehouse, hall: "H1", level: "D" });
  const at10d3 = levelD.rows.flatMap((row) => row.places).find((place) => place.id === "002-H1-SAT10D3");
  assert.deepEqual(levelD.summary, { total: 546, occupied: 1, free: 545 });
  assert.equal(at10d3.state, "occupied");

  const siOverview = readShelfPlaceOverview({ warehouse: "SI", hall: "H1", level: "A" });
  assert.deepEqual(siOverview.summary, { total: 0, occupied: 0, free: 0 });
  assert.deepEqual(siOverview.rows, []);
});
