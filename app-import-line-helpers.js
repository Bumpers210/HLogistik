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

  function isLegacySiSystemBinSuccessNote(value) {
    return /^Von-Lagerplatz aus LE\/HU-System eindeutig erg(?:ae|\u00e4)nzt(?:\s*\([^)]*\)|\s*:\s*[^.]+)?\.?$/i
      .test(String(value || "").trim());
  }

  function stripLegacySiSystemBinSuccessNote(value) {
    var text = String(value || "").trim();
    if (!text) return "";
    var parts = text.split(" - ");
    if (!parts.some(isLegacySiSystemBinSuccessNote)) return text;
    return parts.filter(function (part) {
      return !isLegacySiSystemBinSuccessNote(part);
    }).join(" - ").trim();
  }

  function normalizeAutoPositionNotes(notes) {
    var source = notes && typeof notes === "object" ? notes : {};
    var sourceBinSystem = String(source.sourceBinSystem || "").trim();
    return {
      destination: String(source.destination || "").trim(),
      quantity: String(source.quantity || "").trim(),
      quantityCorrection: String(source.quantityCorrection || "").trim(),
      storagePallet: String(source.storagePallet || "").trim(),
      loadingSlip: String(source.loadingSlip || "").trim(),
      sourceBinSystem: isLegacySiSystemBinSuccessNote(sourceBinSystem) ? "" : sourceBinSystem,
      package: String(source.package || "").trim()
    };
  }

  function setAutoPositionNote(notes, key, value) {
    var next = normalizeAutoPositionNotes(notes);
    if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = String(value || "").trim();
    if (key === "sourceBinSystem" && isLegacySiSystemBinSuccessNote(next.sourceBinSystem)) next.sourceBinSystem = "";
    return next;
  }

  function autoPositionNoteValues(line) {
    var notes = normalizeAutoPositionNotes(line && line.autoPositionNotes);
    return [notes.destination, notes.quantity, notes.quantityCorrection, notes.storagePallet, notes.loadingSlip, notes.sourceBinSystem, notes.package]
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean);
  }

  function combinedPositionNote(line) {
    return combineUniqueNoteParts([manualPositionNoteFromInput(line && line.positionNote, line)].concat(autoPositionNoteValues(line)));
  }

  function manualPositionNoteFromInput(value, line) {
    var manual = stripLegacySiSystemBinSuccessNote(value);
    var automaticParts = uniqueNoteParts(autoPositionNoteValues(line));
    var automaticSequence = automaticParts.join(" - ");
    if (!manual || !automaticSequence) return manual;

    var previous = null;
    while (manual && manual !== previous) {
      previous = manual;
      if (manual === automaticSequence) {
        manual = "";
        continue;
      }
      if (manual.slice(-(automaticSequence.length + 3)) === ` - ${automaticSequence}`) {
        manual = manual.slice(0, -(automaticSequence.length + 3)).trim();
        continue;
      }
      if (manual.slice(0, automaticSequence.length + 3) === `${automaticSequence} - `) {
        manual = manual.slice(automaticSequence.length + 3).trim();
        continue;
      }
      for (var index = automaticParts.length - 1; index >= 0; index -= 1) {
        var automaticPart = automaticParts[index];
        if (manual === automaticPart) {
          manual = "";
          break;
        }
        if (manual.slice(-(automaticPart.length + 3)) === ` - ${automaticPart}`) {
          manual = manual.slice(0, -(automaticPart.length + 3)).trim();
          break;
        }
      }
    }
    return manual;
  }

  function combineUniqueNoteParts(parts) {
    return uniqueNoteParts(parts).join(" - ");
  }

  function uniqueNoteParts(parts) {
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
      });
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
    manualPositionNoteFromInput: manualPositionNoteFromInput,
    combinedPositionNote: combinedPositionNote,
    stripLegacySiSystemBinSuccessNote: stripLegacySiSystemBinSuccessNote
  };
})();
