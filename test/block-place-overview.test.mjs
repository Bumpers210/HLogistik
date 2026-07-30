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
    lagerplatz: "H1-AG1",
    leNummer: "HU-H1-2",
    mengeStueck: 6,
    paletten: 1,
    referenz: "Test",
  }, warehouse);

  const overview = readBlockPlaceOverview({ warehouse });
  const places = overview.halls.flatMap((hall) => hall.groups.flatMap((group) => group.places));
  const r6 = places.find((place) => place.id === "022-H1-R6");
  const r7 = places.find((place) => place.id === "022-H1-R7");
  const h2r56 = places.find((place) => place.id === "022-H2-R56");
  const h5r48 = places.find((place) => place.id === "022-H5-R48");
  const h1ag1 = places.find((place) => place.id === "002-H1-SAG1");

  assert.deepEqual(overview.halls.map((hall) => hall.id), ["H1", "H2", "H5"]);
  assert.deepEqual(overview.summary, { total: 126, occupied: 2, free: 124 });
  assert.deepEqual(r6, {
    id: "022-H1-R6",
    label: "R6",
    state: "occupied",
    stockRows: 1,
    articleCount: 1,
    materialNumbers: ["H1-TEST"],
    pieces: 12,
    pallets: 1,
  });
  assert.equal(r7.state, "free");
  assert.equal(h2r56.state, "free");
  assert.equal(h5r48.state, "free");
  assert.deepEqual(h1ag1, {
    id: "002-H1-SAG1",
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
