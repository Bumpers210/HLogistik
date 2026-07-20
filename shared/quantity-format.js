(function (global) {
  "use strict";

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function formatWithoutIntl(number) {
    var sign = number < 0 ? "-" : "";
    var text = String(Math.abs(number));
    if (/[eE]/.test(text)) {
      text = Math.abs(number).toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
    }
    var parts = text.split(".");
    var whole = parts[0];
    var grouped = "";
    while (whole.length > 3) {
      grouped = "." + whole.slice(-3) + grouped;
      whole = whole.slice(0, -3);
    }
    grouped = whole + grouped;
    return sign + grouped + (parts[1] ? "," + parts[1] : "");
  }

  function parseSingle(value) {
    var text = String(value == null ? "" : value).trim().replace(/\s+/g, "");
    if (!text) return NaN;
    if (/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else if (/^[+-]?\d+(?:,\d+)?$/.test(text)) {
      text = text.replace(",", ".");
    } else if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
      return NaN;
    }
    var number = Number(text);
    return isFiniteNumber(number) ? number : NaN;
  }

  function parse(value) {
    var text = String(value == null ? "" : value).trim();
    var factors = text.split(/\s*[xX×]\s*/);
    if (factors.length === 1) return parseSingle(factors[0]);
    if (factors.length !== 2 || !factors[0] || !factors[1]) return NaN;
    var left = parseSingle(factors[0]);
    var right = parseSingle(factors[1]);
    return isFiniteNumber(left) && isFiniteNumber(right) ? left * right : NaN;
  }

  function format(value) {
    var number = typeof value === "number" ? value : parse(value);
    if (!isFiniteNumber(number)) return String(value == null ? "" : value).trim();
    if (global.Intl && typeof global.Intl.NumberFormat === "function") {
      return new global.Intl.NumberFormat("de-DE", { maximumFractionDigits: 20 }).format(number);
    }
    return formatWithoutIntl(number);
  }

  function isMultiplication(value) {
    return /^\s*[^xX×]+\s*[xX×]\s*[^xX×]+\s*$/.test(String(value == null ? "" : value));
  }

  function displayLineQuantity(line, value) {
    var canonical = value;
    if (canonical == null || String(canonical).trim() === "") {
      canonical = line && String(line.actualQty == null ? "" : line.actualQty).trim() !== ""
        ? line.actualQty
        : line && line.targetQty;
    }
    var source = String(line && line.quantitySourceText || "").trim();
    var parsedCanonical = parse(canonical);
    if (source && isMultiplication(source) && isFiniteNumber(parsedCanonical) && parse(source) === parsedCanonical) {
      return source;
    }
    return format(canonical);
  }

  global.HLogistikQuantityFormat = Object.freeze({ parse: parse, format: format, displayLineQuantity: displayLineQuantity });
})(window);
