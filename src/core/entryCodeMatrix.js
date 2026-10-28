(function () {
  "use strict";
  // The store's mini-program entry code, drawn from its link (user 10-18). Every card
  // gets pixel-exact modules at its own size instead of a scaled picture.
  // "logo": error level Q (37 modules for the store link) with the store logo in the middle;
  // "coarse": level L (29 modules), no logo, for the two thinnest strips.
  // A per-order link (10-28, up to 74 characters) always takes the fixed `exclusive` version:
  // 6 (41 modules) at Q, 4 (33 modules) at L.
  var DEFAULT_TEXT = "https://mp.weixin.qq.com/a/~ECctIh1ILr7RP5ZRcuuT8A~~";
  var STYLES = { logo: { level: "Q", margin: 3, logo: true, exclusive: 6 },
    coarse: { level: "L", margin: 2, logo: false, exclusive: 4 } };
  var LOGO_RADIUS = 175 / 1290;  // white halo around the logo, as a share of the full code width
  function style(variant) {
    var found = STYLES[variant || "logo"];
    if (!found) throw new Error("未知的小程序码样式：" + variant);
    return found;
  }
  // `version` 0 lets the encoder pick the smallest that fits; a fixed one that is too small throws.
  function matrix(text, level, version) {
    // UTF-8 bytes, which is what scanners expect for anything beyond plain ASCII.
    window.IDPhotoQrEncode.stringToBytes = window.IDPhotoQrEncode.stringToBytesFuncs["UTF-8"];
    var qr = window.IDPhotoQrEncode(version || 0, level);
    qr.addData(String(text), "Byte");
    qr.make();
    var count = qr.getModuleCount(), dark = new Uint8Array(count * count);
    for (var r = 0; r < count; r++) for (var c = 0; c < count; c++) dark[r * count + c] = qr.isDark(r, c) ? 1 : 0;
    return { count: count, dark: dark };
  }
  // RGB pixels, size x size. `turn: "ccw"` turns the whole code with a counter-clockwise
  // card so the logo reads the same way as the text. `logo` is { data, width } raw RGB.
  function render(options) {
    var s = style(options.variant), size = Math.round(options.size);
    if (!(size >= 21)) throw new Error("小程序码尺寸太小");
    var m = matrix(options.text || DEFAULT_TEXT, s.level, options.exclusive ? s.exclusive : 0), total = m.count + 2 * s.margin;
    var logo = s.logo && options.logo && options.useLogo !== false ? options.logo : null;
    var out = new Uint8Array(size * size * 3), ccw = options.turn === "ccw";
    var centre = size / 2, radius = LOGO_RADIUS * size;
    for (var sy = 0; sy < size; sy++) for (var sx = 0; sx < size; sx++) {
      var x = ccw ? size - 1 - sy : sx, y = ccw ? sx : sy;
      var col = Math.floor((x + 0.5) * total / size) - s.margin, row = Math.floor((y + 0.5) * total / size) - s.margin;
      var v = col >= 0 && row >= 0 && col < m.count && row < m.count && m.dark[row * m.count + col] ? 0 : 255;
      var i = (sy * size + sx) * 3;
      out[i] = out[i + 1] = out[i + 2] = v;
      if (logo) {
        // Sampled in reading space, so the logo turns together with the card.
        var dx = x + 0.5 - centre, dy = y + 0.5 - centre, d = Math.sqrt(dx * dx + dy * dy);
        if (d < radius + 0.5) {
          var a = Math.min(1, radius + 0.5 - d), lw = logo.width;
          var u = Math.min(lw - 1, Math.max(0, Math.floor((dx / radius * 0.5 + 0.5) * lw)));
          var w = Math.min(lw - 1, Math.max(0, Math.floor((dy / radius * 0.5 + 0.5) * lw)));
          var li = (w * lw + u) * 3;
          for (var k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k] * (1 - a) + logo.data[li + k] * a);
        }
      }
    }
    return { pixels: out, size: size, count: m.count, total: total };
  }
  window.IDPhotoEntryCode = { DEFAULT_TEXT: DEFAULT_TEXT, STYLES: STYLES, matrix: matrix, render: render };
})();
