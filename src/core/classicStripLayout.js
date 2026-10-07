(function () {
  "use strict";

  // Ordinary (no pickup code) information strip in the one-inch style:
  // portrait on the left, shop name / date / phone / tip stacked on the right.
  // Planned in reading space; vertical strips are drawn there and turned 90°.
  var MARGIN = 24;
  var GAP_AFTER_PORTRAIT = 37;
  var LINE_GAP = 0;
  // Each line's slot is a little taller than its font size: Photoshop's glyph
  // bounds (full-width brackets, descenders) slightly exceed the em height,
  // and a slot that is too short would shrink the text.
  var LINE_SLOT = 1.1;
  var PX_PER_PT = 600 / 72;
  var FULL_AVATAR_HEIGHT = 430;
  // The cut strip goes into a bag: its longest edge may not exceed 8 cm.
  var MAX_LENGTH_PX = Math.floor(8 / 2.54 * 600);

  // Font sizes in points at full scale; these are the one-inch strip values.
  var FONT = { shopName: 13, date: 12, phone: 11, tip: 10 };

  function texts(settings, options) {
    var phone = settings.shopPhone || "电话未填写";
    if (phone.indexOf("Tel:") !== 0) phone = "Tel:" + phone;
    return {
      shopName: settings.shopName || "福清印象照相馆",
      date: options.dateText || "",
      phone: phone,
      tip: settings.shopTip || "[请妥善保管此单据]"
    };
  }

  function join(parts) {
    return parts.filter(function (part) { return part; }).join("  ");
  }

  var MIN_PT = 7.2;

  // Four, three or two lines of the same information; fewer lines suit
  // strips that are too thin or too short for four readable lines.
  function lineSets(value) {
    return [
      [
        { key: "shopName", text: value.shopName, pt: FONT.shopName },
        { key: "date", text: value.date, pt: FONT.date },
        { key: "phone", text: value.phone, pt: FONT.phone },
        { key: "tip", text: value.tip, pt: FONT.tip }
      ],
      [
        { key: "shopName", text: value.shopName, pt: FONT.shopName },
        { key: "dateTip", text: join([value.date, value.tip]), pt: FONT.date },
        { key: "phone", text: value.phone, pt: FONT.phone }
      ],
      [
        { key: "shopNameDate", text: join([value.shopName, value.date]), pt: FONT.shopName },
        { key: "phoneTip", text: join([value.phone, value.tip]), pt: FONT.phone }
      ]
    ];
  }

  // Rough glyph advance in em: CJK and full-width forms are square, Latin
  // digits and letters about half. Only used to size the strip; Photoshop
  // still shrinks any line that would overflow its slot.
  function estimateWidth(text, fontPx) {
    var em = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0x2e80) em += 1;
      else if (text[i] === " " || text[i] === "." || text[i] === ":") em += 0.3;
      else if (text[i] === "[" || text[i] === "]") em += 0.4;
      else em += 0.47; // measured in Photoshop: Adobe Heiti digits are narrow
    }
    return em * fontPx;
  }

  function textHeight(lines) {
    return lines.reduce(function (sum, line) { return sum + line.pt * PX_PER_PT * LINE_SLOT; }, 0) +
      LINE_GAP * (lines.length - 1);
  }

  // Most lines whose smallest font stays readable; otherwise the set with the
  // largest smallest font.
  function stripPlan(longSide, height, value, ratio) {
    var best = null;
    var sets = lineSets(value);
    for (var i = 0; i < sets.length; i++) {
      var candidate = stripPlanFor(longSide, height, sets[i], ratio);
      candidate.minPt = Math.min.apply(null, candidate.items.map(function (item) { return item.fontSize; }));
      if (candidate.minPt >= MIN_PT) return candidate;
      if (!best || candidate.minPt > best.minPt) best = candidate;
    }
    return best;
  }

  function stripPlanFor(longSide, height, set, ratio) {
    var available = height - 2 * MARGIN;
    var lines = set.filter(function (line) { return line.text; });
    var natural = Math.max(textHeight(lines), lines.length === 4 ? FULL_AVATAR_HEIGHT : 0);
    var widestFull = lines.reduce(function (max, line) {
      return Math.max(max, estimateWidth(line.text, line.pt * PX_PER_PT));
    }, 0);
    // A short strip shrinks the whole block evenly so the longest line still
    // fits beside the portrait, instead of squeezing that one line.
    var lengthScale = (Math.min(longSide, MAX_LENGTH_PX) - 2 * MARGIN - GAP_AFTER_PORTRAIT) /
      (Math.min(natural * ratio, MAX_LENGTH_PX * 0.25) + widestFull * 1.05);
    var scale = Math.min(1, available / natural, lengthScale);
    var avatarHeight = Math.floor(Math.min(available, natural * scale));
    var avatarWidth = Math.min(Math.round(avatarHeight * ratio), Math.floor(MAX_LENGTH_PX * 0.25));
    var widest = lines.reduce(function (max, line) {
      return Math.max(max, estimateWidth(line.text, line.pt * PX_PER_PT * scale));
    }, 0);
    var width = Math.min(longSide, MAX_LENGTH_PX,
      Math.ceil(MARGIN + avatarWidth + GAP_AFTER_PORTRAIT + widest * 1.05 + MARGIN));
    var regions = [{ key: "portrait", x: MARGIN, y: Math.round((height - avatarHeight) / 2), width: avatarWidth, height: avatarHeight }];
    var left = MARGIN + avatarWidth + GAP_AFTER_PORTRAIT;
    var block = textHeight(lines) * scale;
    var y = Math.round((height - block) / 2);
    var items = lines.map(function (line) {
      var lineHeight = Math.floor(line.pt * PX_PER_PT * LINE_SLOT * scale);
      var item = { key: line.key, text: line.text, x: left, y: y, width: width - MARGIN - left,
        height: lineHeight, fontSize: Math.round(line.pt * scale * 10) / 10, align: "left" };
      y += lineHeight + Math.floor(LINE_GAP * scale);
      return item;
    });
    return { width: width, items: items, regions: regions };
  }

  function plan(bar, settings, options, photoRatio) {
    settings = settings || {};
    options = options || {};
    var vertical = bar.orientation === "vertical";
    var longSide = vertical ? bar.height : bar.width;
    var height = vertical ? bar.width : bar.height;
    var ratio = Number(photoRatio) > 0 ? Number(photoRatio) : 0.74;
    var value = texts(settings, options);
    if (height < 150) throw new Error("信息条空位太窄，无法排版");
    var result = stripPlan(longSide, height, value, ratio);
    var width = result.width;
    if (width > MAX_LENGTH_PX || height > MAX_LENGTH_PX) throw new Error("信息条超过8厘米，无法装袋");
    var color = bar.textColor || { red: 255, green: 238, blue: 150 };
    result.items.forEach(function (item) { item.color = color; });
    var all = result.items.concat(result.regions);
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
    // The coloured strip (bar space) is only as long as its content; the rest
    // of the free area stays white. Bottom strips start at the left edge,
    // right-hand strips at the top.
    var strip = vertical ? { x: bar.x, y: bar.y, width: bar.width, height: width } :
      { x: bar.x, y: bar.y, width: width, height: bar.height };
    return { width: width, height: height, vertical: vertical, items: result.items, regions: result.regions,
      margin: MARGIN, strip: strip, lengthCm: Math.round(width / 600 * 2.54 * 10) / 10 };
  }

  window.IDPhotoClassicStripLayout = { plan: plan, FONT: FONT, MAX_LENGTH_PX: MAX_LENGTH_PX };
})();
