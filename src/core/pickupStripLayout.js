(function () {
  "use strict";
  // Pickup card, user 10-18. Planned in reading space (text runs left to right);
  // right-column cards are turned counter-clockwise so the heads point to the photos.
  // Text keeps 2 mm from a paper edge (the printer bleeds about 1 mm) and 1.5 mm
  // from an edge that is cut by hand.
  var INK = { red: 249, green: 233, blue: 160 };
  var PAPER_TEXT = 48, CUT_TEXT = 36, CODE_GAP = 36, CANVAS_W = 3600, CANVAS_H = 2400;
  var TITLE = "请7天内领取电子照片";
  // Microsoft YaHei advance widths in em (measured); everything else is a full em.
  var REGULAR = { "0": .586, "1": .586, "2": .586, "3": .586, "4": .586, "5": .586, "6": .586, "7": .586,
    "8": .586, "9": .586, A: .704, B: .627, C: .669, D: .762, E: .55, F: .531, G: .744, H: .773, I: .294,
    J: .396, K: .635, L: .513, M: .977, N: .813, O: .815, P: .612, Q: .815, R: .653, S: .577, T: .573,
    U: .747, V: .676, W: 1.018, X: .645, Y: .604, Z: .62, " ": .296, ".": .241, ":": .241, "-": .433,
    "(": .334, ")": .334 };
  var BOLD = { "0": .617, "1": .617, "2": .617, "3": .617, "4": .617, "5": .617, "6": .617, "7": .617,
    "8": .617, "9": .617, A: .752, B: .684, C: .673, D: .792, E: .572, F: .558, G: .765, H: .821, I: .335,
    J: .47, K: .693, L: .547, M: 1.028, N: .848, O: .818, P: .657, Q: .818, R: .698, S: .602, T: .625,
    U: .776, V: .715, W: 1.076, X: .7, Y: .648, Z: .65, " ": .298, ".": .286, ":": .286, "-": .437,
    "(": .39, ")": .39 };
  function textWidth(text, px, bold) {
    var table = bold ? BOLD : REGULAR, em = 0;
    for (var i = 0; i < text.length; i++) em += table[text[i]] !== undefined ? table[text[i]] : 1;
    return em * px;
  }
  function fit(text, px, bold, width) {
    var w = textWidth(text, px, bold);
    return w <= width ? px : px * width / w;
  }

  // Reading-space sides in order top, right, bottom, left; true where the card meets the paper edge.
  // Turned counter-clockwise, reading top is the sheet's left and reading right the sheet's top.
  function paperSides(bar) {
    var left = bar.x <= 0, right = bar.x + bar.width >= CANVAS_W, top = bar.y <= 0, bottom = bar.y + bar.height >= CANVAS_H;
    return bar.orientation === "vertical" ? [left, top, right, bottom] : [top, right, bottom, left];
  }
  // Rounds the edges, not the size, so rows that touch never overlap by a pixel.
  function snapped(x, y, w, h) {
    var x0 = Math.round(x), y0 = Math.round(y);
    return { x: x0, y: y0, width: Math.round(x + w) - x0, height: Math.round(y + h) - y0 };
  }

  function plan(bar, settings, options, photoRatio) {
    options = options || {}; settings = settings || {};
    var code = window.IDPhotoDeliveryProtocol.requirePickupCode(options.pickupCode);
    var vertical = bar.orientation === "vertical";
    var W = vertical ? bar.height : bar.width, H = vertical ? bar.width : bar.height;
    if (W > 1417 || H < 150 || W < 600) throw new Error("信息条空位不支持本次取码布局");
    var ratio = Number(photoRatio) > 0 ? Number(photoRatio) : 0.74;
    var family = bar.pickupFamily || (H >= 450 ? "wide" : H >= 300 ? "medium" : "thin");
    var withCode = options.entryCodeAvailable === true;
    var paper = paperSides(bar);
    var pad = bar.textPadding || paper.map(function (p) { return p ? PAPER_TEXT : CUT_TEXT; });
    var codeEdge = bar.codeEdge || 36;
    var codePad = paper.map(function (p) { return p ? codeEdge : CUT_TEXT; });
    var shop = settings.shopName || "福清印象照相馆";
    var phone = settings.shopPhone || "电话未填写";
    if (phone !== "电话未填写" && phone.indexOf("微信同号") === -1) phone += "（微信同号）";
    var date = options.dateText || "";
    var items = [], regions = [];
    function text(key, value, x, y, w, h, px, bold, align) {
      if (value) items.push(Object.assign({ key: key, text: value }, snapped(x, y, w, h),
        { fontSize: Math.floor(px * 72 / 600 * 10) / 10, bold: Boolean(bold), color: INK, align: align || "start" }));
    }
    function region(key, x, y, w, h, extra) {
      var r = Object.assign({ key: key }, snapped(x, y, w, h), extra || {});
      regions.push(r); return r;
    }
    var variant = bar.codeVariant || "logo";

    if (family === "wide") {
      var X = pad[3], Y = pad[0], Wd = W - pad[3] - pad[1], Hd = H - pad[0] - pad[2];
      var q = withCode ? Math.min(H - codePad[0] - codePad[2], Math.round((Wd > 1200 ? 0.36 : 0.32) * Wd)) : 0;
      var qx = W - codePad[1] - q;
      if (withCode) region("entryCode", qx, Math.round((H - q) / 2), q, q, { variant: variant });
      var right = withCode ? qx - CODE_GAP : W - pad[1];
      var L = right - X;
      var step1 = withCode ? "① 微信扫一扫右侧二维码" : "① 打开本店微信小程序";
      var step2 = Wd > 1200 ? "② 输入下方取件码，保存照片" : "② 输入取件码，保存照片";
      var body = 67 * 1.15 + 46 * 2.4 + 129 * 0.95, nat = body + 18 + 60 + 57.6;
      var f = Math.min(1.15, Hd / nat);
      // Sized for a typical code (4.4 em); an unusually wide one only shrinks itself.
      while (body * f * ratio + 32 + Math.max(textWidth(step2, 46 * f), 4.4 * 129 * f) > L) f *= 0.98;
      var y = Y + (Hd - nat * f) / 2;
      var portrait = region("portrait", X, y, body * f * ratio, body * f);
      var tx = X + portrait.width + 32, tw = right - tx;
      [["title", TITLE, 67, 1.15, true], ["step1", step1, 46, 1.2, false], ["step2", step2, 46, 1.2, false],
        ["pickupCode", code, 129, 0.95, true]].forEach(function (row) {
        text(row[0], row[1], tx, y, tw, row[3] * row[2] * f, fit(row[1], row[2] * f, row[4], tw), row[4]); y += row[3] * row[2] * f;
      });
      y += 18 * f;
      var dateW = date ? textWidth(date, 45 * f) + 4 : 0;
      text("shopName", shop, X, y, right - X - dateW - 40, 60 * f, fit(shop, 50 * f, true, right - X - dateW - 40), true);
      text("date", date, right - dateW, y, dateW, 60 * f, 45 * f, false, "end");
      text("phone", phone, X, y + 60 * f, L, 57.6 * f, fit(phone, 48 * f, false, L), false);
    } else {
      var medium = family === "medium";
      var X2 = pad[3], Y2 = pad[0], H2 = H - pad[0] - pad[2];
      var q2 = 0, qx2 = W - pad[1], qy2 = 0;
      if (withCode) {
        // Thin strips: the code may reach `codeReach` px into the white gap next to the photos.
        var reach = medium ? 0 : bar.codeReach || 0;
        qy2 = medium ? codePad[0] : -reach;
        q2 = medium ? H - codePad[0] - codePad[2] : H + reach - codePad[2];
        qx2 = W - codePad[1] - q2;
        region("entryCode", qx2, qy2, q2, q2, { variant: variant });
      }
      var pw = Math.round(H2 * ratio);
      var end = withCode ? qx2 - 28 : W - pad[1];
      var start = X2 + pw + 24, avail = end - start;
      var steps = withCode ? "7天内：微信扫码 → 输入取件码 → 保存照片" : "7天内：打开本店微信小程序 → 输入取件码";
      var rows = medium ?
        [["steps", steps, 0.5], ["details", date ? shop + "  " + date : shop, 0.5], ["phone", phone, 0.48]] :
        [["steps", steps, 0.585], ["details", shop + "  " + phone, 0.575]];
      var lh = medium ? 1.28 : 1.12, label = medium ? "电子照片取件码：" : "取件码：";
      var C = H2 / (0.95 + lh * rows.reduce(function (sum, row) { return sum + row[2]; }, 0));
      var dp = 0.585 * C, dateW2 = !medium && date ? textWidth(date, dp) + 4 + 0.6 * C : 0;
      var f1 = Math.min(1, (avail - dateW2) / (textWidth(label, 0.72 * C, true) + 0.25 * C + textWidth(code, C, true)));
      var cp = C * f1, lp = 0.72 * C * f1, gap = 0.25 * C * f1;
      var fonts = rows.map(function (row) { return fit(row[1], row[2] * C, false, avail); });
      var row1 = textWidth(label, lp, true) + gap + textWidth(code, cp, true) + dateW2;
      var block = Math.max.apply(null, [row1].concat(rows.map(function (row, i) { return textWidth(row[1], fonts[i]); })));
      if (bar.packToCode) { start = Math.max(start, end - block); avail = end - start; }
      region("portrait", start - 24 - pw, Y2, pw, H2);
      var hs = [cp * 0.95].concat(rows.map(function (row) { return lh * row[2] * C; }));
      var y2 = Y2 + (H2 - hs.reduce(function (a, b) { return a + b; }, 0)) / 2;
      var labelW = textWidth(label, lp, true), codeX = start + labelW + gap, codeW = textWidth(code, cp, true);
      text("pickupLabel", label, start, y2, labelW + 2, hs[0], lp, true);
      var codeSlot = bar.packToCode || medium || !date ? codeW + 4 : end - dateW2 + 0.6 * C - codeX;
      text("pickupCode", code, codeX, y2, Math.min(codeSlot, end - codeX), hs[0], cp, true);
      if (!medium && date) {
        var dw = textWidth(date, dp) + 4;
        if (bar.packToCode) text("date", date, codeX + codeW + 0.6 * C, y2, dw, hs[0], dp, false);
        else text("date", date, end - dw, y2, dw, hs[0], dp, false, "end");
      }
      y2 += hs[0];
      rows.forEach(function (row, i) { text(row[0], row[1], start, y2, avail, hs[i + 1], fonts[i], false); y2 += hs[i + 1]; });
    }

    var inner = { x: pad[3], y: pad[0], right: W - pad[1], bottom: H - pad[2] };
    items.concat(regions.filter(function (r) { return r.key !== "entryCode"; })).forEach(function (r) {
      if (r.x < inner.x - 1 || r.y < inner.y - 1 || r.width <= 0 || r.height <= 0 ||
          r.x + r.width > inner.right + 1 || r.y + r.height > inner.bottom + 1)
        throw new Error("信息条内容超出安全边距：" + r.key);
    });
    regions.filter(function (r) { return r.key === "entryCode"; }).forEach(function (r) {
      if (r.x < 0 || r.x + r.width > W || r.y < -(bar.codeReach || 0) || r.y + r.height > H)
        throw new Error("小程序码超出信息条：" + r.key);
    });
    var all = items.concat(regions);
    for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++) {
      var a = all[i], b = all[j];
      if (Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
          Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
        throw new Error("信息条内容重叠：" + a.key + "/" + b.key);
    }
    return { width: W, height: H, vertical: vertical, turn: vertical ? "ccw" : "", items: items, regions: regions,
      entryCodeShown: withCode, entryCodeVariant: withCode ? variant : "", band: bar.band || null, margin: pad };
  }
  // Reading-space rectangle to canvas. Pickup cards turn counter-clockwise (reading top is
  // the photo side); the ordinary strips keep their clockwise turn.
  function placed(bar, reading, rectangle) {
    if (!reading.vertical) return { x: bar.x + rectangle.x, y: bar.y + rectangle.y, width: rectangle.width, height: rectangle.height };
    if (reading.turn === "ccw") return { x: bar.x + rectangle.y, y: bar.y + reading.width - rectangle.x - rectangle.width,
      width: rectangle.height, height: rectangle.width };
    return { x: bar.x + reading.height - rectangle.y - rectangle.height, y: bar.y + rectangle.x,
      width: rectangle.height, height: rectangle.width };
  }
  // The card plus the part of the code that reaches into the white gap next to the photos.
  function outline(bar) {
    var reach = bar.codeReach || 0, box = { x: bar.x, y: bar.y, width: bar.width, height: bar.height };
    if (bar.orientation === "vertical") { box.x -= reach; box.width += reach; } else { box.y -= reach; box.height += reach; }
    return box;
  }
  window.IDPhotoPickupStripLayout = { plan: plan, placed: placed, outline: outline, textWidth: textWidth, TITLE: TITLE };
})();
