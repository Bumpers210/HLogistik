(function () {
  function pickingOcrCandidateDiagnostic(candidate) {
    return {
      label: candidate.label || "",
      scale: candidate.scale || "",
      dpi: candidate.dpi || "",
      rotation: Number(candidate.rotation || 0),
      score: Number(candidate.score || 0),
      metrics: candidate.metrics || {}
    };
  }

  function pickingImportDiagnostics(text, parsed, info, dependencies) {
    var source = String(text || "");
    var normalizedParsed = parsed || {};
    var normalizedInfo = info || {};
    var deps = dependencies || {};
    var parseLoadingSlipLines = dependency(deps, "parseLoadingSlipLines", function () { return []; });
    var linesBeforeLoadingSlip = dependency(deps, "linesBeforeLoadingSlip", function (lines) { return lines; });
    var isWarehouseLikeText = dependency(deps, "isWarehouseLikeText", function () { return false; });
    var auditLoadingSlipImport = dependency(deps, "auditLoadingSlipImport", function () {
      return { expected: 0, attached: 0, issues: [] };
    });
    var importDocumentType = dependency(deps, "importDocumentType", function () { return ""; });
    var countWarehouseCandidateRows = dependency(deps, "countWarehouseCandidateRows", function () { return 0; });
    var countBestellscheinCandidateRows = dependency(deps, "countBestellscheinCandidateRows", function () { return 0; });
    var minimumQualityScore = finiteOrFallback(deps.minimumQualityScore, 0);
    var lines = source
      .replace(/\r/g, "\n")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    var loadingSlipLines = parseLoadingSlipLines(lines);
    var pickingLines = loadingSlipLines.length ? linesBeforeLoadingSlip(lines) : lines;
    var pickingSource = pickingLines.join("\n");
    var warehouseLike = isWarehouseLikeText(pickingSource);
    var loadingSlipAudit = auditLoadingSlipImport(lines, normalizedParsed.lines || []) || {};
    var loadingSlipExpected = Math.max(
      Number(normalizedInfo.loadingSlipExpected || 0),
      Number(loadingSlipAudit.expected || 0)
    );
    var expectedWarehouseRows = warehouseLike ? countWarehouseCandidateRows(pickingLines) : 0;
    var parsedLineCount = Array.isArray(normalizedParsed.lines) ? normalizedParsed.lines.length : 0;

    return {
      source: normalizedInfo.source || "",
      documentType: normalizedInfo.documentType || importDocumentType(source, normalizedParsed),
      pdfPages: Number(normalizedInfo.pdfPages || 0),
      ocrScale: normalizedInfo.ocrScale || "",
      ocrDpi: normalizedInfo.ocrDpi || "",
      ocrPreciseScale: normalizedInfo.ocrPreciseScale || "",
      ocrPreciseDpi: normalizedInfo.ocrPreciseDpi || "",
      ocrRotations: Array.isArray(normalizedInfo.ocrRotations) ? normalizedInfo.ocrRotations : [],
      ocrScales: Array.isArray(normalizedInfo.ocrScales) ? normalizedInfo.ocrScales : [],
      ocrDpis: Array.isArray(normalizedInfo.ocrDpis) ? normalizedInfo.ocrDpis : [],
      ocrRotation: normalizedInfo.ocrRotation != null ? normalizedInfo.ocrRotation : "",
      selectedCandidate: normalizedInfo.selectedCandidate || null,
      ocrCandidates: Array.isArray(normalizedInfo.ocrCandidates) ? normalizedInfo.ocrCandidates : [],
      ocrTimings: Array.isArray(normalizedInfo.ocrTimings) ? normalizedInfo.ocrTimings : [],
      loadingSlipExpected: loadingSlipExpected,
      loadingSlipAttached: loadingSlipAudit.attached,
      loadingSlipIssues: loadingSlipAudit.issues,
      loadingSlipCandidates: Array.isArray(normalizedInfo.loadingSlipCandidates) ? normalizedInfo.loadingSlipCandidates : [],
      qualityScore: normalizedInfo.qualityScore != null ? normalizedInfo.qualityScore : null,
      minimumQualityScore: normalizedInfo.minimumQualityScore != null ? normalizedInfo.minimumQualityScore : minimumQualityScore,
      qualityAccepted: normalizedInfo.qualityAccepted === true,
      ocrError: normalizedInfo.ocrError || "",
      binValidationApplied: normalizedInfo.binValidationApplied === true,
      binCorrectionApplied: normalizedInfo.binCorrectionApplied === true,
      binRuleNormalizationApplied: false,
      textAvailable: Boolean(source.trim()),
      textLength: source.length,
      rawLineCount: lines.length,
      pickingLineCount: pickingLines.length,
      warehouseLike: warehouseLike,
      expectedWarehouseRows: expectedWarehouseRows,
      expectedBestellscheinRows: countBestellscheinCandidateRows(pickingLines),
      parsedLineCount: parsedLineCount,
      discardedWarehouseRows: Math.max(0, expectedWarehouseRows - parsedLineCount),
      orderNumberDetected: Boolean(String(normalizedParsed.orderNumber || "").trim()),
      customerDetected: Boolean(String(normalizedParsed.customerName || "").trim())
    };
  }

  function logPickingImportDiagnostics(reason, diagnostics) {
    console.warn("PDF-Import Diagnose", Object.assign({ reason: reason }, diagnostics));
  }

  function pickingImportNoLinesMessage(text, diagnostics) {
    if (!String(text || "").trim()) return "Keine lesbaren Inhalte gefunden.";
    if (diagnostics && diagnostics.warehouseLike) {
      return "Text gelesen, aber keine Lageraufgaben-Position erkannt. Import abgebrochen.";
    }
    return "Text gelesen, aber keine Tabellenzeilen erkannt. Import abgebrochen.";
  }

  function buildPickingImportLineDiagnostics(rawLines, finalLines) {
    var sourceLines = Array.isArray(rawLines) ? rawLines : [];
    var resultLines = Array.isArray(finalLines) ? finalLines : sourceLines;

    return sourceLines.map(function (line, index) {
      var finalLine = resultLines[index] || line || {};
      var rawFromBin = String((line && line.fromBin) || "").trim();
      var finalFromBin = String((finalLine && finalLine.fromBin) || "").trim();
      var warehouseOrder = String((line && line.warehouseOrder) || finalLine.warehouseOrder || "").trim();
      var fromHandlingUnit = String((line && line.fromHandlingUnit) || finalLine.fromHandlingUnit || "").trim();
      var product = String((line && line.product) || finalLine.product || "").trim();

      return {
        position: index + 1,
        tableRowKey: [warehouseOrder, fromHandlingUnit, product].filter(Boolean).join(" | "),
        warehouseOrder: warehouseOrder,
        fromHandlingUnit: fromHandlingUnit,
        product: product,
        rawFromBin: rawFromBin,
        finalFromBin: finalFromBin,
        toBin: String((line && line.toBin) || finalLine.toBin || "").trim(),
        changed: rawFromBin !== finalFromBin,
        reason: pickingImportBinDiagnosticReason(rawFromBin, finalFromBin)
      };
    });
  }

  function pickingImportBinDiagnosticReason(rawFromBin, finalFromBin) {
    if (rawFromBin === finalFromBin) {
      return rawFromBin
        ? "Rohwert unveraendert uebernommen; keine Stellplatzvalidierung oder -korrektur angewendet."
        : "Kein Rohwert aus Von-Lagerplatz erkannt; kein Stellplatz abgeleitet.";
    }
    if (!rawFromBin && finalFromBin) {
      return "Finaler Stellplatz wurde gesetzt, obwohl kein Rohwert vorhanden war.";
    }
    if (rawFromBin && !finalFromBin) {
      return "Finaler Stellplatz ist leer, Rohwert wurde nicht uebernommen.";
    }
    return "Finaler Stellplatz weicht vom Rohwert ab.";
  }

  function logPickingImportLineDiagnostics(diagnostics, importDiagnostics, dependencies) {
    var positions = Array.isArray(diagnostics) ? diagnostics : [];
    var normalizedDiagnostics = importDiagnostics || {};
    var deps = dependencies || {};
    if (!positions.length) return;
    console.info("PDF-Import Positionsdiagnose", {
      source: normalizedDiagnostics.source || "",
      pdfPages: normalizedDiagnostics.pdfPages || 0,
      ocrScale: normalizedDiagnostics.ocrScale || "",
      ocrDpi: normalizedDiagnostics.ocrDpi || "",
      ocrPreciseScale: normalizedDiagnostics.ocrPreciseScale || "",
      ocrPreciseDpi: normalizedDiagnostics.ocrPreciseDpi || "",
      ocrRotations: normalizedDiagnostics.ocrRotations || [],
      ocrScales: normalizedDiagnostics.ocrScales || [],
      ocrDpis: normalizedDiagnostics.ocrDpis || [],
      ocrRotation: normalizedDiagnostics.ocrRotation != null ? normalizedDiagnostics.ocrRotation : "",
      selectedCandidate: normalizedDiagnostics.selectedCandidate || null,
      ocrCandidates: normalizedDiagnostics.ocrCandidates || [],
      loadingSlipExpected: normalizedDiagnostics.loadingSlipExpected != null ? normalizedDiagnostics.loadingSlipExpected : 0,
      loadingSlipAttached: normalizedDiagnostics.loadingSlipAttached != null ? normalizedDiagnostics.loadingSlipAttached : 0,
      loadingSlipCandidates: normalizedDiagnostics.loadingSlipCandidates || [],
      qualityScore: normalizedDiagnostics.qualityScore != null ? normalizedDiagnostics.qualityScore : null,
      minimumQualityScore: normalizedDiagnostics.minimumQualityScore != null
        ? normalizedDiagnostics.minimumQualityScore
        : finiteOrFallback(deps.minimumQualityScore, 0),
      qualityAccepted: normalizedDiagnostics.qualityAccepted === true,
      binValidationApplied: false,
      binCorrectionApplied: false,
      note: "Keine Stellplatzvalidierung, keine Stellplatzkorrektur, kein Regelabgleich im PDF-Importpfad.",
      positions: positions
    });
  }

  function dependency(dependencies, name, fallback) {
    return dependencies && typeof dependencies[name] === "function" ? dependencies[name] : fallback;
  }

  function finiteOrFallback(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  window.HLogistikImportDiagnostics = {
    pickingImportDiagnostics: pickingImportDiagnostics,
    logPickingImportDiagnostics: logPickingImportDiagnostics,
    pickingImportNoLinesMessage: pickingImportNoLinesMessage,
    buildPickingImportLineDiagnostics: buildPickingImportLineDiagnostics,
    pickingImportBinDiagnosticReason: pickingImportBinDiagnosticReason,
    logPickingImportLineDiagnostics: logPickingImportLineDiagnostics,
    pickingOcrCandidateDiagnostic: pickingOcrCandidateDiagnostic
  };
})();
