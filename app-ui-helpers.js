(function () {
  function code128Svg(value) {
    var barcode = String(value || "").trim();
    if (!barcode) return '<span class="loading-slip-empty">Kein Barcode</span>';

    var patterns = [
      "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
      "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
      "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
      "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
      "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
      "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
      "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
      "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
      "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
      "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
      "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
    ];
    var codes = [104];
    var index;
    for (index = 0; index < barcode.length; index += 1) {
      var charCode = barcode.charCodeAt(index);
      if (charCode < 32 || charCode > 126) continue;
      codes.push(charCode - 32);
    }
    if (codes.length === 1) return '<span class="loading-slip-empty">Barcode ungueltig</span>';

    var checksum = 0;
    for (index = 0; index < codes.length; index += 1) {
      checksum += codes[index] * (index || 1);
    }
    codes.push(checksum % 103, 106);

    var x = 10;
    var bars = "";
    for (index = 0; index < codes.length; index += 1) {
      var pattern = patterns[codes[index]];
      if (!pattern) continue;
      for (var patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
        var width = Number(pattern.charAt(patternIndex));
        if (patternIndex % 2 === 0) bars += '<rect x="' + x + '" y="0" width="' + width + '" height="44"></rect>';
        x += width;
      }
    }

    var svgWidth = x + 10;
    return '<svg class="code128" viewBox="0 0 ' + svgWidth + ' 58" role="img" aria-label="Barcode ' + escapeHtmlAttribute(barcode) + '">\n' +
      '    <g fill="#111">' + bars + '</g>\n' +
      '    <text x="' + svgWidth / 2 + '" y="56" text-anchor="middle">' + escapeSvgText(barcode) + "</text>\n" +
      "  </svg>";
  }

  function escapeSvgText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeHtmlAttribute(value) {
    return escapeSvgText(value).replace(/"/g, "&quot;");
  }

  window.HLogistikUiHelpers = {
    code128Svg: code128Svg,
    escapeHtmlAttribute: escapeHtmlAttribute,
    escapeSvgText: escapeSvgText
  };
})();
