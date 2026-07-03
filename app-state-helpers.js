(function () {
  function getPickingLines(lines, orderType, importOrder) {
    var source = Array.isArray(lines) ? lines : [];
    if (orderType === "storage") return source.slice();
    return source.slice().sort(function (left, right) {
      return compareStorageBins(left, right, importOrder);
    });
  }

  function compareStorageBins(left, right, importOrder) {
    var leftLoadingSlip = left && left.lineType === "loading-slip";
    var rightLoadingSlip = right && right.lineType === "loading-slip";
    if (leftLoadingSlip && rightLoadingSlip) return 0;
    if (leftLoadingSlip && !rightLoadingSlip) return 1;
    if (!leftLoadingSlip && rightLoadingSlip) return -1;

    var leftBin = String((left && left.fromBin) || "").trim();
    var rightBin = String((right && right.fromBin) || "").trim();

    if (!leftBin && rightBin) return 1;
    if (leftBin && !rightBin) return -1;

    var byBin = leftBin.localeCompare(rightBin, "de", {
      numeric: true,
      sensitivity: "base"
    });
    if (byBin !== 0) return byBin;

    return importOrderIndex(importOrder, left && left.id) - importOrderIndex(importOrder, right && right.id);
  }

  function isQuantityChanged(line) {
    if (line && line.manual === true && !String(line.targetQty || "").trim()) return false;
    return String((line && line.actualQty) || "").trim() !== String((line && line.targetQty) || "").trim();
  }

  function importOrderIndex(importOrder, id) {
    if (importOrder && typeof importOrder.get === "function" && importOrder.has(id)) return importOrder.get(id);
    return 0;
  }

  window.HLogistikStateHelpers = {
    compareStorageBins: compareStorageBins,
    getPickingLines: getPickingLines,
    isQuantityChanged: isQuantityChanged
  };
})();
