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
import { bookStorageReceipt, readBlockPlaceOverview } from "../server/storage.mjs";

const tempRoot = mkdtempSync(path.join(tmpdir(), "hlogistik-block-places-"));
const warehouse = "SSI";
const otherWarehouse = "SI";

before(async () => {
  configure(path.join(tempRoot, "logistik.sqlite"));
  configureArticleDatabases(tempRoot);
  initializeDatabase();
  initializeArticleDatabases();
  await writeArticles([{
    id: "article-h1",
    materialnummer: "H1-TEST",
    materialbezeichnung: "H1 Testartikel",
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
    id: "article-h1-si",
    materialnummer: "H1-SI-TEST",
    materialbezeichnung: "H1 SI Testartikel",
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

test("SSI-Hallenpläne markieren nur positive Bestände als belegt", () => {
  bookStorageReceipt({
    materialnummer: "H1-TEST",
    lagerplatz: "H1-R6",
    leNummer: "HU-H1-1",
    mengeStueck: 12,
    paletten: 1,
    referenz: "Test",
  }, warehouse);
  bookStorageReceipt({
    materialnummer: "H1-TEST",
    lagerplatz: "H1AG1",
    leNummer: "HU-H1-2",
    mengeStueck: 6,
    paletten: 1,
    referenz: "Test",
  }, warehouse);
  bookStorageReceipt({
    materialnummer: "H1-SI-TEST",
    lagerplatz: "H1-R6",
    leNummer: "HU-H1-SI-1",
    mengeStueck: 9,
    paletten: 2,
    referenz: "Test",
  }, otherWarehouse);

  const overview = readBlockPlaceOverview({ warehouse });
  const places = overview.halls.flatMap((hall) => hall.groups.flatMap((group) => group.places));
  const r6 = places.find((place) => place.id === "022-H1-R6");
  const r7 = places.find((place) => place.id === "022-H1-R7");
  const h2r56 = places.find((place) => place.id === "022-H2-R56");
  const h3p1 = places.find((place) => place.id === "022-H3-P1");
  const h3r3 = places.find((place) => place.id === "022-H3-R3");
  const h3s3 = places.find((place) => place.id === "022-H3-S3");
  const h4r21 = places.find((place) => place.id === "022-H4-R21");
  const h5r50 = places.find((place) => place.id === "022-H5-R50");
  const h7r = places.find((place) => place.id === "022-H7-2R1");
  const h1ag1 = places.find((place) => place.id === "022-H1-AG1");

  assert.deepEqual(overview.halls.map((hall) => hall.id), ["H1", "H2", "H3", "H4", "H5", "H7"]);
  assert.deepEqual(overview.occupancyWarehouses, ["SSI", "SI"]);
  assert.deepEqual(overview.summary, { total: 190, occupied: 2, free: 188 });
  assert.deepEqual(r6, {
    id: "022-H1-R6",
    label: "R6",
    state: "occupied",
    stockRows: 2,
    articleCount: 2,
    materialNumbers: ["H1-SI-TEST", "H1-TEST"],
    pieces: 21,
    pallets: 3,
  });
  assert.equal(r7.state, "free");
  assert.equal(h2r56.state, "free");
  assert.equal(h3p1.state, "free");
  assert.equal(h3r3, undefined);
  assert.equal(h3s3, undefined);
  assert.equal(h4r21.state, "free");
  assert.equal(h5r50.state, "free");
  assert.equal(h7r.state, "free");
  assert.deepEqual(h1ag1, {
    id: "022-H1-AG1",
    label: "AG1",
    state: "occupied",
    stockRows: 1,
    articleCount: 1,
    materialNumbers: ["H1-TEST"],
    pieces: 6,
    pallets: 1,
  });
});

test("SI liefert keinen H1-Blockplan", () => {
  const overview = readBlockPlaceOverview({ warehouse: "SI" });

  assert.deepEqual(overview.summary, { total: 0, occupied: 0, free: 0 });
  assert.deepEqual(overview.halls, []);
});
