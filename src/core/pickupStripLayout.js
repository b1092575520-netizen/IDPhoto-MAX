(function () {
  "use strict";
  var MARGIN = 24, INK = { red: 249, green: 233, blue: 160 };
  function plan(bar, settings, options, photoRatio) {
    options = options || {}; settings = settings || {};
    var code = window.IDPhotoDeliveryProtocol.requirePickupCode(options.pickupCode);
    var vertical = bar.orientation === "vertical";
    var width = vertical ? bar.height : bar.width, height = vertical ? bar.width : bar.height;
    if (width > 1417 || height < 150 || width < 600) throw new Error("信息条空位不支持本次取码布局");
    var items = [], regions = [];
    function text(key, value, x, y, w, h, px, bold) {
      if (value) items.push({ key: key, text: value, x: x, y: y, width: w, height: h,
        fontSize: px * 72 / 600, bold: Boolean(bold), color: INK });
    }
    function region(key, x, y, w, h) { var r = { key: key, x: x, y: y, width: w, height: h }; regions.push(r); return r; }
    var shop = settings.shopName || "福清印象照相馆";
    var phone = settings.shopPhone || "电话未填写";
    if (phone !== "电话未填写" && phone.indexOf("微信同号") === -1) phone += "（微信同号）";
    var date = options.dateText || "";
    var ratio = Number(photoRatio) > 0 ? Number(photoRatio) : 0.74;
    var narrow = vertical || height < 360;
    var qr = !narrow && height >= 500 && width >= 1370 && options.entryCodeAvailable === true;
    if (narrow) {
      var thumbH = height - 2 * MARGIN;
      var thumbW = Math.min(Math.round(thumbH * ratio), Math.floor(width * 0.2));
      var portrait = region("portrait", MARGIN, MARGIN, thumbW, thumbH);
      var start = MARGIN + portrait.width + 18, available = width - MARGIN - start;
      var scale = Math.min(1, (height - 48) / 178), top = 25;
      var row1H = Math.round(67 * scale), row2Y = Math.round(24 + 79 * scale), row3Y = Math.round(24 + 131 * scale);
      var labelW = Math.min(Math.round(472 * scale), Math.floor(available * 0.48));
      text("pickupLabel", "电子照片取件码：", start, top + 3, labelW, row1H - 3, 59 * scale, true);
      text("pickupCode", code, start + labelW + 22, top, available - labelW - 22, row1H, 82 * scale, true);
      text("steps", "打开本店微信小程序 → 输入上方取件码 → 保存照片",
        start, row2Y, available, row3Y - row2Y - 3, 48 * scale);
      text("details", [shop, phone, date].filter(Boolean).join("  "),
        start, row3Y, available, height - MARGIN - row3Y, 47 * scale);
    } else {
      // Keep the wide visual grouping at each template's actual available height.
      var sy = Math.min(1, height / 555), footerY = Math.round(height * 0.746);
      var thumbHeight = Math.round(263 * sy);
      var thumbWidth = Math.min(Math.round(thumbHeight * ratio), Math.round(width * 0.165));
      region("portrait", 32, Math.max(24, Math.round(36 * sy)), thumbWidth, thumbHeight);
      var left = 32 + thumbWidth + 32;
      var right = qr ? width - MARGIN - 425 - 32 : width - MARGIN;
      var bodyWidth = right - left;
      text("title", "电子照片领取", left, Math.max(24, Math.round(35 * sy)), bodyWidth, Math.round(67 * sy), 67 * sy, true);
      text("step1", qr ? "微信扫一扫右侧小程序码" : "打开本店微信小程序",
        left, Math.round(130 * sy), bodyWidth, Math.round(48 * sy), 46 * sy);
      text("step2", "输入下方取件码，保存照片", left, Math.round(192 * sy), bodyWidth, Math.round(48 * sy), 46 * sy);
      text("pickupCode", code, left, Math.round(267 * sy), bodyWidth, Math.round(105 * sy), 129 * sy, true);
      var footerRight = qr ? right : width - MARGIN;
      text("shopName", shop, 32, footerY, Math.floor((footerRight - 32) * 0.58), Math.round(50 * sy), 50 * sy, true);
      text("date", date, Math.floor(footerRight - 240 * sy), footerY + 5, Math.round(240 * sy),
        Math.round(43 * sy), 45 * sy);
      text("phone", phone, 32, Math.round(height * 0.868), footerRight - 32,
        height - MARGIN - Math.round(height * 0.868), 48 * sy);
      if (qr) {
        region("entryCode", width - MARGIN - 425, 48, 425, 425);
        text("scan", "微信扫一扫", width - MARGIN - 425, 489, 425, 42, 40);
      }
    }
    var all = items.concat(regions);
    all.forEach(function (r) {
      if (r.x < MARGIN || r.y < MARGIN || r.width <= 0 || r.height <= 0 ||
          r.x + r.width > width - MARGIN || r.y + r.height > height - MARGIN)
        throw new Error("信息条内容超出1毫米安全区：" + r.key);
    });
    for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++) {
      var a = all[i], b = all[j];
      if (Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
          Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
        throw new Error("信息条内容重叠：" + a.key + "/" + b.key);
    }
    return { width: width, height: height, vertical: vertical, items: items, regions: regions,
      entryCodeShown: qr, margin: MARGIN };
  }
  function placed(bar, reading, rectangle) {
    return reading.vertical ? { x: bar.x + reading.height - rectangle.y - rectangle.height,
      y: bar.y + rectangle.x, width: rectangle.height, height: rectangle.width } :
      { x: bar.x + rectangle.x, y: bar.y + rectangle.y, width: rectangle.width, height: rectangle.height };
  }
  window.IDPhotoPickupStripLayout = { plan: plan, placed: placed };
})();
