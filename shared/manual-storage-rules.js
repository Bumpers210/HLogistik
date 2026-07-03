(function () {
  var POSITION_CREATE_COUNT_DEFAULT = 1;
  var POSITION_CREATE_COUNT_MIN = 1;
  var POSITION_CREATE_COUNT_MAX = 100;
  var POSITION_PREFIX = "M";
  var POSITION_PATTERN = /^M\d+$/i;

  function nextPositionName(lines) {
    var numbers = [];
    var source = Array.isArray(lines) ? lines : [];
    for (var index = 0; index < source.length; index += 1) {
      var value = String(source[index] && source[index].warehouseOrder || "");
      if (POSITION_PATTERN.test(value)) numbers.push(Number(value.replace(/\D/g, "")));
    }
    return POSITION_PREFIX + ((numbers.length ? Math.max.apply(null, numbers) : 0) + 1);
  }

  window.HLogistikManualStorageRules = {
    positionCreateCountDefault: POSITION_CREATE_COUNT_DEFAULT,
    positionCreateCountMin: POSITION_CREATE_COUNT_MIN,
    positionCreateCountMax: POSITION_CREATE_COUNT_MAX,
    positionPrefix: POSITION_PREFIX,
    nextPositionName: nextPositionName
  };
})();
