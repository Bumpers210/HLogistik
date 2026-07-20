(function () {
  function pickingOcrCandidateDiagnostic(candidate) {
    return {
      label: candidate.label || "",
      scale: candidate.scale || "",
      dpi: candidate.dpi || "",
      rotation: Number(candidate.rotation || 0),
      score: Number(candidate.score || 0),
      metrics: candidate.metrics || {},
      positions: pickingOcrCandidatePositionDiagnostics(candidate)
    };
  }

  function pickingOcrCandidatePositionDiagnostics(candidate) {
    var lines = Array.isArray(candidate && candidate.parsed && candidate.parsed.lines)
      ? candidate.parsed.lines
      : [];
    return lines
      .filter(function (line) {
        return !line || line.lineType !== "loading-slip";
      })
      .map(function (line, index) {
        var fromBin = String(line && line.fromBin || "").trim();
        var shape = pickingFromBinShapeDiagnostic(fromBin);
        var review = fromBinReviewDiagnostics(fromBin, shape);
        return {
          position: index + 1,
          warehouseOrder: String(line && line.warehouseOrder || "").trim(),
          product: String(line && line.product || "").trim(),
          targetQty: String(line && line.targetQty || "").trim(),
          toBin: String(line && line.toBin || "").trim(),
          fromBin: fromBin,
          fromBinShapeStatus: shape.status,
          fromBinSuggestedCandidates: shape.suggestedCandidates,
          fromBinReviewRequired: review.fromBinReviewRequired,
          fromBinReviewReason: review.fromBinReviewReason,
          fromBinReviewBlocksRelease: review.fromBinReviewBlocksRelease,
          fromBinReviewBlocksExport: review.fromBinReviewBlocksExport,
          fromBinManualCorrectionClearsWarning: review.fromBinManualCorrectionClearsWarning,
          fromBinSystemLookupStatus: String(line && line.fromBinSystemLookupStatus || "").trim(),
          fromBinSystemLookupReason: String(line && line.fromBinSystemLookupReason || "").trim(),
          fromBinSystemLookupValue: String(line && line.fromBinSystemLookupValue || "").trim(),
          fromBinSystemLookupCandidates: Array.isArray(line && line.fromBinSystemLookupCandidates) ? line.fromBinSystemLookupCandidates : [],
          fromBinOcrRawValue: String(line && line.fromBinOcrRawValue || "").trim()
        };
      });
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
    var expectedBestellscheinRows = countBestellscheinCandidateRows(pickingLines);
    var expectedTableRows = Math.max(expectedWarehouseRows, expectedBestellscheinRows);
    var positionDiagnostics = buildImportPositionDiagnostics(pickingLines, normalizedParsed.lines || [], {
      fromBinRechecks: normalizedInfo.fromBinRechecks
    });
    var loadingSlipDiagnostics = buildLoadingSlipDiagnostics(
      lines,
      loadingSlipLines,
      loadingSlipAudit,
      normalizedInfo.loadingSlipCandidates
    );

    return {
      source: normalizedInfo.source || "",
      documentType: normalizedInfo.documentType || importDocumentType(source, normalizedParsed),
      imageOnlyPdf: normalizedInfo.imageOnlyPdf === true,
      orientationProbeAttempted: normalizedInfo.orientationProbeAttempted === true,
      orientationProbeCandidates: Array.isArray(normalizedInfo.orientationProbeCandidates) ? normalizedInfo.orientationProbeCandidates : [],
      selectedOrientation: normalizedInfo.selectedOrientation != null ? normalizedInfo.selectedOrientation : "",
      orientationTieBreakAttempted: normalizedInfo.orientationTieBreakAttempted === true,
      orientationTieBreakRotations: Array.isArray(normalizedInfo.orientationTieBreakRotations) ? normalizedInfo.orientationTieBreakRotations : [],
      orientationTieBreakCandidates: Array.isArray(normalizedInfo.orientationTieBreakCandidates) ? normalizedInfo.orientationTieBreakCandidates : [],
      orientationTieBreakRejectReason: normalizedInfo.orientationTieBreakRejectReason || "",
      bestellscheinPageNotice: normalizedInfo.bestellscheinPageNotice || "",
      siBestellscheinAccepted: normalizedInfo.siBestellscheinAccepted === true,
      siBestellscheinRejectReason: normalizedInfo.siBestellscheinRejectReason || "",
      parserPath: inferParserPath(source, normalizedParsed, {
        warehouseLike: warehouseLike,
        expectedWarehouseRows: expectedWarehouseRows,
        expectedBestellscheinRows: expectedBestellscheinRows,
        parsedLineCount: parsedLineCount,
        loadingSlipLines: loadingSlipLines.length
      }),
      importAcceptanceReason: importAcceptanceReason(normalizedInfo),
      importAcceptanceFlags: importAcceptanceFlags(normalizedInfo),
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
      ocrStepCount: normalizedInfo.ocrStepCount != null ? normalizedInfo.ocrStepCount : 0,
      ocrComputedSteps: normalizedInfo.ocrComputedSteps != null ? normalizedInfo.ocrComputedSteps : 0,
      ocrSkippedSteps: Array.isArray(normalizedInfo.ocrSkippedSteps) ? normalizedInfo.ocrSkippedSteps : [],
      ocrBudget: normalizedInfo.ocrBudget || null,
      ocrStage: normalizedInfo.ocrStage || "",
      ocrAbortReason: normalizedInfo.ocrAbortReason || "",
      fromBinRechecks: Array.isArray(normalizedInfo.fromBinRechecks) ? normalizedInfo.fromBinRechecks : [],
      loadingSlipExpected: loadingSlipExpected,
      loadingSlipAttached: loadingSlipAudit.attached,
      loadingSlipIssues: loadingSlipAudit.issues,
      loadingSlipCandidates: Array.isArray(normalizedInfo.loadingSlipCandidates) ? normalizedInfo.loadingSlipCandidates : [],
      loadingSlipFallbackStatus: normalizedInfo.loadingSlipFallbackStatus || "",
      loadingSlipWarning: normalizedInfo.loadingSlipWarning || "",
      loadingSlipDiagnostics: loadingSlipDiagnostics,
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
      expectedBestellscheinRows: expectedBestellscheinRows,
      expectedTableRows: expectedTableRows,
      importedPositionCount: parsedLineCount,
      parsedLineCount: parsedLineCount,
      discardedWarehouseRows: Math.max(0, expectedWarehouseRows - parsedLineCount),
      candidateLineCount: positionDiagnostics.candidateLineCount,
      rawLineDiagnostics: positionDiagnostics.rawLineDiagnostics,
      rawPositionSegments: positionDiagnostics.rawPositionSegments,
      unimportedCandidateLines: positionDiagnostics.unimportedCandidateLines,
      positionFieldDiagnostics: positionDiagnostics.positions,
      fieldSafetySummary: positionDiagnostics.fieldSafetySummary,
      importWarningReasons: importWarningReasons({
        source: source,
        parsedLineCount: parsedLineCount,
        expectedTableRows: expectedTableRows,
        loadingSlipDiagnostics: loadingSlipDiagnostics,
        positions: positionDiagnostics.positions
      }),
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

  function buildPickingImportLineDiagnostics(rawLines, finalLines, context) {
    var sourceLines = Array.isArray(rawLines) ? rawLines : [];
    var resultLines = Array.isArray(finalLines) ? finalLines : sourceLines;
    var sourceText = context && typeof context.text === "string" ? context.text : "";
    var sourceLineDiagnostics = sourceText
      ? buildImportPositionDiagnostics(nonEmptyTextLines(sourceText), resultLines, {
        fromBinRechecks: context && context.diagnostics && context.diagnostics.fromBinRechecks
      })
      : { positions: [] };
    var positionDetails = sourceLineDiagnostics.positions || [];

    return sourceLines.map(function (line, index) {
      var finalLine = resultLines[index] || line || {};
      var detail = positionDetails[index] || {};
      var rawFromBin = String((line && line.fromBin) || "").trim();
      var finalFromBin = String((finalLine && finalLine.fromBin) || "").trim();
      var warehouseOrder = String((line && line.warehouseOrder) || finalLine.warehouseOrder || "").trim();
      var fromHandlingUnit = String((line && line.fromHandlingUnit) || finalLine.fromHandlingUnit || "").trim();
      var product = String((line && line.product) || finalLine.product || "").trim();
      var shape = pickingFromBinShapeDiagnostic(rawFromBin);
      var finalShape = pickingFromBinShapeDiagnostic(finalFromBin);
      var review = fromBinReviewDiagnostics(finalFromBin, finalShape);
      var recheck = detail.fromBinRecheck || matchingFromBinRecheckForLine(
        finalLine,
        index,
        context && context.diagnostics && context.diagnostics.fromBinRechecks
      );

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
        reason: pickingImportBinDiagnosticReason(rawFromBin, finalFromBin),
        rawSegment: detail.rawSegment || "",
        rawLineNumbers: detail.rawLineNumbers || [],
        parserPath: detail.parserPath || "",
        detectedFields: detail.detectedFields || detectedImportFields(finalLine),
        fieldSafety: detail.fieldSafety || buildFieldSafety(finalLine, null),
        suspiciousReasons: uniqueStrings((detail.suspiciousReasons || suspiciousFieldReasons(finalLine)).concat(suspiciousShapeReasons(shape))),
        fromBinShapeStatus: shape.status,
        fromBinShapeReason: shape.reason,
        fromBinRawValue: rawFromBin,
        fromBinSuggestedCandidates: shape.suggestedCandidates,
        fromBinReviewRequired: review.fromBinReviewRequired,
        fromBinReviewReason: review.fromBinReviewReason,
        fromBinReviewBlocksRelease: review.fromBinReviewBlocksRelease,
        fromBinReviewBlocksExport: review.fromBinReviewBlocksExport,
        fromBinManualCorrectionClearsWarning: review.fromBinManualCorrectionClearsWarning,
        fromBinRecheckAttempted: recheck.attempted,
        fromBinRecheckCandidates: recheck.candidates,
        fromBinRecheckSuggestion: recheck.suggestion,
        fromBinRecheckConfidence: recheck.confidence,
        fromBinRecheckAutoApplied: false,
        fromBinRecheckReason: recheck.reason,
        fromBinVisualRecheckAttempted: recheck.visualAttempted,
        fromBinVisualRecheckSource: recheck.visualSource,
        fromBinVisualRecheckCandidates: recheck.visualCandidates,
        fromBinVisualRecheckBestCandidate: recheck.visualBestCandidate,
        fromBinVisualRecheckConfidence: recheck.visualConfidence,
        fromBinVisualRecheckReason: recheck.visualReason,
        fromBinVisualRecheckAutoApplied: false,
        fromBinOcrCandidateValues: ocrCandidateBinValuesForLine(line, index, context && context.diagnostics),
        fromBinSystemLookupStatus: String(finalLine && finalLine.fromBinSystemLookupStatus || "").trim(),
        fromBinSystemLookupReason: String(finalLine && finalLine.fromBinSystemLookupReason || "").trim(),
        fromBinSystemLookupValue: String(finalLine && finalLine.fromBinSystemLookupValue || "").trim(),
        fromBinSystemLookupCandidates: Array.isArray(finalLine && finalLine.fromBinSystemLookupCandidates) ? finalLine.fromBinSystemLookupCandidates : [],
        fromBinOcrRawValue: String(finalLine && finalLine.fromBinOcrRawValue || "").trim()
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
      imageOnlyPdf: normalizedDiagnostics.imageOnlyPdf === true,
      orientationProbeAttempted: normalizedDiagnostics.orientationProbeAttempted === true,
      orientationProbeCandidates: normalizedDiagnostics.orientationProbeCandidates || [],
      selectedOrientation: normalizedDiagnostics.selectedOrientation != null ? normalizedDiagnostics.selectedOrientation : "",
      orientationTieBreakAttempted: normalizedDiagnostics.orientationTieBreakAttempted === true,
      orientationTieBreakRotations: normalizedDiagnostics.orientationTieBreakRotations || [],
      orientationTieBreakCandidates: normalizedDiagnostics.orientationTieBreakCandidates || [],
      orientationTieBreakRejectReason: normalizedDiagnostics.orientationTieBreakRejectReason || "",
      bestellscheinPageNotice: normalizedDiagnostics.bestellscheinPageNotice || "",
      siBestellscheinAccepted: normalizedDiagnostics.siBestellscheinAccepted === true,
      siBestellscheinRejectReason: normalizedDiagnostics.siBestellscheinRejectReason || "",
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
      ocrTimings: normalizedDiagnostics.ocrTimings || [],
      ocrStepCount: normalizedDiagnostics.ocrStepCount != null ? normalizedDiagnostics.ocrStepCount : 0,
      ocrComputedSteps: normalizedDiagnostics.ocrComputedSteps != null ? normalizedDiagnostics.ocrComputedSteps : 0,
      ocrSkippedSteps: normalizedDiagnostics.ocrSkippedSteps || [],
      ocrBudget: normalizedDiagnostics.ocrBudget || null,
      ocrStage: normalizedDiagnostics.ocrStage || "",
      ocrAbortReason: normalizedDiagnostics.ocrAbortReason || "",
      fromBinRechecks: normalizedDiagnostics.fromBinRechecks || [],
      loadingSlipExpected: normalizedDiagnostics.loadingSlipExpected != null ? normalizedDiagnostics.loadingSlipExpected : 0,
      loadingSlipAttached: normalizedDiagnostics.loadingSlipAttached != null ? normalizedDiagnostics.loadingSlipAttached : 0,
      loadingSlipCandidates: normalizedDiagnostics.loadingSlipCandidates || [],
      loadingSlipFallbackStatus: normalizedDiagnostics.loadingSlipFallbackStatus || "",
      loadingSlipWarning: normalizedDiagnostics.loadingSlipWarning || "",
      loadingSlipDiagnostics: normalizedDiagnostics.loadingSlipDiagnostics || {},
      parserPath: normalizedDiagnostics.parserPath || "",
      importAcceptanceReason: normalizedDiagnostics.importAcceptanceReason || "",
      importAcceptanceFlags: normalizedDiagnostics.importAcceptanceFlags || [],
      importWarningReasons: normalizedDiagnostics.importWarningReasons || [],
      qualityScore: normalizedDiagnostics.qualityScore != null ? normalizedDiagnostics.qualityScore : null,
      minimumQualityScore: normalizedDiagnostics.minimumQualityScore != null
        ? normalizedDiagnostics.minimumQualityScore
        : finiteOrFallback(deps.minimumQualityScore, 0),
      qualityAccepted: normalizedDiagnostics.qualityAccepted === true,
      expectedTableRows: normalizedDiagnostics.expectedTableRows != null ? normalizedDiagnostics.expectedTableRows : 0,
      importedPositionCount: normalizedDiagnostics.importedPositionCount != null ? normalizedDiagnostics.importedPositionCount : positions.length,
      unimportedCandidateLines: normalizedDiagnostics.unimportedCandidateLines || [],
      fieldSafetySummary: normalizedDiagnostics.fieldSafetySummary || {},
      binValidationApplied: false,
      binCorrectionApplied: false,
      note: "Keine Stellplatzvalidierung, keine Stellplatzkorrektur, kein Regelabgleich im PDF-Importpfad.",
      positions: positions
    });
  }

  function buildImportPositionDiagnostics(rawLines, parsedLines, context) {
    var sourceLines = Array.isArray(rawLines) ? rawLines : [];
    var rechecks = normalizeFromBinRechecks(context && context.fromBinRechecks);
    var normalLines = (Array.isArray(parsedLines) ? parsedLines : [])
      .filter(function (line) {
        return !line || line.lineType !== "loading-slip";
      });
    var candidateRows = collectRawCandidateRows(sourceLines);
    var matchedCandidateIndexes = new Set();
    var positions = normalLines.map(function (line, index) {
      var candidate = matchCandidateRow(line, candidateRows, matchedCandidateIndexes, index);
      if (candidate) matchedCandidateIndexes.add(candidate.index);
      var fieldSafety = buildFieldSafety(line, candidate);
      var fields = detectedImportFields(line);
      var shape = pickingFromBinShapeDiagnostic(fields.fromBin);
      var review = fromBinReviewDiagnostics(fields.fromBin, shape);
      var recheck = matchingFromBinRecheckForLine(line, index, rechecks);
      return {
        position: index + 1,
        parserPath: inferPositionParserPath(line, candidate),
        rawSegment: candidate ? candidate.rawText : "",
        rawLineNumbers: candidate ? candidate.lineNumbers : [],
        rawCandidateType: candidate ? candidate.type : "",
        detectedFields: fields,
        fieldSafety: fieldSafety,
        suspiciousReasons: uniqueStrings(suspiciousFieldReasons(line).concat(suspiciousShapeReasons(shape))),
        fromBinShapeStatus: shape.status,
        fromBinShapeReason: shape.reason,
        fromBinRawValue: fields.fromBin,
        fromBinSuggestedCandidates: shape.suggestedCandidates,
        fromBinReviewRequired: review.fromBinReviewRequired,
        fromBinReviewReason: review.fromBinReviewReason,
        fromBinReviewBlocksRelease: review.fromBinReviewBlocksRelease,
        fromBinReviewBlocksExport: review.fromBinReviewBlocksExport,
        fromBinManualCorrectionClearsWarning: review.fromBinManualCorrectionClearsWarning,
        fromBinRecheck: recheck,
        fromBinRecheckAttempted: recheck.attempted,
        fromBinRecheckCandidates: recheck.candidates,
        fromBinRecheckSuggestion: recheck.suggestion,
        fromBinRecheckConfidence: recheck.confidence,
        fromBinRecheckAutoApplied: false,
        fromBinRecheckReason: recheck.reason,
        fromBinVisualRecheckAttempted: recheck.visualAttempted,
        fromBinVisualRecheckSource: recheck.visualSource,
        fromBinVisualRecheckCandidates: recheck.visualCandidates,
        fromBinVisualRecheckBestCandidate: recheck.visualBestCandidate,
        fromBinVisualRecheckConfidence: recheck.visualConfidence,
        fromBinVisualRecheckReason: recheck.visualReason,
        fromBinVisualRecheckAutoApplied: false,
        fromBinSystemLookupStatus: String(line && line.fromBinSystemLookupStatus || "").trim(),
        fromBinSystemLookupReason: String(line && line.fromBinSystemLookupReason || "").trim(),
        fromBinSystemLookupValue: String(line && line.fromBinSystemLookupValue || "").trim(),
        fromBinSystemLookupCandidates: Array.isArray(line && line.fromBinSystemLookupCandidates) ? line.fromBinSystemLookupCandidates : [],
        fromBinOcrRawValue: String(line && line.fromBinOcrRawValue || "").trim(),
        diagnosticOnly: true
      };
    });
    var unimportedCandidateLines = candidateRows
      .filter(function (candidate) {
        return !matchedCandidateIndexes.has(candidate.index);
      })
      .map(function (candidate) {
        return {
          index: candidate.index + 1,
          type: candidate.type,
          parserPath: candidate.parserPath,
          rawText: candidate.rawText,
          lineNumbers: candidate.lineNumbers
        };
      });

    return {
      candidateLineCount: candidateRows.length,
      rawLineDiagnostics: {
        totalRawLines: sourceLines.length,
        candidateRows: candidateRows.map(function (candidate) {
          return {
            index: candidate.index + 1,
            type: candidate.type,
            parserPath: candidate.parserPath,
            rawText: candidate.rawText,
            lineNumbers: candidate.lineNumbers
          };
        })
      },
      rawPositionSegments: positions.map(function (position) {
        return {
          position: position.position,
          parserPath: position.parserPath,
          rawSegment: position.rawSegment,
          rawLineNumbers: position.rawLineNumbers
        };
      }),
      unimportedCandidateLines: unimportedCandidateLines,
      positions: positions,
      fieldSafetySummary: summarizeFieldSafety(positions)
    };
  }

  function collectRawCandidateRows(lines) {
    var rows = [];
    var current = null;

    (Array.isArray(lines) ? lines : []).forEach(function (line, index) {
      var type = rawCandidateLineType(line);
      if (type) {
        if (current) rows.push(current);
        current = {
          index: rows.length,
          type: type,
          parserPath: parserPathForRawType(type, line),
          rawLines: [String(line || "").trim()],
          lineNumbers: [index + 1]
        };
        return;
      }

      if (current && shouldAttachRawContinuation(line)) {
        current.rawLines.push(String(line || "").trim());
        current.lineNumbers.push(index + 1);
      }
    });

    if (current) rows.push(current);
    return rows.map(function (row, index) {
      return Object.assign({}, row, {
        index: index,
        rawText: row.rawLines.join(" ")
      });
    });
  }

  function rawCandidateLineType(line) {
    var text = String(line || "").trim();
    if (!text || /lagerauftrag|lageraufgabe|produktbeschreibung|basis|nach-lagerplatz|von-lagerpla/i.test(text)) return "";
    if (/lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(text)) return "ladeliste";
    if (/^\d{1,4}(?:[.)\s-]+).+/.test(text) && !/^\d{6,14}\b/.test(text)) return "freitext-position";
    if (/^\d{6,14}\b/.test(text)) {
      if (/\b\d{3}-[A-Z0-9]+-[A-Z0-9]+\b/i.test(text) || /\b(?:90|80)\d{2}[-/][A-Z0-9-]+\b/i.test(text)) {
        return "lageraufgabe";
      }
      if (/\b(?:ST|Stk|Stueck|Stück|PC|PCS)\b/i.test(text) && /[A-Za-z]/.test(text)) return "bestellschein";
      return "lageraufgabe";
    }
    return "";
  }

  function parserPathForRawType(type, line) {
    if (type === "bestellschein") return "bestellschein-strict-or-fallback";
    if (type === "ladeliste") return "ladelistenparser";
    if (type === "freitext-position") return "freitext-position";
    if (type === "lageraufgabe") {
      return /\b\d{3}-[A-Z0-9]+-[A-Z0-9]+\b/i.test(String(line || ""))
        ? "lageraufgabe-normal-or-columns"
        : "lageraufgabe-without-bin-or-loose";
    }
    return "nicht-bewertet";
  }

  function shouldAttachRawContinuation(line) {
    var text = String(line || "").trim();
    if (!text) return false;
    if (/^(summe|gesamt|mwst|steuer|netto|brutto)\b/i.test(text)) return false;
    return rawCandidateLineType(text) === "";
  }

  function matchCandidateRow(line, candidates, usedIndexes, fallbackIndex) {
    var scored = (Array.isArray(candidates) ? candidates : [])
      .filter(function (candidate) {
        return !usedIndexes.has(candidate.index);
      })
      .map(function (candidate) {
        return {
          candidate: candidate,
          score: candidateMatchScore(line, candidate.rawText)
        };
      })
      .sort(function (left, right) {
        return right.score - left.score;
      });
    if (scored.length && scored[0].score >= 2) return scored[0].candidate;
    return candidates[fallbackIndex] && !usedIndexes.has(candidates[fallbackIndex].index)
      ? candidates[fallbackIndex]
      : null;
  }

  function candidateMatchScore(line, rawText) {
    var fields = detectedImportFields(line);
    var score = 0;
    [
      ["warehouseOrder", 3],
      ["fromHandlingUnit", 3],
      ["fromBin", 3],
      ["product", 3],
      ["targetQty", 2],
      ["unit", 1],
      ["toBin", 2]
    ].forEach(function (entry) {
      if (fieldAppearsInRawText(fields[entry[0]], rawText)) score += entry[1];
    });
    if (fieldAppearsInRawText(descriptionProbe(fields.description), rawText)) score += 1;
    return score;
  }

  function detectedImportFields(line) {
    return {
      warehouseOrder: String(line && line.warehouseOrder || "").trim(),
      fromHandlingUnit: String(line && line.fromHandlingUnit || "").trim(),
      fromBin: String(line && line.fromBin || "").trim(),
      product: String(line && line.product || "").trim(),
      description: String(line && line.description || "").trim(),
      targetQty: String(line && line.targetQty || "").trim(),
      unit: String(line && line.unit || "").trim(),
      toBin: String(line && line.toBin || "").trim()
    };
  }

  function buildFieldSafety(line, candidate) {
    var fields = detectedImportFields(line);
    var rawText = candidate ? candidate.rawText : "";
    var shape = pickingFromBinShapeDiagnostic(fields.fromBin);
    var suspiciousFromBin = suspiciousFieldReasons(line).length || ["suspicious", "invalid"].indexOf(shape.status) !== -1;
    return {
      warehouseOrder: fieldSafety(fields.warehouseOrder, rawText),
      fromHandlingUnit: fieldSafety(fields.fromHandlingUnit, rawText),
      fromBin: suspiciousFromBin ? "verdaechtig" : fieldSafety(fields.fromBin, rawText),
      product: fieldSafety(fields.product, rawText),
      description: fieldSafety(descriptionProbe(fields.description), rawText),
      targetQty: fieldSafety(fields.targetQty, rawText),
      unit: fields.unit && !fieldAppearsInRawText(fields.unit, rawText) ? "fallback" : fieldSafety(fields.unit, rawText),
      toBin: fieldSafety(fields.toBin, rawText)
    };
  }

  function ocrCandidateBinValuesForLine(line, index, diagnostics) {
    var candidates = diagnostics && Array.isArray(diagnostics.ocrCandidates) ? diagnostics.ocrCandidates : [];
    if (!candidates.length) return [];
    return candidates.map(function (candidate) {
      var position = matchingOcrCandidatePosition(line, index, candidate);
      if (!position) return null;
      var fromBin = String(position.fromBin || "").trim();
      var shape = pickingFromBinShapeDiagnostic(fromBin);
      return {
        label: candidate.label || "",
        scale: candidate.scale || "",
        dpi: candidate.dpi || "",
        rotation: candidate.rotation != null ? candidate.rotation : "",
        score: candidate.score != null ? candidate.score : 0,
        position: position.position || "",
        warehouseOrder: position.warehouseOrder || "",
        product: position.product || "",
        targetQty: position.targetQty || "",
        toBin: position.toBin || "",
        fromBin: fromBin,
        fromBinShapeStatus: shape.status,
        fromBinSuggestedCandidates: shape.suggestedCandidates
      };
    }).filter(Boolean);
  }

  function matchingOcrCandidatePosition(line, index, candidate) {
    var positions = Array.isArray(candidate && candidate.positions) ? candidate.positions : [];
    if (!positions.length) return null;
    var fields = detectedImportFields(line);
    var byOrderProduct = positions.find(function (position) {
      return fields.warehouseOrder
        && fields.product
        && String(position.warehouseOrder || "").trim() === fields.warehouseOrder
        && String(position.product || "").trim() === fields.product;
    });
    if (byOrderProduct) return byOrderProduct;
    var byProductQuantity = positions.find(function (position) {
      return fields.product
        && fields.targetQty
        && String(position.product || "").trim() === fields.product
        && String(position.targetQty || "").trim() === fields.targetQty;
    });
    if (byProductQuantity) return byProductQuantity;
    return positions[index] || null;
  }

  function normalizeFromBinRechecks(rechecks) {
    return (Array.isArray(rechecks) ? rechecks : []).map(function (entry) {
      return {
        position: Number(entry && entry.position || 0),
        tableRowKey: String(entry && entry.tableRowKey || "").trim(),
        warehouseOrder: String(entry && entry.warehouseOrder || "").trim(),
        fromHandlingUnit: String(entry && entry.fromHandlingUnit || "").trim(),
        product: String(entry && entry.product || "").trim(),
        targetQty: String(entry && entry.targetQty || "").trim(),
        rawValue: String(entry && (entry.rawValue || entry.fromBinRawValue) || "").trim(),
        method: String(entry && entry.method || "").trim(),
        attempted: entry && entry.attempted === true,
        candidates: Array.isArray(entry && entry.candidates) ? entry.candidates : [],
        suggestion: String(entry && entry.suggestion || "").trim(),
        confidence: finiteOrFallback(entry && entry.confidence, 0),
        autoApplied: false,
        reason: String(entry && entry.reason || "").trim(),
        visualAttempted: Boolean(entry && (entry.visualAttempted === true || entry.fromBinVisualRecheckAttempted === true)),
        visualSource: String(entry && (entry.visualSource || entry.fromBinVisualRecheckSource) || "").trim(),
        visualCandidates: Array.isArray(entry && entry.visualCandidates)
          ? entry.visualCandidates
          : Array.isArray(entry && entry.fromBinVisualRecheckCandidates) ? entry.fromBinVisualRecheckCandidates : [],
        visualBestCandidate: String(entry && (entry.visualBestCandidate || entry.fromBinVisualRecheckBestCandidate) || "").trim(),
        visualConfidence: finiteOrFallback(entry && (entry.visualConfidence != null ? entry.visualConfidence : entry.fromBinVisualRecheckConfidence), 0),
        visualReason: String(entry && (entry.visualReason || entry.fromBinVisualRecheckReason) || "").trim(),
        visualAutoApplied: false
      };
    });
  }

  function emptyFromBinRecheckDiagnostic(line, index, rechecks) {
    var fields = detectedImportFields(line);
    var shape = pickingFromBinShapeDiagnostic(fields.fromBin);
    var reason = "";
    if (["suspicious", "invalid"].indexOf(shape.status) !== -1 && Array.isArray(rechecks) && !rechecks.length) {
      reason = "Von-Lagerplatz-Zell-Recheck durch Richtlinie deaktiviert.";
    }
    return {
      position: index + 1,
      tableRowKey: [fields.warehouseOrder, fields.fromHandlingUnit, fields.product].filter(Boolean).join(" | "),
      warehouseOrder: fields.warehouseOrder,
      fromHandlingUnit: fields.fromHandlingUnit,
      product: fields.product,
      targetQty: fields.targetQty,
      rawValue: fields.fromBin,
      method: "",
      attempted: false,
      candidates: [],
      suggestion: "",
      confidence: 0,
      autoApplied: false,
      reason: reason,
      visualAttempted: false,
      visualSource: "",
      visualCandidates: [],
      visualBestCandidate: "",
      visualConfidence: 0,
      visualReason: "",
      visualAutoApplied: false
    };
  }

  function matchingFromBinRecheckForLine(line, index, rechecks) {
    var normalized = normalizeFromBinRechecks(rechecks);
    if (!normalized.length) return emptyFromBinRecheckDiagnostic(line, index, normalized);
    var fields = detectedImportFields(line);
    var tableRowKey = [fields.warehouseOrder, fields.fromHandlingUnit, fields.product].filter(Boolean).join(" | ");
    var byKey = normalized.find(function (entry) {
      return entry.tableRowKey && entry.tableRowKey === tableRowKey;
    });
    if (byKey) return byKey;
    var byFields = normalized.find(function (entry) {
      return entry.warehouseOrder === fields.warehouseOrder
        && entry.product === fields.product
        && (!entry.rawValue || entry.rawValue === fields.fromBin);
    });
    if (byFields) return byFields;
    return normalized.find(function (entry) {
      return entry.position === index + 1;
    }) || emptyFromBinRecheckDiagnostic(line, index, normalized);
  }

  function fieldSafety(value, rawText) {
    if (!String(value || "").trim()) return "fehlt";
    if (!String(rawText || "").trim()) return "nicht-bewertet";
    return fieldAppearsInRawText(value, rawText) ? "sicher" : "fallback";
  }

  function fieldAppearsInRawText(value, rawText) {
    var normalizedValue = compactFieldValue(value);
    if (!normalizedValue) return false;
    return compactFieldValue(rawText).indexOf(normalizedValue) !== -1;
  }

  function compactFieldValue(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "");
  }

  function descriptionProbe(description) {
    return String(description || "")
      .split(/\s+/)
      .filter(function (part) {
        return part.length >= 4;
      })
      .slice(0, 3)
      .join(" ");
  }

  function suspiciousFieldReasons(line) {
    var fromBin = String(line && line.fromBin || "").trim();
    if (!fromBin) return [];
    return [
      ["Nach-Lagerplatz", line && line.toBin],
      ["HU/LE", line && line.fromHandlingUnit],
      ["Artikelnummer", line && line.product],
      ["Menge", line && line.targetQty]
    ].filter(function (entry) {
      return fromBin && String(entry[1] || "").trim() && fromBin === String(entry[1] || "").trim();
    }).map(function (entry) {
      return "Von-Lagerplatz entspricht " + entry[0] + ".";
    });
  }

  function suspiciousShapeReasons(shape) {
    if (!shape || ["suspicious", "invalid"].indexOf(shape.status) === -1) return [];
    return shape.reason ? [shape.reason] : [];
  }

  function fromBinReviewDiagnostics(value, shape) {
    var currentShape = shape || pickingFromBinShapeDiagnostic(value);
    var required = ["suspicious", "invalid"].indexOf(currentShape.status) !== -1;
    var raw = String(value || "").trim();
    return {
      fromBinReviewRequired: required,
      fromBinReviewReason: required
        ? "Von-Lagerplatz OCR-unsicher: " + raw + ". Bitte anhand PDF pruefen und korrigieren."
        : "",
      fromBinReviewBlocksRelease: required,
      fromBinReviewBlocksExport: required,
      fromBinManualCorrectionClearsWarning: required
    };
  }

  function pickingFromBinShapeDiagnostic(value) {
    var sharedRules = storageBinRules();
    if (sharedRules && typeof sharedRules.pickingFromBinShapeDiagnostic === "function") {
      return sharedRules.pickingFromBinShapeDiagnostic(value);
    }

    var raw = String(value || "").trim();
    var normalized = normalizeBinShapeText(raw);
    if (!normalized) {
      return {
        status: "missing",
        reason: "Kein Von-Lagerplatz erkannt.",
        rawValue: raw,
        normalizedValue: normalized,
        suggestedCandidates: []
      };
    }
    if (isValidPickingFromBinShape(normalized)) {
      return {
        status: "valid",
        reason: "Von-Lagerplatz entspricht einem bekannten Muster.",
        rawValue: raw,
        normalizedValue: normalized,
        suggestedCandidates: []
      };
    }
    var suggestions = suggestedPickingFromBinCandidates(normalized);
    if (suggestions.length) {
      return {
        status: "suspicious",
        reason: "SSI-Von-Lagerplatz wirkt formal verdaechtig; moeglicher OCR-Lesefehler im Fachbereich.",
        rawValue: raw,
        normalizedValue: normalized,
        suggestedCandidates: suggestions
      };
    }
    if (looksLikeKnownPickingBinFamily(normalized)) {
      return {
        status: "invalid",
        reason: "Von-Lagerplatz verletzt bekannte Lagerplatzmuster.",
        rawValue: raw,
        normalizedValue: normalized,
        suggestedCandidates: []
      };
    }
    return {
      status: "unknown",
      reason: "Von-Lagerplatz passt zu keinem bekannten Muster und keinem gezielten OCR-Vorschlag.",
      rawValue: raw,
      normalizedValue: normalized,
      suggestedCandidates: []
    };
  }

  function storageBinRules() {
    return window.HLogistikStorageBinRules || null;
  }

  function normalizeBinShapeText(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[â€â€‘â€’â€“â€”]/g, "-")
      .toUpperCase();
  }

  function isValidPickingFromBinShape(bin) {
    return /^(?:002|022)-H\d{1,2}-R\d{1,3}$/i.test(bin)
      || /^002-H1-A[A-L]1$/i.test(bin)
      || /^002-H1-SA[A-T](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)
      || /^002-H3-S[O-Z](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)
      || /^002-H4-S[A-N](?:[1-9]|1[0-2])[A-D][1-4]$/i.test(bin);
  }

  function looksLikeKnownPickingBinFamily(bin) {
    return /^(?:002|022)-H\d{1,2}-[A-Z0-9]/i.test(bin);
  }

  function suggestedPickingFromBinCandidates(bin) {
    return uniqueStrings(
      suggestedSsiShelfCandidates(bin)
        .filter(function (candidate) {
          return candidate !== bin && isValidPickingFromBinShape(candidate);
        })
    ).slice(0, 5);
  }

  function suggestedSsiShelfCandidates(bin) {
    var candidates = [];
    var h3h4 = String(bin || "").match(/^(002-H([34])-S)([A-Z])([A-Z0-9]{1,2})([A-D])([1-4])$/i);
    if (h3h4) {
      var prefix = h3h4[1].toUpperCase();
      var group = h3h4[3].toUpperCase();
      var shelf = h3h4[4].toUpperCase();
      var bay = h3h4[5].toUpperCase();
      var level = h3h4[6].toUpperCase();
      ocrDigitShelfVariants(shelf).forEach(function (variant) {
        candidates.push(prefix + group + variant + bay + level);
      });
    }

    var h1 = String(bin || "").match(/^(002-H1-SA)([A-T])([A-Z0-9]{1,2})([A-D])([1-3])$/i);
    if (h1) {
      var h1Prefix = h1[1].toUpperCase();
      var h1Group = h1[2].toUpperCase();
      var h1Shelf = h1[3].toUpperCase();
      var h1Bay = h1[4].toUpperCase();
      var h1Level = h1[5].toUpperCase();
      ocrDigitShelfVariants(h1Shelf).forEach(function (variant) {
        candidates.push(h1Prefix + h1Group + variant + h1Bay + h1Level);
      });
    }
    return candidates;
  }

  function ocrDigitShelfVariants(value) {
    var source = String(value || "").toUpperCase();
    var replacements = {
      S: ["5"],
      O: ["0"],
      Q: ["0"],
      D: ["0"],
      I: ["1"],
      L: ["1"],
      B: ["8"],
      Z: ["2"]
    };
    var variants = [];
    for (var index = 0; index < source.length; index += 1) {
      var chars = replacements[source[index]] || [];
      chars.forEach(function (replacement) {
        variants.push(source.slice(0, index) + replacement + source.slice(index + 1));
      });
    }
    return variants;
  }

  function inferParserPath(source, parsed, info) {
    var lines = Array.isArray(parsed && parsed.lines) ? parsed.lines : [];
    if (lines.some(function (line) { return line && line.lineType === "loading-slip"; }) && !lines.some(function (line) { return line && line.lineType !== "loading-slip"; })) {
      return "ladelistenparser";
    }
    if (/bestellschein|entnahmeanweisungen/i.test(String(source || ""))) return "bestellschein-strict-or-fallback";
    if (info && info.warehouseLike) {
      if (lines.some(function (line) { return line && String(line.fromBin || "").trim(); })) return "lageraufgabe-normal-or-columns";
      if (lines.length) return "lageraufgabe-without-bin-or-loose";
      return "lageraufgabe-no-position";
    }
    if (lines.length) return "freitext-position";
    return "";
  }

  function inferPositionParserPath(line, candidate) {
    if (line && line.lineType === "loading-slip") return "ladelistenparser";
    if (candidate && candidate.parserPath) return candidate.parserPath;
    if (line && String(line.fromBin || "").trim()) return "lageraufgabe-normal-or-columns";
    if (line && String(line.warehouseOrder || "").trim()) return "lageraufgabe-without-bin-or-loose";
    return "nicht-bewertet";
  }

  function importAcceptanceReason(info) {
    var source = String(info && info.source || "").trim();
    if (!info || info.qualityAccepted !== true) return "";
    if (source === "pdf-text-si-bestellschein") return "si-bestellschein-akzeptiert";
    if (source === "pdf-text") return "pdf-text-akzeptiert";
    if (source === "ocr-candidate") return "ocr-kandidat-akzeptiert";
    if (source) return source + "-akzeptiert";
    return "akzeptiert";
  }

  function importAcceptanceFlags(info) {
    var flags = [];
    var source = String(info && info.source || "").trim();
    var selected = info && info.selectedCandidate || {};
    if (source === "pdf-text") flags.push("pdf-text-akzeptiert", "fast-accept");
    if (source === "pdf-text-si-bestellschein") flags.push("si-bestellschein-akzeptiert");
    if (source === "ocr-candidate") flags.push("ocr-kandidat-akzeptiert");
    if (source === "ocr-candidate" && Number(selected.rotation || 0) === 0) flags.push("stabiler-upright-kandidat");
    if (source === "ocr-candidate" && Number(selected.rotation || 0) !== 0) flags.push("fallback-rotation");
    if (info && info.loadingSlipFallback === true) flags.push("ladelisten-rotation-fallback");
    return flags;
  }

  function buildLoadingSlipDiagnostics(rawLines, loadingSlipLines, audit, candidates) {
    var normalizedCandidates = Array.isArray(candidates) ? candidates : [];
    var candidateDetails = normalizedCandidates.map(function (candidate) {
      var added = Array.isArray(candidate.added) ? candidate.added : [];
      var expected = Number(candidate.expected || 0);
      var parsed = Number(candidate.parsed || 0);
      return {
        label: candidate.label || "",
        expected: expected,
        parsed: parsed,
        barcodeDetected: added.length > 0,
        positionDetected: parsed > 0,
        attached: added.length > 0,
        attachedBarcodes: added,
        rejectedReason: expected && !parsed ? "position-oder-barcode-fehlt" : ""
      };
    });
    var rawDetected = loadingSlipLines.length > 0 || Number(audit && audit.expected || 0) > 0;
    var secondaryDetected = candidateDetails.some(function (candidate) {
      return candidate.expected > 0 || candidate.parsed > 0 || candidate.attached;
    });
    return {
      detectedInRawText: rawDetected,
      detectedInSecondaryCandidate: secondaryDetected,
      barcodeDetected: loadingSlipLines.some(function (line) {
        return String(line && line.barcode || "").trim();
      }) || candidateDetails.some(function (candidate) { return candidate.barcodeDetected; }),
      positionDetected: loadingSlipLines.length > 0 || candidateDetails.some(function (candidate) { return candidate.positionDetected; }),
      attached: Number(audit && audit.attached || 0) > 0 || candidateDetails.some(function (candidate) { return candidate.attached; }),
      expected: Number(audit && audit.expected || 0),
      attachedCount: Number(audit && audit.attached || 0),
      rejectedReasons: Array.isArray(audit && audit.issues) ? audit.issues : [],
      candidates: candidateDetails
    };
  }

  function importWarningReasons(info) {
    var reasons = [];
    if (String(info.source || "").trim() && !info.parsedLineCount) reasons.push("keine-positionen");
    if (info.expectedTableRows && info.expectedTableRows !== info.parsedLineCount) {
      reasons.push("erwartete-zeilen-ungleich-importierte-positionen");
    }
    if (info.loadingSlipDiagnostics && info.loadingSlipDiagnostics.detectedInRawText && !info.loadingSlipDiagnostics.attached) {
      reasons.push("ladeliste-vermutet-aber-nicht-angehaengt");
    }
    if ((info.positions || []).some(function (position) {
      return Object.values(position.fieldSafety || {}).indexOf("verdaechtig") !== -1;
    })) {
      reasons.push("verdaechtige-feldzuordnung");
    }
    if ((info.positions || []).some(function (position) {
      return ["suspicious", "invalid"].indexOf(position.fromBinShapeStatus) !== -1;
    })) {
      reasons.push("verdaechtiger-von-lagerplatz");
    }
    if ((info.positions || []).some(function (position) {
      return position.fieldSafety && position.fieldSafety.targetQty === "fehlt";
    })) {
      reasons.push("fehlende-menge");
    }
    return reasons;
  }

  function summarizeFieldSafety(positions) {
    return (Array.isArray(positions) ? positions : []).reduce(function (summary, position) {
      Object.keys(position.fieldSafety || {}).forEach(function (field) {
        var value = position.fieldSafety[field] || "nicht-bewertet";
        if (!summary[field]) summary[field] = {};
        summary[field][value] = (summary[field][value] || 0) + 1;
      });
      return summary;
    }, {});
  }

  function nonEmptyTextLines(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
  }

  function dependency(dependencies, name, fallback) {
    return dependencies && typeof dependencies[name] === "function" ? dependencies[name] : fallback;
  }

  function finiteOrFallback(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function uniqueStrings(values) {
    var seen = {};
    return (Array.isArray(values) ? values : [])
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(function (value) {
        if (!value || seen[value]) return false;
        seen[value] = true;
        return true;
      });
  }

  window.HLogistikImportDiagnostics = {
    pickingImportDiagnostics: pickingImportDiagnostics,
    logPickingImportDiagnostics: logPickingImportDiagnostics,
    pickingImportNoLinesMessage: pickingImportNoLinesMessage,
    buildPickingImportLineDiagnostics: buildPickingImportLineDiagnostics,
    pickingImportBinDiagnosticReason: pickingImportBinDiagnosticReason,
    logPickingImportLineDiagnostics: logPickingImportLineDiagnostics,
    pickingOcrCandidateDiagnostic: pickingOcrCandidateDiagnostic,
    pickingFromBinShapeDiagnostic: pickingFromBinShapeDiagnostic
  };
})();
