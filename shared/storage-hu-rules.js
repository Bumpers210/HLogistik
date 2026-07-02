(function () {
  var PREFIX = "34006381000";
  var SUFFIX_LENGTH = 7;
  var LENGTH = PREFIX.length + SUFFIX_LENGTH;

  function normalizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeHandlingUnit(value) {
    var digits = normalizeDigits(value);
    if (!digits) return PREFIX;
    if (digits.indexOf(PREFIX) === 0) return digits.slice(0, LENGTH);
    var suffix = digits.length <= SUFFIX_LENGTH
      ? digits
      : digits.slice(digits.length - SUFFIX_LENGTH);
    return PREFIX + suffix;
  }

  function isComplete(value) {
    var digits = normalizeDigits(value);
    return digits.indexOf(PREFIX) === 0 && digits.length === LENGTH;
  }

  function isIncomplete(value) {
    var digits = normalizeDigits(value);
    return digits.indexOf(PREFIX) === 0 && digits.length < LENGTH;
  }

  function stripPrefix(value) {
    var text = String(value || "").trim();
    var digits = normalizeDigits(text);
    if (digits.indexOf(PREFIX) !== 0) return text;
    return digits.slice(PREFIX.length);
  }

  window.HLogistikStorageHuRules = {
    prefix: PREFIX,
    suffixLength: SUFFIX_LENGTH,
    length: LENGTH,
    isComplete: isComplete,
    isIncomplete: isIncomplete,
    normalizeHandlingUnit: normalizeHandlingUnit,
    stripPrefix: stripPrefix
  };
})();
