(function () {
  function dependency(dependencies, name, fallback) {
    return dependencies && typeof dependencies[name] === "function" ? dependencies[name] : fallback;
  }

  function appendLoadingSlipLines(lines, loadingSlipLines) {
    if (!Array.isArray(lines)) return lines;
    var additions = (Array.isArray(loadingSlipLines) ? loadingSlipLines : [])
      .filter(function (line) {
        return line && line.lineType === "loading-slip" && String(line.barcode || "").trim();
      });
    if (!additions.length) return lines;

    var result = lines.slice();
    var seen = new Set(result
      .filter(function (line) {
        return line && line.lineType === "loading-slip" && String(line.barcode || "").trim();
      })
      .map(loadingSlipLineKey));
    additions.forEach(function (loadingSlipLine) {
      var key = loadingSlipLineKey(loadingSlipLine);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(loadingSlipLine);
    });
    return result;
  }

  function appendAllLoadingSlipLines(lines, loadingSlipLines) {
    if (!Array.isArray(lines)) return lines;
    var additions = (Array.isArray(loadingSlipLines) ? loadingSlipLines : [])
      .filter(function (line) {
        return line && line.lineType === "loading-slip" && String(line.barcode || "").trim();
      });
    return additions.length ? lines.concat(additions) : lines;
  }

  function loadingSlipLineKey(line) {
    if (!line || line.lineType !== "loading-slip") return "";
    var barcode = String(line.barcode || "").trim();
    if (!barcode) return "";
    return [
      barcode,
      String(line.loadingSlipAttachmentId || "").trim(),
      String(line.loadingSlipAttachmentPage || "").trim(),
      String(line.loadingSlipBlockIndex || "").trim(),
      String(line.loadingSlipPosition || "").trim(),
      String(line.product || "").trim(),
      String(line.description || "").replace(/\s+/g, " ").trim(),
      String(line.targetQty || "").trim(),
      String(line.unit || "").trim()
    ].join("\u0001");
  }

  function countLoadingSlipLines(lines) {
    return (Array.isArray(lines) ? lines : [])
      .filter(function (line) {
        return line && line.lineType === "loading-slip" && String(line.barcode || "").trim();
      })
      .length;
  }

  function appendLoadingSlipLinesToParsed(parsed, loadingSlipLines) {
    if (!parsed || !Array.isArray(parsed.lines)) return parsed;
    var lines = appendLoadingSlipLines(parsed.lines, loadingSlipLines);
    return lines === parsed.lines ? parsed : Object.assign({}, parsed, { lines: lines });
  }

  function collectLoadingSlipLinesFromOcrCandidates(candidates, dependencies) {
    var seen = new Set();
    var lines = [];
    var diagnostics = [];

    (Array.isArray(candidates) ? candidates : []).forEach(function (candidate) {
      var sourceLines = String((candidate && candidate.text) || "")
        .replace(/\r/g, "\n")
        .split("\n")
        .map(function (line) {
          return line.trim();
        })
        .filter(Boolean);
      var parsedLines = parseLoadingSlipLines(sourceLines, dependencies);
      var added = [];

      parsedLines.forEach(function (line) {
        var key = loadingSlipLineKey(line);
        if (!key || seen.has(key)) return;
        seen.add(key);
        lines.push(line);
        added.push(key);
      });

      var audit = auditLoadingSlipImport(sourceLines, parsedLines, dependencies);
      if (audit.expected || parsedLines.length) {
        diagnostics.push({
          label: (candidate && candidate.label) || "",
          scale: (candidate && candidate.scale) || "",
          dpi: (candidate && candidate.dpi) || "",
          rotation: Number((candidate && candidate.rotation) || 0),
          score: Number((candidate && candidate.score) || 0),
          expected: audit.expected,
          parsed: parsedLines.length,
          added: added
        });
      }
    });

    return {
      lines: lines,
      diagnostics: diagnostics,
      expected: diagnostics.reduce(function (maximum, entry) {
        return Math.max(maximum, Number(entry.expected || 0));
      }, 0)
    };
  }

  function parseLoadingSlipLines(lines, dependencies) {
    var blocks = loadingSlipBlocksFrom(lines, dependencies);
    return blocks.flatMap(function (block, blockIndex) {
      return parseLoadingSlipBlockLines(block, dependencies).map(function (line) {
        return Object.assign({}, line, { loadingSlipBlockIndex: blockIndex + 1 });
      });
    });
  }

  function auditLoadingSlipImport(lines, parsedLines, dependencies) {
    var blocks = loadingSlipBlocksFrom(lines, dependencies);
    var normalizedParsedLines = Array.isArray(parsedLines) ? parsedLines : [];
    if (!blocks.length) {
      return {
        expected: 0,
        attached: countLoadingSlipLines(normalizedParsedLines),
        issues: []
      };
    }

    var parsedBlocks = blocks.map(function (block, index) {
      var parsedBlockLines = parseLoadingSlipBlockLines(block, dependencies);
      return {
        index: index + 1,
        barcode: String((parsedBlockLines[0] && parsedBlockLines[0].barcode) || extractLoadingSlipHeaderBarcode(block) || "").trim(),
        lines: parsedBlockLines,
        parsed: parsedBlockLines.length > 0
      };
    });

    var attached = countLoadingSlipLines(normalizedParsedLines);
    var expected = parsedBlocks.reduce(function (total, entry) {
      return total + Math.max(1, entry.lines.length);
    }, 0);
    var issues = [];
    var missing = parsedBlocks.filter(function (entry) {
      return !entry.parsed || !entry.barcode;
    });

    if (missing.length) {
      issues.push(missing.length + " Ladeliste(n) erkannt, aber Barcode/Position konnte nicht eindeutig gelesen werden (" + formatLoadingSlipIndexes(missing) + ").");
    }

    if (attached !== expected) {
      issues.push(expected + " Ladeschein-Position(en) erkannt, aber " + attached + " erzeugt.");
    }

    return {
      expected: expected,
      attached: attached,
      issues: issues
    };
  }

  function duplicateLoadingSlipBarcodes(entries) {
    var counts = new Map();
    entries.forEach(function (entry) {
      var barcode = String(entry.barcode || "").trim();
      if (!barcode) return;
      counts.set(barcode, (counts.get(barcode) || 0) + 1);
    });
    return Array.from(counts.entries())
      .filter(function (entry) {
        return entry[1] > 1;
      })
      .map(function (entry) {
        return entry[0];
      });
  }

  function formatLoadingSlipIndexes(entries) {
    return entries
      .slice(0, 5)
      .map(function (entry) {
        return "Ladeliste " + entry.index;
      })
      .join(", ");
  }

  function parseLoadingSlipBlock(lines, dependencies) {
    return parseLoadingSlipBlockLines(lines, dependencies)[0] || null;
  }

  function parseLoadingSlipBlockLines(lines, dependencies) {
    if (!isLikelyLoadingSlip(lines, dependencies)) return [];

    var collectBestellscheinRows = dependency(dependencies, "collectBestellscheinRows", function () { return []; });
    var createLine = dependency(dependencies, "createLine", function (overrides) { return overrides || {}; });
    var setAutoPositionNote = dependency(dependencies, "setAutoPositionNote", function (notes, key, value) {
      var next = Object.assign({}, notes || {});
      next[key] = String(value || "").trim();
      return next;
    });
    var rows = collectBestellscheinRows(lines);
    var groupedRows = parseGroupedLoadingSlipRows(lines, dependencies);
    if (groupedRows.length > rows.length) rows = groupedRows;
    var columnarRows = parseColumnarLoadingSlipRows(lines, dependencies);
    if (columnarRows.length > rows.length) rows = columnarRows;
    if (!rows.length) rows = parseStackedLoadingSlipRows(lines, dependencies);
    if (!rows.length) rows = parseCompactLoadingSlipRows(lines, dependencies);
    if (!rows.length) return [];

    var barcode = extractLoadingSlipHeaderBarcode(lines) || rows[0].fromHandlingUnit || "";
    if (!barcode) return [];

    return rows.map(function (row, index) {
      var targetQty = normalizeLoadingSlipQuantity(row.targetQty, dependencies);
      return createLine({
        lineType: "loading-slip",
        warehouseOrder: "Ladeschein",
        barcode: barcode,
        loadingSlipPosition: index + 1,
        product: row.product || "",
        description: row.description || "Ladeschein",
        targetQty: targetQty,
        actualQty: targetQty,
        unit: row.unit || "",
        autoPositionNotes: setAutoPositionNote({}, "loadingSlip", rows.length > 1 ? "Ladeschein mit " + rows.length + " Positionen" : ""),
        fromHandlingUnit: "",
        fromHandlingUnitEditable: false,
        fromBin: "",
        toBin: ""
      });
    });
  }

  function loadingSlipBlocksFrom(lines, dependencies) {
    var sourceLines = Array.isArray(lines) ? lines : [];
    var isBestellscheinRowStart = dependency(dependencies, "isBestellscheinRowStart", function () { return false; });
    var blocks = [];
    var current = null;
    var currentHasRows = false;
    var currentHasHeaderBarcode = false;

    sourceLines.forEach(function (line) {
      var isStart = isLoadingSlipStartLine(line);
      var isHeaderBarcode = isLoadingSlipHeaderBarcodeLine(line);
      var isRow = isBestellscheinRowStart(line) || /^\d{6,8}\b/.test(String(line || "").trim());
      var startsHeaderOnlySlip = !current && isHeaderBarcode;
      var startsNestedSlip = current && isHeaderBarcode && (currentHasRows || currentHasHeaderBarcode);

      if (isStart || startsHeaderOnlySlip || startsNestedSlip) {
        if (current && current.length) blocks.push(current);
        current = [line];
        currentHasRows = isRow;
        currentHasHeaderBarcode = isHeaderBarcode;
        return;
      }

      if (!current) return;
      current.push(line);
      if (isRow) currentHasRows = true;
      if (isHeaderBarcode) currentHasHeaderBarcode = true;
    });

    if (current && current.length) blocks.push(current);
    return blocks;
  }

  function isLoadingSlipStartLine(line) {
    return /lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(String(line || ""));
  }

  function isLoadingSlipHeaderBarcodeLine(line) {
    return /\b(?:Nummer|Numm(?:e|c)r|Nr\.?)\s*[:.-]?\s*[A-Z]\s*\d[\d\s./-]{5,}\d\b/i.test(String(line || ""));
  }

  function linesBeforeLoadingSlip(lines) {
    var sourceLines = Array.isArray(lines) ? lines : [];
    var startIndex = sourceLines.findIndex(isLoadingSlipStartLine);
    return startIndex === -1 ? sourceLines : sourceLines.slice(0, startIndex);
  }

  function isLikelyLoadingSlip(lines, dependencies) {
    var sourceLines = Array.isArray(lines) ? lines : String(lines || "").replace(/\r/g, "\n").split("\n");
    var source = sourceLines.join("\n");
    var collectBestellscheinRows = dependency(dependencies, "collectBestellscheinRows", function () { return []; });
    var hasLoadingSlipMarker = /lad[ce](?:schein|liste)|lade(?:schein|liste)|bestellschein|entnahmeanweisungen/i.test(source);
    var hasHeaderBarcode = sourceLines.some(isLoadingSlipHeaderBarcodeLine);
    return (hasLoadingSlipMarker || hasHeaderBarcode) && (
      collectBestellscheinRows(lines).length > 0
        || parseGroupedLoadingSlipRows(lines, dependencies).length > 0
        || parseColumnarLoadingSlipRows(lines, dependencies).length > 0
        || parseStackedLoadingSlipRows(lines, dependencies).length > 0
        || parseCompactLoadingSlipRows(lines, dependencies).length > 0
    );
  }

  function parseGroupedLoadingSlipRows(lines, dependencies) {
    var normalized = normalizeLoadingSlipText(Array.isArray(lines) ? lines.join(" ") : String(lines || ""));
    if (!/lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(normalized)) return [];

    var products = Array.from(normalized.matchAll(/\b\d{6,8}\b/g));
    var quantities = Array.from(normalized.matchAll(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(St(?:\u00fc|ue|u|ii|i)ck|STK?|PC|PCS|KG|G|KAR|PCK|PAK|VE|PAL)\b/gi));
    var positionCount = Math.min(products.length, quantities.length);
    if (!positionCount) return [];

    var firstQuantityIndex = quantities[0].index || 0;
    if (products[positionCount - 1].index >= firstQuantityIndex) return [];

    return Array.from({ length: positionCount }, function (_, index) {
      var product = products[index];
      var nextProduct = products[index + 1];
      var descriptionEnd = nextProduct ? nextProduct.index : firstQuantityIndex;
      var description = cleanLoadingSlipDescription(normalized.slice((product.index || 0) + product[0].length, descriptionEnd));
      return {
        fromHandlingUnit: "",
        fromBin: "",
        product: product[0],
        description: description,
        targetQty: normalizeLoadingSlipQuantity(quantities[index][1], dependencies),
        unit: normalizeUnit(quantities[index][2], dependencies),
        toBin: ""
      };
    }).filter(function (row) {
      return Boolean(row.description && row.targetQty);
    });
  }

  function parseColumnarLoadingSlipRows(lines, dependencies) {
    var sourceLines = (Array.isArray(lines) ? lines : String(lines || "").replace(/\r/g, "\n").split("\n"))
      .map(normalizeLoadingSlipText)
      .filter(Boolean);
    var productIndexes = sourceLines
      .map(function (line, index) { return /^\d{6,8}$/.test(line) ? index : -1; })
      .filter(function (index) { return index >= 0; });
    var quantityIndexes = sourceLines
      .map(function (line, index) { return isLoadingSlipQuantityCell(line) ? index : -1; })
      .filter(function (index) { return index >= 0; });
    var unitIndexes = sourceLines
      .map(function (line, index) { return isLoadingSlipUnitCell(line) ? index : -1; })
      .filter(function (index) { return index >= 0; });
    var positionCount = Math.min(productIndexes.length, quantityIndexes.length, unitIndexes.length);
    if (!positionCount) return [];

    var firstProductIndex = productIndexes[0];
    var lastDataIndex = Math.max(
      productIndexes[positionCount - 1],
      quantityIndexes[positionCount - 1],
      unitIndexes[positionCount - 1]
    );
    var descriptions = sourceLines
      .slice(firstProductIndex, lastDataIndex + 1)
      .filter(function (line) {
        return !/^\d{6,8}$/.test(line)
          && !isLoadingSlipQuantityCell(line)
          && !isLoadingSlipUnitCell(line)
          && !/^(?:Artikel|Bezeichnung|Menge|Verpackung)$/i.test(line)
          && /[A-Za-z\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc]/.test(line);
      })
      .map(cleanLoadingSlipDescription)
      .filter(Boolean);
    if (descriptions.length < positionCount) return [];

    return Array.from({ length: positionCount }, function (_, index) {
      return {
        fromHandlingUnit: "",
        fromBin: "",
        product: sourceLines[productIndexes[index]],
        description: descriptions[index],
        targetQty: normalizeLoadingSlipQuantity(sourceLines[quantityIndexes[index]], dependencies),
        unit: normalizeUnit(sourceLines[unitIndexes[index]], dependencies),
        toBin: ""
      };
    }).filter(function (row) {
      return Boolean(row.description && row.targetQty);
    });
  }

  function isLoadingSlipQuantityCell(value) {
    return /^\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?$|^\d+(?:[,.]\d+)?$/.test(String(value || "").trim());
  }

  function isLoadingSlipUnitCell(value) {
    return /^(?:St(?:\u00fc|ue|u|ii|i)ck|STK?|PC|PCS|KG|G|KAR|PCK|PAK|VE|PAL)$/i.test(String(value || "").trim());
  }

  function parseStackedLoadingSlipRows(lines, dependencies) {
    var normalized = normalizeLoadingSlipText(Array.isArray(lines) ? lines.join(" ") : String(lines || ""));
    if (!/lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(normalized)) return [];

    return Array.from(normalized.matchAll(/\b(\d{6,8})\b\s+(.+?)\s+(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(St(?:\u00fc|ue|u|ii|i)ck|STK?|PC|PCS|KG|G|KAR|PCK|PAK|VE|PAL)\b/gi))
      .map(function (rowMatch) {
        return loadingSlipRowFromMatch(rowMatch, dependencies);
      })
      .filter(Boolean);
  }

  function parseCompactLoadingSlipRows(lines, dependencies) {
    var sourceLines = Array.isArray(lines) ? lines : String(lines || "").replace(/\r/g, "\n").split("\n");
    return sourceLines
      .map(function (line) {
        return normalizeLoadingSlipText(line).match(/^(\d{6,8})\b\s+(.+?)\s+(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(St(?:\u00fc|ue|u|ii|i)ck|STK?|PC|PCS|KG|G|KAR|PCK|PAK|VE|PAL)\b/i);
      })
      .map(function (rowMatch) {
        return rowMatch && loadingSlipRowFromMatch(rowMatch, dependencies);
      })
      .filter(Boolean);
  }

  function loadingSlipRowFromMatch(rowMatch, dependencies) {
    var description = cleanLoadingSlipDescription(rowMatch[2]);
    var targetQty = normalizeLoadingSlipQuantity(rowMatch[3], dependencies);
    if (!description || !targetQty) return null;

    return {
      fromHandlingUnit: "",
      fromBin: "",
      product: rowMatch[1],
      description: description,
      targetQty: targetQty,
      unit: normalizeUnit(rowMatch[4], dependencies),
      toBin: ""
    };
  }

  function parseStackedLoadingSlipRow(lines, dependencies) {
    var normalized = normalizeLoadingSlipText(Array.isArray(lines) ? lines.join(" ") : String(lines || ""));
    if (!/lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(normalized)) return null;

    var rowMatch = normalized.match(/\b(\d{6,8})\b\s+(.+?)\s+(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(St(?:Ã¼|ue|u|ii|i)ck|STK?|PC|PCS|KG|G|KAR|PCK|PAK|VE|PAL)\b/i);
    if (!rowMatch) return null;

    var description = cleanLoadingSlipDescription(rowMatch[2]);
    var targetQty = normalizeLoadingSlipQuantity(rowMatch[3], dependencies);
    if (!description || !targetQty) return null;

    return {
      fromHandlingUnit: extractLoadingSlipHeaderBarcode(lines),
      fromBin: "",
      product: rowMatch[1],
      description: description,
      targetQty: targetQty,
      unit: normalizeUnit(rowMatch[4], dependencies),
      toBin: ""
    };
  }

  function parseCompactLoadingSlipRow(lines, dependencies) {
    var sourceLines = Array.isArray(lines) ? lines : String(lines || "").replace(/\r/g, "\n").split("\n");
    for (var index = 0; index < sourceLines.length; index += 1) {
      var normalized = normalizeLoadingSlipText(sourceLines[index]);
      var rowMatch = normalized.match(/^(\d{6,8})\b\s+(.+?)\s+(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(St(?:ÃƒÂ¼|ue|u|ii|i)ck|STK?|PC|PCS|KG|G|KAR|PCK|PAK|VE|PAL)\b/i);
      if (!rowMatch) continue;

      var description = cleanLoadingSlipDescription(rowMatch[2]);
      var targetQty = normalizeLoadingSlipQuantity(rowMatch[3], dependencies);
      if (!description || !targetQty) continue;

      return {
        fromHandlingUnit: "",
        fromBin: "",
        product: rowMatch[1],
        description: description,
        targetQty: targetQty,
        unit: normalizeUnit(rowMatch[4], dependencies),
        toBin: ""
      };
    }

    return null;
  }

  function normalizeLoadingSlipText(value) {
    return String(value || "")
      .replace(/[|[\]{}]/g, " ")
      .replace(/\bArtikeI\b/g, "Artikel")
      .replace(/\bBezeichnunq\b/g, "Bezeichnung")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanLoadingSlipDescription(value) {
    return String(value || "")
      .replace(/\b(?:Menge|Verpackung|Artikel|Bezeichnung)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeLoadingSlipQuantity(value, dependencies) {
    var raw = String(value || "").trim();
    var parseQuantity = dependency(dependencies, "parseQuantity", function () { return NaN; });
    var parsed = parseQuantity(raw);
    if (Number.isFinite(parsed)) return String(parsed);
    var withoutDecimalZeros = raw.replace(/,\s*0+$/, "");
    if (/^\d{1,3}(?:[.\s]\d{3})+$/.test(withoutDecimalZeros)) {
      return withoutDecimalZeros.replace(/\s+/g, ".");
    }
    return normalizeQuantity(raw, dependencies);
  }

  function parseBestellscheinRowStrict(chunk, dependencies) {
    var fullText = normalizeBestellscheinText(chunk);
    var headerText = bestellscheinHeaderText(fullText);
    var rowMatch = headerText.match(/^(\d{6,8})\s+(.+?)\s+(\d{1,4}(?:[,.]\d{3})*|\d+(?:[,.]\d+)?)\s*(ST|Stk|Stueck|StÃ¼ck|PC|PCS)\b/i);
    if (!rowMatch) return null;

    var product = rowMatch[1];
    var description = cleanBestellscheinDescription(rowMatch[2]);
    var targetQty = normalizeQuantity(rowMatch[3], dependencies);
    var unit = normalizeUnit(rowMatch[4], dependencies);
    var fromBin = extractBestellscheinBin(fullText);
    var fromHandlingUnit = extractBestellscheinFirstBarcode(fullText, product, dependencies);

    if (!description || !targetQty) return null;

    return {
      fromHandlingUnit: fromHandlingUnit,
      fromBin: fromBin,
      product: product,
      description: description,
      targetQty: targetQty,
      unit: unit,
      toBin: ""
    };
  }

  function parseBestellscheinRow(chunk, dependencies) {
    var fullText = normalizeBestellscheinText(chunk);
    var normalized = bestellscheinHeaderText(fullText);
    var rowMatch = normalized.match(/^(\d{7})\s+(.+?)\s+(\d{1,4}(?:[,.]\d{3})*|\d+(?:[,.]\d+)?)\s*(ST|Stk|Stueck|StÃ¼ck|PC|PCS)\b/i);
    if (!rowMatch) return null;

    var product = rowMatch[1];
    var description = cleanBestellscheinDescription(rowMatch[2]);
    var targetQty = normalizeQuantity(rowMatch[3], dependencies);
    var unit = normalizeUnit(rowMatch[4], dependencies);
    var fromBin = extractBestellscheinBin(fullText);
    var fromHandlingUnit = extractBestellscheinFirstBarcode(fullText, product, dependencies);

    if (!description || !targetQty) return null;

    return {
      fromHandlingUnit: fromHandlingUnit,
      fromBin: fromBin,
      product: product,
      description: description,
      targetQty: targetQty,
      unit: unit,
      toBin: ""
    };
  }

  function parseBestellscheinRowFallback(chunk, looseQuantity, dependencies) {
    var normalized = normalizeBestellscheinText(chunk);
    var headerText = bestellscheinHeaderText(normalized);
    var headerMatch = headerText.match(/^(\d{6,8})\s+(.+?)$/i);
    if (!headerMatch) return null;

    var product = headerMatch[1];
    var quantityFromDescription = splitTrailingBestellscheinQuantity(headerMatch[2]);
    var targetQty = quantityFromDescription.quantity || (looseQuantity && looseQuantity.quantity) || "";
    var description = cleanBestellscheinDescription(quantityFromDescription.description || headerMatch[2]);
    if (!description || !targetQty) return null;

    return {
      fromHandlingUnit: extractBestellscheinFirstBarcode(normalized, product, dependencies),
      fromBin: extractBestellscheinBin(normalized),
      product: product,
      description: description,
      targetQty: normalizeQuantity(targetQty, dependencies),
      unit: normalizeUnit(quantityFromDescription.unit || (looseQuantity && looseQuantity.unit) || "ST", dependencies),
      toBin: ""
    };
  }

  function bestellscheinHeaderText(value) {
    return String(value || "")
      .split(/\bLagerp?l?atz\s*[:.]?/i)[0]
      .trim();
  }

  function splitTrailingBestellscheinQuantity(value) {
    var source = String(value || "").trim();
    var match = source.match(/^(.+?\D)\s+(\d{1,4}(?:[,.]\d+)?)$/);
    if (!match) return { description: source, quantity: "", unit: "" };

    return {
      description: match[1].trim(),
      quantity: match[2],
      unit: "ST"
    };
  }

  function normalizeBestellscheinText(value) {
    return String(value || "")
      .replace(/[|[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b(\d+)8T\b/gi, "$1 ST")
      .replace(/\b5T\b/gi, "ST")
      .replace(/\bS7\b/gi, "ST")
      .trim();
  }

  function cleanBestellscheinDescription(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\bLagerp?l?atz\b.*$/i, "")
      .trim();
  }

  function extractBestellscheinBin() {
    return "";
  }

  function extractBestellscheinFirstBarcode(value, product, dependencies) {
    var afterBin = String(value || "").match(/Lagerp?l?atz\s*[:.]?\s*\d{2,4}\s*\/\s*\d{7}\D+(.+)$/i);
    var source = String(value || "");
    var productIndex = source.indexOf(String(product || ""));
    var searchText = afterBin ? afterBin[1] : source.slice(productIndex === -1 ? 0 : productIndex + String(product || "").length);

    var candidates = Array.from(searchText.matchAll(/\b\d{8,12}\b/g))
      .map(function (match) {
        return { value: match[0], index: match.index || 0 };
      })
      .filter(function (candidate) {
        return candidate.value !== product;
      })
      .filter(function (candidate) {
        return !isBestellscheinOrderColumnNumber(searchText, candidate);
      });

    var likely = candidates.find(function (candidate) {
      return isLikelyHandlingUnit(candidate.value, dependencies);
    });
    return (likely && likely.value) || (candidates[0] && candidates[0].value) || "";
  }

  function isBestellscheinOrderColumnNumber(text, candidate) {
    var afterNumber = String(text || "").slice(candidate.index + candidate.value.length, candidate.index + candidate.value.length + 8);
    return /^\s+[A-Z]{2}\b/.test(afterNumber);
  }

  function isLikelyHandlingUnit(value, dependencies) {
    return dependency(dependencies, "isLikelyHandlingUnit", function (source) {
      return /^3\d{7,11}$/.test(String(source || ""));
    })(value);
  }

  function normalizeUnit(unit, dependencies) {
    return dependency(dependencies, "normalizeUnit", function (value) { return value; })(unit);
  }

  function normalizeQuantity(value, dependencies) {
    return dependency(dependencies, "normalizeQuantity", function (source) { return String(source || ""); })(value);
  }

  function extractLoadingSlipHeaderBarcode(lines) {
    var sourceLines = Array.isArray(lines) ? lines : [];
    var firstRowIndex = sourceLines.findIndex(function (line) {
      return /^\d{6,8}\b/.test(String(line || "").trim());
    });
    var headerText = (firstRowIndex === -1 ? sourceLines.slice(0, 20) : sourceLines.slice(0, firstRowIndex)).join(" ");
    var sourceText = headerText || sourceLines.slice(0, 20).join(" ");
    var numberMatch = sourceText.match(/\b(?:Nummer|Numm(?:e|c)r|Nr\.?)\s*[:.-]?\s*([A-Z]\s*\d[\d\s./-]{5,}\d)\b/i);
    if (numberMatch) return cleanLoadingSlipBarcode(numberMatch[1]);

    var candidates = Array.from(sourceText.matchAll(/\b[A-Z]\s*\d[\d\s./-]{5,}\d\b|\b[A-Z0-9]{8,24}\b/g))
      .map(function (match) {
        return match[0];
      })
      .map(cleanLoadingSlipBarcode)
      .filter(function (value) {
        return /\d/.test(value);
      })
      .filter(function (value) {
        return !/^\d{6,8}$/.test(value);
      })
      .filter(function (value) {
        return !/^(?:20\d{6}|19\d{6})$/.test(value);
      });
    return candidates.find(function (value) {
      return value.length >= 12;
    }) || candidates[0] || "";
  }

  function cleanLoadingSlipBarcode(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/[|]/g, "/")
      .replace(/[^A-Z0-9/.-]/gi, "")
      .toUpperCase();
  }

  window.HLogistikPickingParser = {
    appendLoadingSlipLines: appendLoadingSlipLines,
    appendAllLoadingSlipLines: appendAllLoadingSlipLines,
    loadingSlipLineKey: loadingSlipLineKey,
    countLoadingSlipLines: countLoadingSlipLines,
    appendLoadingSlipLinesToParsed: appendLoadingSlipLinesToParsed,
    collectLoadingSlipLinesFromOcrCandidates: collectLoadingSlipLinesFromOcrCandidates,
    parseLoadingSlipLines: parseLoadingSlipLines,
    auditLoadingSlipImport: auditLoadingSlipImport,
    duplicateLoadingSlipBarcodes: duplicateLoadingSlipBarcodes,
    formatLoadingSlipIndexes: formatLoadingSlipIndexes,
    parseLoadingSlipBlock: parseLoadingSlipBlock,
    parseLoadingSlipBlockLines: parseLoadingSlipBlockLines,
    loadingSlipBlocksFrom: loadingSlipBlocksFrom,
    isLoadingSlipStartLine: isLoadingSlipStartLine,
    isLoadingSlipHeaderBarcodeLine: isLoadingSlipHeaderBarcodeLine,
    linesBeforeLoadingSlip: linesBeforeLoadingSlip,
    isLikelyLoadingSlip: isLikelyLoadingSlip,
    parseStackedLoadingSlipRow: parseStackedLoadingSlipRow,
    parseStackedLoadingSlipRows: parseStackedLoadingSlipRows,
    parseCompactLoadingSlipRow: parseCompactLoadingSlipRow,
    parseCompactLoadingSlipRows: parseCompactLoadingSlipRows,
    normalizeLoadingSlipText: normalizeLoadingSlipText,
    cleanLoadingSlipDescription: cleanLoadingSlipDescription,
    normalizeLoadingSlipQuantity: normalizeLoadingSlipQuantity,
    parseBestellscheinRowStrict: parseBestellscheinRowStrict,
    parseBestellscheinRow: parseBestellscheinRow,
    parseBestellscheinRowFallback: parseBestellscheinRowFallback,
    bestellscheinHeaderText: bestellscheinHeaderText,
    splitTrailingBestellscheinQuantity: splitTrailingBestellscheinQuantity,
    normalizeBestellscheinText: normalizeBestellscheinText,
    cleanBestellscheinDescription: cleanBestellscheinDescription,
    extractBestellscheinBin: extractBestellscheinBin,
    extractBestellscheinFirstBarcode: extractBestellscheinFirstBarcode,
    isBestellscheinOrderColumnNumber: isBestellscheinOrderColumnNumber,
    extractLoadingSlipHeaderBarcode: extractLoadingSlipHeaderBarcode,
    cleanLoadingSlipBarcode: cleanLoadingSlipBarcode
  };
})();
