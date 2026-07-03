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
    extractLoadingSlipHeaderBarcode: extractLoadingSlipHeaderBarcode,
    cleanLoadingSlipBarcode: cleanLoadingSlipBarcode
  };
})();
