(function () {
  "use strict";

  var PPI = 600;
  var CM_PER_INCH = 2.54;
  var CANVAS_WIDTH_PX = 3600;
  var CANVAS_HEIGHT_PX = 2400;
  var REFERENCE_ROOT = "D:\\software\\IDPhoto-MAX\\示例图片\\";

  function cmToPx(cm) {
    return Math.round((cm / CM_PER_INCH) * PPI);
  }

  function referencePath(fileName) {
    return REFERENCE_ROOT + fileName;
  }

  function slot(x, y, row, col, rotate, width, height) {
    return {
      x: x,
      y: y,
      row: row,
      col: col,
      rotate: rotate || 0,
      width: width || null,
      height: height || null
    };
  }

  function cloneObject(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
  }

  function info(position, x, y, width, height, options) {
    var result;
    if (!position || position === "none") {
      return {
        enabled: false,
        position: "none",
        orientation: "horizontal"
      };
    }
    result = {
      enabled: true,
      position: position,
      kind: position,
      orientation: position === "right" ? "vertical" : "horizontal",
      x: x,
      y: y,
      width: width,
      height: height
    };
    if (options) {
      Object.keys(options).forEach(function (key) {
        result[key] = cloneObject(options[key]);
      });
    }
    return result;
  }

  function avatar(x, y, width, height) {
    return {
      x: x,
      y: y,
      width: width,
      height: height,
      mode: "photoThumbnail"
    };
  }

  function thumbnailAvatar(x, y, width, height, options) {
    var result = avatar(x, y, width, height);
    if (options) {
      Object.keys(options).forEach(function (key) {
        result[key] = cloneObject(options[key]);
      });
    }
    return result;
  }

  function horizontalText(x, y, options) {
    var result = {
      mode: "horizontalBlock",
      x: x,
      y: y,
      gap: 28,
      useAvatarGap: true,
      minFontSize: 6,
      maxFontSize: 13,
      lineGap: 8,
      keys: ["shopName", "date", "phone", "tip"],
      phonePrefix: "Tel:"
    };
    if (options) {
      Object.keys(options).forEach(function (key) {
        result[key] = cloneObject(options[key]);
      });
    }
    return result;
  }

  function verticalText(x, y, options) {
    var result = {
      mode: "verticalText",
      x: x,
      y: y,
      minFontSize: 5.5,
      maxFontSize: 7,
      lineGap: 0,
      groupGap: 8,
      columnGap: 48,
      keys: ["shopName", "date", "phone"],
      phonePrefix: "Tel:",
      omitTip: true
    };
    if (options) {
      Object.keys(options).forEach(function (key) {
        result[key] = cloneObject(options[key]);
      });
    }
    return result;
  }

  function infoStyle(options) {
    var result = {
      background: { red: 176, green: 28, blue: 35 },
      textColor: { red: 255, green: 238, blue: 150 }
    };
    if (options) {
      Object.keys(options).forEach(function (key) {
        result[key] = cloneObject(options[key]);
      });
    }
    return result;
  }

  function makeTemplate(config) {
    var widthPx = cmToPx(config.widthCm);
    var heightPx = cmToPx(config.heightCm);
    var infoBar = config.infoBar || info("none");

    return {
      id: config.id,
      name: config.name,
      shortName: config.shortName || config.name.split(" ")[0],
      documentLabel: config.documentLabel || config.shortName || config.name.split(" ")[0],
      widthCm: config.widthCm,
      heightCm: config.heightCm,
      widthPx: widthPx,
      heightPx: heightPx,
      photoWidthPx: widthPx,
      photoHeightPx: heightPx,
      canvasWidthPx: CANVAS_WIDTH_PX,
      canvasHeightPx: CANVAS_HEIGHT_PX,
      referencePath: referencePath(config.referenceFile),
      referenceFile: config.referenceFile,
      referenceWidthPx: config.referenceWidthPx || CANVAS_WIDTH_PX,
      referenceHeightPx: config.referenceHeightPx || CANVAS_HEIGHT_PX,
      layoutMode: config.layoutMode,
      layoutType: config.layoutMode,
      infoBarPosition: infoBar.enabled ? infoBar.position : "none",
      infoBar: infoBar,
      photoSlots: config.photoSlots.slice(),
      allowRotation: Boolean(config.allowRotation)
    };
  }

  var templates = [
    makeTemplate({
      id: "one-inch",
      name: "1寸 2.7x3.8",
      widthCm: 2.7,
      heightCm: 3.8,
      referenceFile: "2.7x3.8.jpg",
      layoutMode: "template-bottom-info",
      infoBar: info("bottom", 0, 1845, 3592, 555, {
        background: { red: 176, green: 28, blue: 35 },
        textColor: { red: 255, green: 238, blue: 150 },
        avatar: {
          x: 24,
          y: 1924,
          width: 304,
          height: 430,
          mode: "photoThumbnail"
        },
        texts: [
          { key: "shopName", x: 365, y: 1935, width: 1100, height: 55, fontSize: 13, name: "店铺名称" },
          { key: "date", x: 365, y: 0, width: 900, height: 50, fontSize: 12, name: "日期" },
          { key: "phone", x: 365, y: 0, width: 1500, height: 50, fontSize: 11, name: "电话", prefix: "Tel:" },
          { key: "tip", x: 365, y: 0, width: 1500, height: 50, fontSize: 10, name: "提示语" }
        ]
      }),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 639, 899),
        slot(664, 0, 0, 1, 0, 640, 899),
        slot(1328, 0, 0, 2, 0, 640, 899),
        slot(1994, 0, 0, 3, 0, 640, 900),
        slot(2659, 0, 0, 4, 0, 640, 900),
        slot(0, 928, 1, 0, 0, 639, 900),
        slot(664, 928, 1, 1, 0, 640, 900),
        slot(1329, 928, 1, 2, 0, 639, 900),
        slot(1994, 928, 1, 3, 0, 642, 901),
        slot(2660, 928, 1, 4, 0, 641, 900)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "standard-two-inch",
      name: "标准2寸 3.5x4.9",
      widthCm: 3.5,
      heightCm: 4.9,
      referenceFile: "3.5x4.9.jpg",
      layoutMode: "template-right-info",
      infoBar: info("right", 3400, 0, 200, 2400, infoStyle({
        avatar: avatar(3429, 50, 143, 201),
        textLayers: {
          shopNameDate: { x: 3490, y: 280, width: 79, height: 979, fontSize: 83.3 },
          shopName: { x: 3521, y: 282 },
          date: { x: 3467, y: 283 },
          phone: { x: 3428, y: 281, width: 60, height: 820, fontSize: 96 }
        },
        texts: verticalText(3490, 303, {
          maxFontSize: 10,
          minFontSize: 6.4,
          keys: ["shopNameDate", "phone"],
          fontSizes: { shopNameDate: 10, phone: 6.4 },
          separators: { shopNameDate: "" },
          columns: {
            shopNameDate: { x: 3490, y: 303 },
            phone: { x: 3414, y: 302 }
          },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 827, 1158),
        slot(851, 0, 0, 1, 0, 829, 1159),
        slot(1704, 0, 0, 2, 0, 827, 1158),
        slot(2555, 0, 0, 3, 0, 829, 1159),
        slot(0, 1185, 1, 0, 0, 826, 1159),
        slot(851, 1186, 1, 1, 0, 829, 1158),
        slot(1705, 1186, 1, 2, 0, 829, 1158),
        slot(2555, 1186, 1, 3, 0, 829, 1158)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "visa-two-inch",
      name: "签证2寸 3.5x4.5",
      widthCm: 3.5,
      heightCm: 4.5,
      referenceFile: "3.5x4.5.jpg",
      layoutMode: "template-bottom-info",
      infoBar: info("bottom", 0, 2174, 3600, 226, infoStyle({
        avatar: avatar(25, 2189, 141, 181),
        textLayers: {
          shopNameDate: { x: 201, y: 2191, width: 1221, height: 95, fontSize: 11.2 },
          shopName: { x: 185, y: 2183 },
          date: { x: 186, y: 2257 },
          phone: { x: 197, y: 2288, width: 991, height: 71, fontSize: 8.4 }
        },
        texts: horizontalText(201, 2191, {
          useAvatarGap: false,
          minFontSize: 8.4,
          maxFontSize: 12,
          lineGap: 0,
          keys: ["shopNameDate", "phone"],
          fontSizes: { shopNameDate: 12, phone: 8.4 },
          separators: { shopNameDate: "  " },
          columns: {
            shopNameDate: { x: 201, y: 2191 },
            phone: { x: 201, y: 2316 }
          },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 828, 1064),
        slot(853, 0, 0, 1, 0, 827, 1064),
        slot(1705, 0, 0, 2, 0, 829, 1064),
        slot(2559, 0, 0, 3, 0, 828, 1064),
        slot(0, 1096, 1, 0, 0, 828, 1064),
        slot(853, 1096, 1, 1, 0, 827, 1064),
        slot(1705, 1096, 1, 2, 0, 829, 1064),
        slot(2559, 1096, 1, 3, 0, 828, 1064)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "small-two-inch",
      name: "小2寸 3.3x4.8",
      widthCm: 3.3,
      heightCm: 4.8,
      referenceFile: "3.3x4.8.jpg",
      referenceWidthPx: 3579,
      referenceHeightPx: 2386,
      layoutMode: "template-right-info",
      infoBar: info("right", 3239, 0, 361, 2400, infoStyle({
        avatar: avatar(3293, 48, 214, 312),
        textLayers: {
          shopNameDate: { x: 3400, y: 382, width: 102, height: 1273, fontSize: 108.3 },
          phone: { x: 3306, y: 386, width: 72, height: 999, fontSize: 70 }
        },
        texts: verticalText(3400, 382, {
          maxFontSize: 13,
          minFontSize: 8.4,
          keys: ["shopNameDate", "phone"],
          fontSizes: { shopNameDate: 13, phone: 8.4 },
          separators: { shopNameDate: "" },
          columns: {
            shopNameDate: { x: 3400, y: 382 },
            phone: { x: 3275, y: 380 }
          },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 781, 1135),
        slot(813, 0, 0, 1, 0, 781, 1135),
        slot(1625, 0, 0, 2, 0, 781, 1135),
        slot(2438, 0, 0, 3, 0, 781, 1135),
        slot(0, 1167, 1, 0, 0, 782, 1136),
        slot(813, 1167, 1, 1, 0, 782, 1136),
        slot(1625, 1167, 1, 2, 0, 782, 1136),
        slot(2438, 1167, 1, 3, 0, 782, 1136)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "hongkong-taiwan",
      name: "香港台湾 3.0x4.0",
      widthCm: 3.0,
      heightCm: 4.0,
      referenceFile: "3x4.jpg",
      layoutMode: "template-bottom-info",
      infoBar: info("bottom", 0, 1950, 3592, 450, infoStyle({
        avatar: avatar(24, 2017, 235, 313),
        textLayers: {
          shopName: { x: 289, y: 2037, width: 687, height: 95, fontSize: 100 },
          date: { x: 289, y: 2151, width: 436, height: 71, fontSize: 91.7 },
          phone: { x: 289, y: 2244, width: 915, height: 67, fontSize: 70 }
        },
        texts: horizontalText(361, 2090, {
          useAvatarGap: false,
          minFontSize: 8.4,
          maxFontSize: 12,
          lineGap: 0,
          keys: ["shopName", "date", "phone"],
          fontSizes: { shopName: 12, date: 11, phone: 8.4 },
          columns: {
            shopName: { x: 361, y: 2090 },
            date: { x: 361, y: 2230 },
            phone: { x: 361, y: 2320 }
          },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 710, 946),
        slot(733, 0, 0, 1, 0, 711, 947),
        slot(1467, 0, 0, 2, 0, 712, 947),
        slot(2201, 0, 0, 3, 0, 711, 946),
        slot(0, 971, 1, 0, 0, 710, 947),
        slot(732, 971, 1, 1, 0, 712, 947),
        slot(1467, 971, 1, 2, 0, 712, 949),
        slot(2201, 971, 1, 3, 0, 711, 948)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "brazil",
      name: "巴西 4.0x5.0",
      widthCm: 4.0,
      heightCm: 5.0,
      referenceFile: "4x5.jpg",
      layoutMode: "template-right-info",
      infoBar: info("right", 2916, 0, 284, 2400, infoStyle({
        avatar: avatar(2950, 56, 210, 263),
        textLayers: {
          shopNameDate: { x: 3048, y: 339, width: 79, height: 979, fontSize: 83.3 },
          shopName: { x: 3085, y: 340, width: 54, height: 392, fontSize: 56.7 },
          date: { x: 3025, y: 340, width: 41, height: 248, fontSize: 29.2 },
          phone: { x: 2965, y: 340, width: 60, height: 812, fontSize: 53.3 }
        },
        texts: verticalText(3045, 360, {
          maxFontSize: 10,
          minFontSize: 6.4,
          keys: ["shopNameDate", "phone"],
          fontSizes: { shopNameDate: 10, phone: 6.4 },
          separators: { shopNameDate: "" },
          columns: {
            shopNameDate: { x: 3045, y: 360 },
            phone: { x: 2968, y: 372 }
          },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 946, 1182),
        slot(968, 0, 0, 1, 0, 948, 1182),
        slot(1939, 0, 0, 2, 0, 947, 1182),
        slot(0, 1201, 1, 0, 0, 946, 1183),
        slot(970, 1201, 1, 1, 0, 946, 1183),
        slot(1939, 1202, 1, 2, 0, 948, 1182)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "argentina",
      name: "阿根廷 4.0x4.0",
      widthCm: 4.0,
      heightCm: 4.0,
      referenceFile: "4x4.jpg",
      layoutMode: "template-bottom-info",
      infoBar: info("bottom", 0, 1945, 3600, 455, infoStyle({
        avatar: avatar(70, 2016, 342, 342),
        textLayers: {
          shopName: { x: 469, y: 1986, width: 687, height: 95, fontSize: 100 },
          date: { x: 468, y: 2090, width: 436, height: 71, fontSize: 91.7 },
          phone: { x: 469, y: 2188, width: 1090, height: 79, fontSize: 83.3 },
          tip: { x: 469, y: 2279, width: 636, height: 74, fontSize: 75 }
        },
        texts: horizontalText(469, 1986, {
          useAvatarGap: false,
          minFontSize: 9,
          maxFontSize: 12,
          lineGap: 0,
          keys: ["shopName", "date", "phone", "tip"],
          fontSizes: { shopName: 12, date: 11, phone: 10, tip: 9 },
          columns: {
            shopName: { x: 469, y: 1986 },
            date: { x: 468, y: 2090 },
            phone: { x: 469, y: 2188 },
            tip: { x: 469, y: 2279 }
          }
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 948, 948),
        slot(977, 0, 0, 1, 0, 946, 946),
        slot(1953, 0, 0, 2, 0, 947, 946),
        slot(0, 977, 1, 0, 0, 947, 947),
        slot(976, 976, 1, 1, 0, 947, 950),
        slot(1953, 977, 1, 2, 0, 947, 947)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "us-visa",
      name: "美签 5.0x5.0",
      shortName: "美签5.0",
      documentLabel: "美签5.0",
      widthCm: 5.0,
      heightCm: 5.0,
      referenceFile: "5x5.jpg",
      layoutMode: "template-five-corner-info",
      infoBar: info("bottom", 2420, 1200, 1180, 1181, infoStyle()),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 1182, 1182),
        slot(1210, 0, 0, 1, 0, 1182, 1183),
        slot(2419, 0, 0, 2, 0, 1181, 1181),
        slot(0, 1200, 1, 0, 0, 1182, 1182),
        slot(1210, 1200, 1, 1, 0, 1182, 1183)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "us-visa-51",
      name: "美签 5.1x5.1",
      shortName: "美签5.1x5.1",
      documentLabel: "美签5.1x5.1",
      widthCm: 5.1,
      heightCm: 5.1,
      referenceFile: "5.1x5.1.jpg",
      layoutMode: "template-fixed-2-bottom-info",
      infoBar: info("bottom", 0, 1268, 3590, 369, infoStyle({
        avatar: thumbnailAvatar(34, 1312, 280, 280, { scaleMode: "fixedFit" }),
        textLayers: {
          shopName: { x: 365, y: 1319, width: 630, height: 87, fontSize: 10.2 },
          date: { x: 365, y: 1420, width: 399, height: 65, fontSize: 7.6 },
          phone: { x: 365, y: 1499, width: 980, height: 71, fontSize: 8.4 }
        },
        texts: horizontalText(365, 1340, {
          useAvatarGap: false,
          width: 3145,
          minFontSize: 7,
          maxFontSize: 11,
          lineGap: 6,
          rightPadding: 80,
          bottomPadding: 34,
          keys: ["shopName", "date", "phone"],
          fontSizes: { shopName: 11, date: 10, phone: 9 },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 1206, 1206),
        slot(1229, 0, 0, 1, 0, 1206, 1206)
      ],
      allowRotation: false
    }),
    makeTemplate({
      id: "graduation",
      name: "毕业证 4.0x5.5",
      widthCm: 4.0,
      heightCm: 5.5,
      referenceFile: "4x5.5.jpg",
      layoutMode: "template-special-right-info",
      infoBar: info("right", 2943, 0, 273, 2400, infoStyle({
        avatar: avatar(2978, 53, 205, 281),
        textLayers: {
          shopNameDate: { x: 3076, y: 346, width: 79, height: 979, fontSize: 83.3 },
          shopName: { x: 3102, y: 354, width: 54, height: 392, fontSize: 56.7 },
          date: { x: 3040, y: 354, width: 41, height: 248, fontSize: 29.2 },
          phone: { x: 3003, y: 347, width: 51, height: 696, fontSize: 53.3 }
        },
        texts: verticalText(3072, 370, {
          maxFontSize: 10,
          minFontSize: 6.4,
          keys: ["shopNameDate", "phone"],
          fontSizes: { shopNameDate: 10, phone: 6.4 },
          separators: { shopNameDate: "" },
          columns: {
            shopNameDate: { x: 3072, y: 370 },
            phone: { x: 2995, y: 372 }
          },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(0, 0, 0, 0, 0, 949, 1301),
        slot(977, 0, 0, 1, 0, 948, 1300),
        slot(1957, 0, 0, 2, 0, 947, 1302),
        slot(0, 1323, 1, 0, 90, 1303, 949),
        slot(1341, 1324, 1, 1, 90, 1303, 948)
      ],
      allowRotation: true
    }),
    makeTemplate({
      id: "wedding",
      name: "结婚照 5.3x3.5",
      widthCm: 5.3,
      heightCm: 3.5,
      referenceFile: "3.5x5.3.jpg",
      layoutMode: "template-special-bottom-info",
      infoBar: info("bottom", 0, 1795, 3592, 555, infoStyle({
        avatar: thumbnailAvatar(0, 1872, 577, 382, { scaleMode: "fixedFit" }),
        texts: horizontalText(618, 1933, {
          useAvatarGap: false,
          width: 2894,
          minFontSize: 10,
          maxFontSize: 13,
          lineGap: 0,
          keys: ["shopName", "date", "phone"],
          fontSizes: { shopName: 13, date: 12, phone: 10 },
          columns: {
            shopName: { x: 618, y: 1933 },
            date: { x: 618, y: 2048 },
            phone: { x: 618, y: 2165 }
          },
          omitTip: true
        })
      })),
      photoSlots: [
        slot(20, 24, 0, 0, 0, 1252, 829),
        slot(1313, 24, 0, 1, 0, 1253, 829),
        slot(19, 894, 1, 0, 0, 1253, 828),
        slot(1312, 893, 1, 1, 0, 1256, 829),
        slot(2608, 24, 0, 2, 90, 828, 1254)
      ],
      allowRotation: true
    })
  ];

  // The registry retains v0.5.8 ordinary layouts. Delivery strips are selected
  // for the actual operation, never by a process-wide mode at module load time.
  function forDelivery(template, enabled) {
    var next = cloneObject(template);
    if (!next) return next;
    var original = next.ordinaryInfoBar || next.infoBar;
    var area = next.deliveryArea || next.infoBar;
    next.infoBar = cloneObject(original);
    if (!enabled) return next;
    var bar = cloneObject(area), vertical = bar.orientation === "vertical";
    bar.layoutVersion = 7;
    bar.pickupLayout = "v5";
    bar.safeMargin = 24;
    bar.width = Math.min(bar.width, vertical ? 555 : 1417);
    bar.height = Math.min(bar.height, vertical ? 1417 : 555);
    bar.background = { red: 151, green: 37, blue: 42 };
    bar.textColor = { red: 249, green: 233, blue: 160 };
    delete bar.textLayers;
    delete bar.texts;
    delete bar.avatar;
    next.infoBar = bar;
    return next;
  }
  var referenceFiles = {
    "one-inch": "证件照排版_1寸_2026-09-27.jpg", "standard-two-inch": "证件照排版_标准2寸_2026-09-27.jpg",
    "visa-two-inch": "证件照排版_签证2寸_2026-09-27.jpg", "small-two-inch": "证件照排版_小2寸_2026-09-27.jpg",
    "hongkong-taiwan": "证件照排版_香港台湾_2026-09-27.jpg", "brazil": "证件照排版_巴西_2026-09-27.jpg",
    "argentina": "证件照排版_阿根廷_2026-09-27.jpg", "us-visa": "证件照排版_美签5.jpg",
    "us-visa-51": "证件照排版_美签5.1x5.jpg", "graduation": "证件照排版_毕业证_2026-09-27.jpg",
    "wedding": "证件照排版_结婚照_2026-09-27.jpg"
  };
  templates.forEach(function (template) {
    template.deliveryArea = cloneObject(template.infoBar);
    if (template.id === "us-visa") template.infoBar = info("none");
    template.ordinaryInfoBar = cloneObject(template.infoBar);
    template.referenceFile = referenceFiles[template.id];
    template.referencePath = referencePath(template.referenceFile);
  });

  function normalizeName(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
  }

  function getAllTemplates() {
    return templates.slice();
  }

  function getTemplateByName(name) {
    var normalized = normalizeName(name);
    return (
      templates.find(function (template) {
        return normalizeName(template.name) === normalized;
      }) || null
    );
  }

  function getTemplateById(id) {
    return (
      templates.find(function (template) {
        return template.id === id;
      }) || null
    );
  }

  window.IDPhotoTemplates = {
    PPI: PPI,
    CANVAS_WIDTH_PX: CANVAS_WIDTH_PX,
    CANVAS_HEIGHT_PX: CANVAS_HEIGHT_PX,
    REFERENCE_ROOT: REFERENCE_ROOT,
    forDelivery: forDelivery,
    getAllTemplates: getAllTemplates,
    getTemplateByName: getTemplateByName,
    getTemplateById: getTemplateById
  };
})();
