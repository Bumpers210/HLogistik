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
    var match = text.match(/^022-H([1-7])-R(\d+)$/i);
    if (match) return normalizeSsiBlockBin(match[1], match[2]);
    match = text.match(/^002-H([1-7])-R(\d+)$/i);
    if (match) return normalizeSsiBlockBin(match[1], match[2]);
    match = text.match(/^002-H[1-7]-SH([1-7])R(\d+)$/i);
    if (match) return normalizeSsiBlockBin(match[1], match[2]);
    match = text.match(/^H([1-7])-?R(\d+)$/i);
    if (match) return normalizeSsiBlockBin(match[1], match[2]);
    match = text.match(/^H3-?([O-Y][1-3])$/i);
    if (match) return normalizeSsiH3DirectBin(match[1]);
    match = text.match(/^002-H3-([O-Y][1-3])$/i);
    if (match) return normalizeSsiH3DirectBin(match[1]);
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

  function normalizeSsiBlockBin(hall, blockNumber) {
    var hallNumber = Number(hall);
    var number = Number(blockNumber);
    if (!Number.isInteger(hallNumber) || hallNumber < 1 || hallNumber > 7 || !Number.isInteger(number) || number <= 0) {
      return null;
    }
    return "022-H" + hallNumber + "-R" + number;
  }

  function normalizeSsiH3DirectBin(code) {
    var text = String(code || "").trim().toUpperCase();
    if (!/^[O-Y][1-3]$/.test(text)) return null;
    return "002-H3-" + text;
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
