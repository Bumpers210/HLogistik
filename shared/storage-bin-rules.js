(function () {
  function cleanStorageBin(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/_/g, "-")
      .replace(/[‐‑‒–—]/g, "-");
  }

  function normalizeSsiStorageBin(value) {
    var raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    var text = cleanStorageBin(raw);
    var fixedHallBin = normalizeFixedHallBin(text);
    if (fixedHallBin !== undefined) return fixedHallBin;
    if (/^002-H2-S\d{4}$/i.test(text)) return text;

    var match = text.match(/^S(\d{4})$/i);
    if (match) return "002-H2-S" + match[1];
    match = text.match(/^(\d{4})$/);
    if (match) return "002-H2-S" + match[1];
    match = text.match(/^002-H[1-7]-S([A-Z0-9]+)$/i);
    if (match) return normalizeSsiShelfBin(match[1]) || text;
    if (/^002-H[1-7]-S[A-Z0-9]+$/i.test(text)) return text;
    match = text.match(/^(\d{1,2})([A-Z0-9]*)$/i);
    if (match) {
      var number = Number(match[1]);
      if (number >= 1 && number <= 69) return "002-H7-S" + text;
    }
    if (/^A[A-T][A-Z0-9]*$/i.test(text)) return "002-H1-S" + text;
    match = text.match(/^([A-Z])([A-Z0-9]*)$/i);
    if (match) {
      var first = match[1];
      if (first >= "A" && first <= "N") return "002-H4-S" + text;
      if (first >= "O" && first <= "Z") return "002-H3-S" + text;
    }
    return null;
  }

  function normalizeFixedHallBin(value) {
    var compact = String(value || "").replace(/-/g, "").toUpperCase();
    var match = compact.match(/^(?:022|002)?H1R(\d+)$/);
    if (match) return normalizeRangedHallBin("H1", "R", match[1], 1, 16);
    match = compact.match(/^(?:022)?H1(A[G-M]1)$/) || compact.match(/^002H1S(A[G-M]1)$/);
    if (match) return "022-H1-" + match[1];
    if (/^(?:022)?H1A[A-Z]1$/.test(compact) || /^H1SA[A-Z]1$/.test(compact)) return null;

    match = compact.match(/^(?:022|002)?H2R(\d+)$/);
    if (match) return normalizeRangedHallBin("H2", "R", match[1], 1, 56);
    match = compact.match(/^(?:022|002)?H3S?([P-Y][1-3])$/);
    if (match) return match[1] === "R3" || match[1] === "S3" ? null : "022-H3-" + match[1];
    if (/^(?:022|002)?H3S?[A-Z][1-3]$/.test(compact)) return null;

    match = compact.match(/^(?:022|002)?H4R(\d+)$/);
    if (match) return normalizeRangedHallBin("H4", "R", match[1], 1, 21);
    match = compact.match(/^(?:022|002)?H5R(\d+)$/);
    if (match) return normalizeRangedHallBin("H5", "R", match[1], 1, 50);
    match = compact.match(/^(?:022|002)?H7S?([2-5]R[1-3])$/);
    if (match) return "022-H7-" + match[1];
    if (/^(?:022|002)?H7S?\dR\d$/.test(compact)) return null;
    return undefined;
  }

  function normalizeRangedHallBin(hall, prefix, value, min, max) {
    var number = Number(value);
    if (!isWholeNumber(number) || number < min || number > max) return null;
    return "022-" + hall + "-" + prefix + number;
  }

  function isWholeNumber(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
  }

  function normalizeSsiShelfBin(shelfCode) {
    var text = String(shelfCode || "").trim().toUpperCase();
    if (!text) return "";
    var numeric = text.match(/^(\d{1,2})([A-Z0-9]*)$/i);
    if (numeric) {
      var number = Number(numeric[1]);
      if (number >= 1 && number <= 69) return "002-H7-S" + text;
    }
    if (/^A[A-T][A-Z0-9]*$/i.test(text)) return "002-H1-S" + text;
    var alpha = text.match(/^([A-Z])([A-Z0-9]*)$/i);
    if (alpha) {
      var first = alpha[1];
      if (first >= "A" && first <= "N") return "002-H4-S" + text;
      if (first >= "O" && first <= "Z") return "002-H3-S" + text;
    }
    return null;
  }

  function isValidPickingBin(value) {
    var bin = cleanStorageBin(value);
    return /^(?:002|022)-H[1-7]-R\d{1,3}$/i.test(bin)
      || /^002-H3-[O-Y][1-3]$/i.test(bin)
      || /^002-H1-A[A-L]1$/i.test(bin)
      || /^002-H1-SA[A-T](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)
      || /^002-H3-S[O-Z](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)
      || /^002-H4-S[A-N](?:[1-9]|1[0-2])[A-D][1-4]$/i.test(bin)
      || /^002-H7-S(?:[1-9]|[1-5]\d|6\d)[A-Z0-9]*$/i.test(bin);
  }

  function looksLikeKnownPickingBinFamily(value) {
    return /^(?:002|022)-H\d{1,2}-[A-Z0-9]/i.test(cleanStorageBin(value));
  }

  function suggestedPickingFromBinCandidates(value) {
    return uniqueStrings(suggestedSsiShelfCandidates(cleanStorageBin(value)).filter(function (candidate) {
      return candidate !== cleanStorageBin(value) && isValidPickingBin(candidate);
    })).slice(0, 5);
  }

  function suggestedSsiShelfCandidates(value) {
    var bin = cleanStorageBin(value);
    var candidates = [];
    var h3h4 = bin.match(/^(002-H([34])-S)([A-Z])([A-Z0-9]{1,2})([A-D])([1-4])$/i);
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
    var h1 = bin.match(/^(002-H1-SA)([A-T])([A-Z0-9]{1,2})([A-D])([1-3])$/i);
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
      I: ["1"],
      L: ["1"],
      Z: ["2"],
      B: ["8"]
    };
    var variants = [];
    for (var index = 0; index < source.length; index += 1) {
      var options = replacements[source[index]] || [];
      options.forEach(function (replacement) {
        variants.push(source.slice(0, index) + replacement + source.slice(index + 1));
      });
    }
    return uniqueStrings(variants);
  }

  function pickingFromBinShapeDiagnostic(value) {
    var raw = String(value || "").trim();
    var normalized = cleanStorageBin(raw);
    if (!normalized) {
      return {
        status: "missing",
        reason: "Von-Lagerplatz fehlt.",
        rawValue: raw,
        normalizedValue: "",
        suggestedCandidates: [],
        normalizedBySsiRule: ""
      };
    }
    if (isValidPickingBin(normalized)) {
      return {
        status: "valid",
        reason: "Von-Lagerplatz entspricht der SSI-Stellplatzregel.",
        rawValue: raw,
        normalizedValue: normalized,
        suggestedCandidates: [],
        normalizedBySsiRule: normalizeSsiStorageBin(normalized) || ""
      };
    }
    var suggestions = suggestedPickingFromBinCandidates(normalized);
    if (suggestions.length) {
      return {
        status: "suspicious",
        reason: "SSI-Von-Lagerplatz wirkt formal verdaechtig; moeglicher OCR-Lesefehler im Fachbereich.",
        rawValue: raw,
        normalizedValue: normalized,
        suggestedCandidates: suggestions,
        normalizedBySsiRule: normalizeSsiStorageBin(normalized) || ""
      };
    }
    if (looksLikeKnownPickingBinFamily(normalized)) {
      return {
        status: "invalid",
        reason: "Von-Lagerplatz verletzt bekannte SSI-Stellplatzregeln.",
        rawValue: raw,
        normalizedValue: normalized,
        suggestedCandidates: [],
        normalizedBySsiRule: normalizeSsiStorageBin(normalized) || ""
      };
    }
    return {
      status: "unknown",
      reason: "Von-Lagerplatz passt zu keinem bekannten Muster und keinem gezielten OCR-Vorschlag.",
      rawValue: raw,
      normalizedValue: normalized,
      suggestedCandidates: [],
      normalizedBySsiRule: normalizeSsiStorageBin(normalized) || ""
    };
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

  window.HLogistikStorageBinRules = {
    cleanStorageBin: cleanStorageBin,
    normalizeSsiStorageBin: normalizeSsiStorageBin,
    isValidPickingBin: isValidPickingBin,
    pickingFromBinShapeDiagnostic: pickingFromBinShapeDiagnostic,
    suggestedPickingFromBinCandidates: suggestedPickingFromBinCandidates
  };
})();
