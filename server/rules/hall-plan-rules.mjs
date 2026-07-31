const SSI_BLOCK_PLACE_HALLS = Object.freeze([
  {
    id: "H1",
    label: "Halle 1",
    groups: [
      { id: "h1-r1-r5", label: "R1 bis R5", start: 1, end: 5 },
      { id: "h1-r6-r16", label: "R6 bis R16", start: 6, end: 16 },
      { id: "h1-ag1-am1", label: "AG1 bis AM1", placeLabels: ["AG1", "AH1", "AI1", "AJ1", "AK1", "AL1", "AM1"] },
    ],
  },
  {
    id: "H2",
    label: "Halle 2",
    groups: [
      { id: "h2-r1-r56", label: "R1 bis R56", start: 1, end: 56 },
    ],
  },
  {
    id: "H3",
    label: "Halle 3",
    groups: [
      { id: "h3-p1-y3", label: "P1 bis Y3 (ohne R3 und S3)", placeLabels: hallThreePlaceLabels() },
    ],
  },
  {
    id: "H4",
    label: "Halle 4",
    groups: [
      { id: "h4-r1-r21", label: "R1 bis R21", start: 1, end: 21 },
    ],
  },
  {
    id: "H5",
    label: "Halle 5",
    groups: [
      { id: "h5-r1-r50", label: "R1 bis R50", start: 1, end: 50 },
    ],
  },
  {
    id: "H7",
    label: "Halle 7",
    groups: [
      { id: "h7-2r1-5r3", label: "2R1 bis 5R3", placeLabels: hallSevenPlaceLabels() },
    ],
  },
]);

const H1_SHELF_ROWS = Object.freeze([
  { id: "AA", start: 1, end: 10 },
  { id: "AB", start: 1, end: 9 },
  { id: "AC", start: 1, end: 9 },
  { id: "AD", start: 1, end: 9 },
  { id: "AE", start: 1, end: 9 },
  { id: "AF", start: 1, end: 9 },
  { id: "AG", start: 1, end: 9 },
  { id: "AH", start: 1, end: 9 },
  { id: "AI", start: 1, end: 9 },
  { id: "AJ", start: 1, end: 9 },
  { id: "AK", start: 1, end: 9 },
  { id: "AL", start: 1, end: 9 },
  { id: "AM", start: 1, end: 9 },
  { id: "AN", start: 1, end: 9 },
  { id: "AO", start: 1, end: 9 },
  { id: "AP", start: 1, end: 9 },
  { id: "AQ", start: 1, end: 9 },
  { id: "AR", start: 1, end: 9 },
  { id: "AS", start: 1, end: 9 },
  { id: "AT", start: 1, end: 10 },
]);

const H1_SHELF_LEVELS = new Set(["A", "B", "C", "D"]);

export function blockPlacePlanForWarehouse(warehouse) {
  if (warehouse !== "SSI") return [];

  return SSI_BLOCK_PLACE_HALLS.map((hall) => ({
    id: hall.id,
    label: hall.label,
    groups: hall.groups.map((group) => ({
      id: group.id,
      label: group.label,
      places: blockPlacesForGroup(hall.id, group),
    })),
  }));
}

export function shelfPlacePlanForWarehouse(warehouse, hallId = "H1", level = "A") {
  const normalizedHallId = String(hallId || "").trim().toUpperCase();
  const normalizedLevel = String(level || "").trim().toUpperCase();
  if (warehouse !== "SSI" || normalizedHallId !== "H1" || !H1_SHELF_LEVELS.has(normalizedLevel)) return null;

  return {
    id: "H1",
    label: "Halle 1",
    level: normalizedLevel,
    rows: H1_SHELF_ROWS.map((row) => ({
      ...row,
      label: `${row.id}${row.start} bis ${row.id}${row.end}`,
      places: shelfPlacesForRow(row, normalizedLevel),
    })),
  };
}

function blockPlacesForGroup(hallId, group) {
  if (Array.isArray(group.placeLabels)) {
    return group.placeLabels.map((label) => ({
      id: `022-${hallId}-${label}`,
      label,
    }));
  }

  const places = [];
  for (let number = group.start; number <= group.end; number += 1) {
    places.push({
      id: `022-${hallId}-R${number}`,
      label: `R${number}`,
    });
  }
  return places;
}

function hallThreePlaceLabels() {
  const labels = [];
  for (let row = "P"; row <= "Y"; row = String.fromCharCode(row.charCodeAt(0) + 1)) {
    for (let position = 1; position <= 3; position += 1) {
      const label = `${row}${position}`;
      if (label !== "R3" && label !== "S3") labels.push(label);
    }
  }
  return labels;
}

function hallSevenPlaceLabels() {
  const labels = [];
  for (let row = 2; row <= 5; row += 1) {
    for (let position = 1; position <= 3; position += 1) labels.push(`${row}R${position}`);
  }
  return labels;
}

function shelfPlacesForRow(row, level) {
  const places = [];
  for (let bay = row.start; bay <= row.end; bay += 1) {
    for (let position = 1; position <= 3; position += 1) {
      const label = `${row.id}${bay}${level}${position}`;
      places.push({
        id: `002-H1-S${label}`,
        label,
        bay: `${row.id}${bay}`,
        position,
      });
    }
  }
  return places;
}
