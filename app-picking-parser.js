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
    additions.forEach(function (loadingSlipLine) {
      var barcode = String(loadingSlipLine.barcode || "").trim();
      var exists = result.some(function (line) {
        return line && line.lineType === "loading-slip" && String(line.barcode || "").trim() === barcode;
      });
      if (!exists) result.push(loadingSlipLine);
    });
    return result;
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
        var barcode = String((line && line.barcode) || "").trim();
        if (!barcode || seen.has(barcode)) return;
        seen.add(barcode);
        lines.push(line);
        added.push(barcode);
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
    var seen = new Set();

    return blocks
      .map(function (block) {
        return parseLoadingSlipBlock(block, dependencies);
      })
      .filter(Boolean)
      .filter(function (line) {
        var barcode = String(line.barcode || "").trim();
        if (!barcode || seen.has(barcode)) return false;
        seen.add(barcode);
        return true;
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
      var line = parseLoadingSlipBlock(block, dependencies);
      return {
        index: index + 1,
        barcode: String((line && line.barcode) || extractLoadingSlipHeaderBarcode(block) || "").trim(),
        parsed: Boolean(line)
      };
    });

    var attached = countLoadingSlipLines(normalizedParsedLines);
    var issues = [];
    var missing = parsedBlocks.filter(function (entry) {
      return !entry.parsed || !entry.barcode;
    });
    var duplicates = duplicateLoadingSlipBarcodes(parsedBlocks);

    if (missing.length) {
      issues.push(missing.length + " Ladeliste(n) erkannt, aber Barcode/Position konnte nicht eindeutig gelesen werden (" + formatLoadingSlipIndexes(missing) + ").");
    }

    if (duplicates.length) {
      issues.push("Ladelisten-Barcode mehrfach erkannt: " + duplicates.slice(0, 3).join(", ") + ".");
    }

    if (attached !== blocks.length) {
      issues.push(blocks.length + " Ladeliste(n) erkannt, aber " + attached + " Barcode-Position(en) erzeugt.");
    }

    return {
      expected: blocks.length,
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
    if (!isLikelyLoadingSlip(lines, dependencies)) return null;

    var collectBestellscheinRows = dependency(dependencies, "collectBestellscheinRows", function () { return []; });
    var createLine = dependency(dependencies, "createLine", function (overrides) { return overrides || {}; });
    var setAutoPositionNote = dependency(dependencies, "setAutoPositionNote", function (notes, key, value) {
      var next = Object.assign({}, notes || {});
      next[key] = String(value || "").trim();
      return next;
    });
    var rows = collectBestellscheinRows(lines);
    var row = rows[0] || parseStackedLoadingSlipRow(lines, dependencies) || parseCompactLoadingSlipRow(lines, dependencies);
    if (!row) return null;

    var barcode = extractLoadingSlipHeaderBarcode(lines) || row.fromHandlingUnit || "";
    if (!barcode) return null;

    return createLine({
      lineType: "loading-slip",
      warehouseOrder: "Ladeschein",
      barcode: barcode,
      product: row.product || "",
      description: row.description || "Ladeschein",
      targetQty: row.targetQty || "",
      actualQty: row.targetQty || "",
      unit: row.unit || "",
      autoPositionNotes: setAutoPositionNote({}, "loadingSlip", rows.length > 1 ? "Ladeschein mit " + rows.length + " Positionen" : ""),
      fromHandlingUnit: "",
      fromHandlingUnitEditable: false,
      fromBin: "",
      toBin: ""
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
        || Boolean(parseStackedLoadingSlipRow(lines, dependencies))
        || Boolean(parseCompactLoadingSlipRow(lines, dependencies))
    );
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
    countLoadingSlipLines: countLoadingSlipLines,
    appendLoadingSlipLinesToParsed: appendLoadingSlipLinesToParsed,
    collectLoadingSlipLinesFromOcrCandidates: collectLoadingSlipLinesFromOcrCandidates,
    parseLoadingSlipLines: parseLoadingSlipLines,
    auditLoadingSlipImport: auditLoadingSlipImport,
    duplicateLoadingSlipBarcodes: duplicateLoadingSlipBarcodes,
    formatLoadingSlipIndexes: formatLoadingSlipIndexes,
    parseLoadingSlipBlock: parseLoadingSlipBlock,
    loadingSlipBlocksFrom: loadingSlipBlocksFrom,
    isLoadingSlipStartLine: isLoadingSlipStartLine,
    isLoadingSlipHeaderBarcodeLine: isLoadingSlipHeaderBarcodeLine,
    linesBeforeLoadingSlip: linesBeforeLoadingSlip,
    isLikelyLoadingSlip: isLikelyLoadingSlip,
    parseStackedLoadingSlipRow: parseStackedLoadingSlipRow,
    parseCompactLoadingSlipRow: parseCompactLoadingSlipRow,
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
