(function (global) {
  "use strict";

  var COLUMN_DEFINITIONS = Object.freeze([
    { key: "warehouseOrder", required: false, aliases: ["lageraufgabe", "lagerauftrag", "position", "pos"] },
    { key: "fromHandlingUnit", required: false, aliases: ["vonhu", "vonhandlingunit", "hu", "le"] },
    { key: "fromBin", required: true, aliases: ["vonlagerplatz", "quelllagerplatz", "lagerplatzvon", "vonplatz"] },
    { key: "product", required: true, aliases: ["produkt", "material", "materialnummer", "artikel", "artikelnummer"] },
    { key: "description", required: false, aliases: ["produktbeschreibung", "materialbezeichnung", "artikelbezeichnung", "beschreibung"] },
    { key: "targetQty", required: true, aliases: ["vonzielmengebme", "vonzielmenge", "zielmenge", "menge", "sollmenge", "bedarf"] },
    { key: "unit", required: false, aliases: ["basismengeneinheit", "mengeneinheit", "einheit", "me"] },
    { key: "toBin", required: true, aliases: ["nachlagerplatz", "ziellagerplatz", "lagerplatznach", "nachplatz"] }
  ]);

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeHeader(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function columnForToken(token) {
    var normalized = normalizeHeader(token);
    return COLUMN_DEFINITIONS.find(function (definition) {
      return definition.aliases.indexOf(normalized) >= 0;
    });
  }

  function mappingForHeader(row) {
    var mapping = {};
    var labels = {};
    (Array.isArray(row) ? row : []).forEach(function (cell, index) {
      var definition = columnForToken(cell);
      if (!definition || mapping[definition.key] != null) return;
      mapping[definition.key] = index;
      labels[definition.key] = text(cell);
    });
    return { mapping: mapping, labels: labels };
  }

  function missingRequiredColumns(mapping) {
    return COLUMN_DEFINITIONS
      .filter(function (definition) { return definition.required && mapping[definition.key] == null; })
      .map(function (definition) { return definition.key; });
  }

  function findHeader(rows) {
    var best = { index: -1, mapping: {}, labels: {}, score: -1, missingRequired: [] };
    (Array.isArray(rows) ? rows.slice(0, 50) : []).forEach(function (row, index) {
      var candidate = mappingForHeader(row);
      var score = Object.keys(candidate.mapping).length;
      var missingRequired = missingRequiredColumns(candidate.mapping);
      if (score > best.score) {
        best = { index: index, mapping: candidate.mapping, labels: candidate.labels, score: score, missingRequired: missingRequired };
      }
      if (!missingRequired.length && score >= 4 && best.missingRequired.length) {
        best = { index: index, mapping: candidate.mapping, labels: candidate.labels, score: score, missingRequired: [] };
      }
    });
    return best;
  }

  function rowsForSheet(sheet) {
    if (!global.XLSX || !global.XLSX.utils || !sheet) return [];
    return global.XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: true
    });
  }

  function selectSheet(workbook) {
    var names = Array.isArray(workbook && workbook.SheetNames) ? workbook.SheetNames : [];
    var preferred = names.find(function (name) { return normalizeHeader(name) === "data"; });
    if (preferred) return { name: preferred, sheet: workbook.Sheets[preferred], rows: rowsForSheet(workbook.Sheets[preferred]) };
    for (var index = 0; index < names.length; index += 1) {
      var name = names[index];
      var rows = rowsForSheet(workbook.Sheets[name]);
      if (rows.some(function (row) { return row.some(function (cell) { return text(cell); }); })) {
        return { name: name, sheet: workbook.Sheets[name], rows: rows };
      }
    }
    return { name: names[0] || "", sheet: names[0] ? workbook.Sheets[names[0]] : null, rows: [] };
  }

  function valueAt(row, mapping, key) {
    return text(rawValueAt(row, mapping, key));
  }

  function rawValueAt(row, mapping, key) {
    return mapping[key] == null ? "" : row[mapping[key]];
  }

  function isEmptyRow(row) {
    return !(Array.isArray(row) ? row : []).some(function (cell) { return text(cell); });
  }

  function isSummaryRow(row) {
    var joined = (Array.isArray(row) ? row : []).map(text).filter(Boolean).join(" ");
    return /^(summe|gesamt|pruef(?:ung|zeile)?|kontrolle|total|ende)\b/i.test(joined)
      || /\b(summe|gesamt|pruefzeile)\s*:?\s*$/i.test(joined);
  }

  function quantityValue(value) {
    var numericValue = numericCellValue(value);
    if (Number.isFinite(numericValue)) return numericValue > 0 ? numericValue : NaN;
    var parsed = global.HLogistikQuantityFormat && global.HLogistikQuantityFormat.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  }

  function numericCellValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object" && typeof value.result === "number" && Number.isFinite(value.result)) {
      return value.result;
    }
    return NaN;
  }

  function rawQuantitySource(value, parsed) {
    if (typeof value !== "string") return "";
    var raw = text(value);
    return /[xX×]/.test(raw) && Number.isFinite(parsed) ? raw : "";
  }

  function previewRows(rows, header) {
    var validRows = [];
    var ignoredRows = [];
    var hardErrors = [];
    var dataRows = Array.isArray(rows) ? rows.slice(header.index + 1) : [];

    dataRows.forEach(function (row, offset) {
      var rowNumber = header.index + offset + 2;
      if (isEmptyRow(row)) {
        ignoredRows.push({ rowNumber: rowNumber, reason: "leer" });
        return;
      }
      if (isSummaryRow(row)) {
        ignoredRows.push({ rowNumber: rowNumber, reason: "Summen-/Pruefzeile" });
        return;
      }
      if (header.mapping.warehouseOrder != null && !valueAt(row, header.mapping, "warehouseOrder")) {
        ignoredRows.push({ rowNumber: rowNumber, reason: "Pruef-/Summenzeile ohne Lageraufgabe" });
        return;
      }

      var fromBin = valueAt(row, header.mapping, "fromBin");
      var product = valueAt(row, header.mapping, "product");
      var rawQuantity = rawValueAt(row, header.mapping, "targetQty");
      var toBin = valueAt(row, header.mapping, "toBin");
      var quantity = quantityValue(rawQuantity);
      var rowErrors = [];
      if (!fromBin) rowErrors.push("Von-Lagerplatz fehlt");
      if (!product) rowErrors.push("Produkt fehlt");
      if (!Number.isFinite(quantity)) rowErrors.push("Von-Zielmenge ist ungueltig");
      if (!toBin) rowErrors.push("Nach-Lagerplatz fehlt");
      if (rowErrors.length) {
        hardErrors.push({ rowNumber: rowNumber, errors: rowErrors });
        return;
      }

      validRows.push({
        sourceRow: rowNumber,
        warehouseOrder: valueAt(row, header.mapping, "warehouseOrder") || String(validRows.length + 1),
        fromHandlingUnit: valueAt(row, header.mapping, "fromHandlingUnit"),
        fromHandlingUnitEditable: !valueAt(row, header.mapping, "fromHandlingUnit"),
        fromBin: fromBin,
        product: product,
        description: valueAt(row, header.mapping, "description"),
        targetQty: String(quantity),
        actualQty: String(quantity),
        quantitySourceText: rawQuantitySource(rawQuantity, quantity),
        unit: valueAt(row, header.mapping, "unit") || "Stk",
        toBin: toBin,
        picked: false
      });
    });

    return {
      lines: validRows,
      ignoredRows: ignoredRows,
      hardErrors: hardErrors,
      inputRowCount: dataRows.length,
      accountedRowCount: validRows.length + ignoredRows.length + hardErrors.length
    };
  }

  function previewWorkbook(workbook) {
    var selected = selectSheet(workbook);
    var header = findHeader(selected.rows);
    var missing = header.index < 0 ? missingRequiredColumns({}) : header.missingRequired;
    if (missing.length) {
      return {
        ok: false,
        sheetName: selected.name,
        headerRow: header.index + 1,
        mapping: header.labels,
        lines: [],
        ignoredRows: [],
        hardErrors: [{ rowNumber: header.index + 1, errors: ["Pflichtspalten fehlen: " + missing.join(", ")] }],
        inputRowCount: 0,
        accountedRowCount: 0
      };
    }
    var preview = previewRows(selected.rows, header);
    return Object.assign({
      ok: preview.hardErrors.length === 0 && preview.lines.length > 0,
      sheetName: selected.name,
      headerRow: header.index + 1,
      mapping: header.labels
    }, preview);
  }

  global.HLogistikPickingXlsxImport = Object.freeze({
    COLUMN_DEFINITIONS: COLUMN_DEFINITIONS,
    normalizeHeader: normalizeHeader,
    findHeader: findHeader,
    rowsForSheet: rowsForSheet,
    selectSheet: selectSheet,
    previewRows: previewRows,
    previewWorkbook: previewWorkbook
  });
})(window);
