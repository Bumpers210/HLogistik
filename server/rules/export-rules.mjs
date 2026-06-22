export function validateOrderCompletionForExport(order, options = {}) {
  const orderType = order?.orderType || "picking";
  const lines = exportableOrderLines(order, { ...options, excludeLoadingSlip: orderType === "storage" });
  if (!lines.length) return "Export gesperrt: Auftrag hat keine Positionen.";
  const isMissingStorageLine = options.isMissingStorageLine || (() => false);
  const openLines = lines.filter((line) => !line?.picked && !(orderType === "storage" && isMissingStorageLine(line)));
  if (!openLines.length) return "";
  return `Export gesperrt: Erst alle Positionen abhaken (${openLines.length} offen${openPositionListText(openLines)}).`;
}

export function exportableOrderLines(order, options = {}) {
  const isEmptyManualStorageLine = options.isEmptyManualStorageLine || (() => false);
  return (Array.isArray(order?.lines) ? order.lines : [])
    .filter((line) => !(options.excludeLoadingSlip && line?.lineType === "loading-slip"))
    .filter((line) => !isEmptyManualStorageLine(line));
}

export function openPositionListText(lines) {
  const positions = lines
    .slice(0, 5)
    .map((line, index) => String(line?.warehouseOrder || line?.position || index + 1).trim())
    .filter(Boolean);
  if (!positions.length) return "";
  return `: Pos. ${positions.join(", ")}${lines.length > positions.length ? ", ..." : ""}`;
}
