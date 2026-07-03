(function () {
  function normalizeQuantity(value) {
    var normalized = String(value || "").replace(",", ".");
    if (/^\d{1,3}\.\d{3}$/.test(normalized)) return normalized.replace(".", "");
    return normalized;
  }

  function normalizeUnit(unit) {
    var value = unit.toLowerCase();
    if (["st", "si", "s1", "5t", "stk", "st\u00fcck"].indexOf(value) >= 0) return "Stk";
    if (["pck", "pak"].indexOf(value) >= 0) return "Pck";
    if (value === "ve") return "VE";
    return unit;
  }

  function isUnitToken(value) {
    return /^(?:ST|SI|S1|5T|STK|ST\u00c3\u00bcCK|PCK|PAK|VE|KG|G|M|L|PAL)$/i.test(String(value || ""));
  }

  function parseImportQuantityValue(value) {
    var normalized = normalizeQuantity(String(value || "").replace(",", "."));
    var multiplier = normalized.match(/^(\d+)x(\d+(?:\.\d+)?)$/i);
    if (multiplier) return Number(multiplier[1]) * Number(multiplier[2]);
    return Number(normalized);
  }

  function readPositiveQuantity(value) {
    var number = Number(String(value || "").replace(/\./g, "").replace(",", "."));
    return Number.isFinite(number) && number > 0;
  }

  function normalizeAutoPositionNotes(notes) {
    var source = notes && typeof notes === "object" ? notes : {};
    return {
      destination: String(source.destination || "").trim(),
      quantity: String(source.quantity || "").trim(),
      quantityCorrection: String(source.quantityCorrection || "").trim(),
      storagePallet: String(source.storagePallet || "").trim(),
      loadingSlip: String(source.loadingSlip || "").trim()
    };
  }

  function setAutoPositionNote(notes, key, value) {
    var next = normalizeAutoPositionNotes(notes);
    if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = String(value || "").trim();
    return next;
  }

  function autoPositionNoteValues(line) {
    var notes = normalizeAutoPositionNotes(line && line.autoPositionNotes);
    return [notes.destination, notes.quantity, notes.quantityCorrection, notes.storagePallet, notes.loadingSlip]
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean);
  }

  function combinedPositionNote(line) {
    return combineUniqueNoteParts([line && line.positionNote].concat(autoPositionNoteValues(line)));
  }

  function combineUniqueNoteParts(parts) {
    var seen = new Set();
    return parts
      .map(function (part) {
        return String(part || "").trim();
      })
      .filter(Boolean)
      .filter(function (part) {
        var key = part.toUpperCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join("; ");
  }

  window.HLogistikImportLineHelpers = {
    normalizeQuantity: normalizeQuantity,
    normalizeUnit: normalizeUnit,
    isUnitToken: isUnitToken,
    parseImportQuantityValue: parseImportQuantityValue,
    readPositiveQuantity: readPositiveQuantity,
    combineUniqueNoteParts: combineUniqueNoteParts,
    normalizeAutoPositionNotes: normalizeAutoPositionNotes,
    autoPositionNoteValues: autoPositionNoteValues,
    setAutoPositionNote: setAutoPositionNote,
    combinedPositionNote: combinedPositionNote
  };
})();
