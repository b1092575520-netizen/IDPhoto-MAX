(function () {
  "use strict";

  function classifyPixel(red, green, blue) {
    var maxChannel = Math.max(red, green, blue);
    var minChannel = Math.min(red, green, blue);
    if (maxChannel - minChannel <= 35 && (red + green + blue) / 3 >= 175) {
      return "white";
    }
    if (red >= 100 && red >= green * 1.25 && red >= blue * 1.2) {
      return "red";
    }
    if (blue >= 90 && blue >= red * 1.18 && blue >= green * 1.15) {
      return "blue";
    }
    return "unknown";
  }

  function isBorderPixel(x, y, width, height) {
    return y < Math.ceil(height * 0.22) || x < Math.ceil(width * 0.16) || x >= Math.floor(width * 0.84);
  }

  function classifyBackground(sample) {
    var width = Math.max(1, Math.round(Number(sample && sample.width) || 0));
    var height = Math.max(1, Math.round(Number(sample && sample.height) || 0));
    var components = Math.max(3, Math.round(Number(sample && sample.components) || 3));
    var data = sample && sample.data ? sample.data : [];
    var counts = { red: 0, blue: 0, white: 0 };
    var borderCount = 0;
    var x;
    var y;
    var offset;
    var label;
    var winner = "unknown";
    var winnerCount = 0;

    for (y = 0; y < height; y += 1) {
      for (x = 0; x < width; x += 1) {
        if (!isBorderPixel(x, y, width, height)) {
          continue;
        }
        offset = (y * width + x) * components;
        label = classifyPixel(Number(data[offset]) || 0, Number(data[offset + 1]) || 0, Number(data[offset + 2]) || 0);
        borderCount += 1;
        if (counts[label] !== undefined) {
          counts[label] += 1;
          if (counts[label] > winnerCount) {
            winner = label;
            winnerCount = counts[label];
          }
        }
      }
    }

    return borderCount > 0 && winnerCount / borderCount >= 0.55 ? winner : "unknown";
  }

  function readGray(sample, x, y) {
    var width = Math.max(1, Math.round(Number(sample && sample.width) || 0));
    var height = Math.max(1, Math.round(Number(sample && sample.height) || 0));
    var components = Math.max(3, Math.round(Number(sample && sample.components) || 3));
    var data = sample && sample.data ? sample.data : [];
    var safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
    var safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
    var offset = (safeY * width + safeX) * components;
    return (
      (Number(data[offset]) || 0) * 0.299 +
      (Number(data[offset + 1]) || 0) * 0.587 +
      (Number(data[offset + 2]) || 0) * 0.114
    );
  }

  function makePersonFingerprint(sample) {
    var width = Math.max(1, Math.round(Number(sample && sample.width) || 0));
    var height = Math.max(1, Math.round(Number(sample && sample.height) || 0));
    var values = [];
    var sorted;
    var median;
    var hex = "";
    var row;
    var col;
    var x;
    var y;
    var dx;
    var dy;
    var nibble;
    var bit;

    for (row = 0; row < 8; row += 1) {
      for (col = 0; col < 8; col += 1) {
        x = width * (0.22 + ((col + 0.5) / 8) * 0.56);
        y = height * (0.1 + ((row + 0.5) / 8) * 0.72);
        dx = Math.abs(readGray(sample, x + width / 64, y) - readGray(sample, x - width / 64, y));
        dy = Math.abs(readGray(sample, x, y + height / 64) - readGray(sample, x, y - height / 64));
        values.push(dx + dy);
      }
    }
    sorted = values.slice().sort(function (left, right) { return left - right; });
    median = sorted[Math.floor(sorted.length / 2)] || 0;
    for (nibble = 0; nibble < 16; nibble += 1) {
      bit = 0;
      for (col = 0; col < 4; col += 1) {
        if (values[nibble * 4 + col] > median) {
          bit |= 1 << (3 - col);
        }
      }
      hex += bit.toString(16);
    }
    return hex;
  }

  function readRgb(sample, x, y) {
    var width = Math.max(1, Math.round(Number(sample && sample.width) || 0));
    var height = Math.max(1, Math.round(Number(sample && sample.height) || 0));
    var components = Math.max(3, Math.round(Number(sample && sample.components) || 3));
    var data = sample && sample.data ? sample.data : [];
    var safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
    var safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
    var offset = (safeY * width + safeX) * components;
    return [Number(data[offset]) || 0, Number(data[offset + 1]) || 0, Number(data[offset + 2]) || 0];
  }

  function normalizeValues(values) {
    var mean = values.reduce(function (sum, value) { return sum + value; }, 0) / Math.max(1, values.length);
    var variance = values.reduce(function (sum, value) {
      return sum + Math.pow(value - mean, 2);
    }, 0) / Math.max(1, values.length);
    var scale = Math.max(8, Math.sqrt(variance));
    return values.map(function (value) {
      return Math.max(0, Math.min(15, Math.round(((value - mean) / scale + 2) * 3.75)));
    });
  }

  function encodeNibbles(values) {
    return values.map(function (value) { return Number(value).toString(16); }).join("");
  }

  function makeBlockValues(sample, columns, rows, reader, bounds) {
    var width = Math.max(1, Math.round(Number(sample && sample.width) || 0));
    var height = Math.max(1, Math.round(Number(sample && sample.height) || 0));
    var values = [];
    var row;
    var col;
    var x;
    var y;
    var sum;
    var count;
    var startX;
    var endX;
    var startY;
    var endY;
    bounds = bounds || { left: 0.22, right: 0.78, top: 0.12, bottom: 0.82 };
    for (row = 0; row < rows; row += 1) {
      startY = Math.floor(height * (bounds.top + (row / rows) * (bounds.bottom - bounds.top)));
      endY = Math.max(startY + 1, Math.floor(height * (bounds.top + ((row + 1) / rows) * (bounds.bottom - bounds.top))));
      for (col = 0; col < columns; col += 1) {
        startX = Math.floor(width * (bounds.left + (col / columns) * (bounds.right - bounds.left)));
        endX = Math.max(startX + 1, Math.floor(width * (bounds.left + ((col + 1) / columns) * (bounds.right - bounds.left))));
        sum = 0;
        count = 0;
        for (y = startY; y < endY; y += 1) {
          for (x = startX; x < endX; x += 1) {
            sum += reader(sample, x, y);
            count += 1;
          }
        }
        values.push(count ? sum / count : 0);
      }
    }
    return values;
  }

  function makeVisualSignatureAtOffset(sample, offsetX) {
    var width = Math.max(1, Math.round(Number(sample && sample.width) || 0));
    var offset = offsetX / width;
    var faceBounds = { left: 0.32 + offset, right: 0.68 + offset, top: 0.22, bottom: 0.68 };
    var structure = normalizeValues(makeBlockValues(sample, 4, 4, readGray, faceBounds));
    var edges = normalizeValues(makeBlockValues(sample, 3, 3, function (source, x, y) {
      return Math.abs(readGray(source, x + 1, y) - readGray(source, x - 1, y)) +
        Math.abs(readGray(source, x, y + 1) - readGray(source, x, y - 1));
    }, faceBounds));
    var redGreen = makeBlockValues(sample, 3, 3, function (source, x, y) {
      var rgb = readRgb(source, x, y);
      return rgb[0] - rgb[1];
    }, faceBounds);
    var blueGreen = makeBlockValues(sample, 3, 3, function (source, x, y) {
      var rgb = readRgb(source, x, y);
      return rgb[2] - rgb[1];
    }, faceBounds);
    var chroma = redGreen.concat(blueGreen).map(function (value) {
      return Math.max(0, Math.min(15, Math.round(value / 24 + 8)));
    });
    return {
      structure: encodeNibbles(structure),
      edges: encodeNibbles(edges),
      chroma: encodeNibbles(chroma)
    };
  }

  function makeVisualSignature(sample) {
    var variants = [-1, 0, 1].map(function (offsetX) {
      return makeVisualSignatureAtOffset(sample, offsetX);
    });
    return {
      version: 2,
      structure: variants[1].structure,
      edges: variants[1].edges,
      chroma: variants[1].chroma,
      variants: variants
    };
  }

  function nibbleDistance(left, right, expectedLength) {
    var a = String(left || "").toLowerCase();
    var b = String(right || "").toLowerCase();
    var total = 0;
    var index;
    if (a.length !== expectedLength || b.length !== expectedLength || !/^[a-f0-9]+$/.test(a + b)) {
      return Infinity;
    }
    for (index = 0; index < expectedLength; index += 1) {
      total += Math.abs(parseInt(a.charAt(index), 16) - parseInt(b.charAt(index), 16));
    }
    return total / expectedLength;
  }

  function compareIdentity(left, right) {
    var leftStable = String(left && (left.stableSourceId || left.stableSourceMarker) || "");
    var rightStable = String(right && (right.stableSourceId || right.stableSourceMarker) || "");
    var leftVisual = left && left.visualSignature;
    var rightVisual = right && right.visualSignature;
    var leftVariants;
    var rightVariants;
    var best = null;
    var leftIndex;
    var rightIndex;
    var candidate;
    if (left && left.unverifiableStrongSourceId || right && right.unverifiableStrongSourceId) {
      return { kind: "ambiguous", reason: "unverifiable-strong-source-id" };
    }
    if (leftStable && rightStable) {
      return leftStable === rightStable
        ? { kind: "stable-source", reason: "strong-source-id" }
        : { kind: "ambiguous", reason: "conflicting-strong-source-id" };
    }
    if (!(leftVisual && rightVisual && leftVisual.version === 2 && rightVisual.version === 2)) {
      return { kind: "ambiguous", reason: "missing-visual-signature" };
    }
    leftVariants = leftVisual.variants && leftVisual.variants.length ? leftVisual.variants : [leftVisual];
    rightVariants = rightVisual.variants && rightVisual.variants.length ? rightVisual.variants : [rightVisual];
    for (leftIndex = 0; leftIndex < leftVariants.length; leftIndex += 1) {
      for (rightIndex = 0; rightIndex < rightVariants.length; rightIndex += 1) {
        candidate = {
          structure: nibbleDistance(leftVariants[leftIndex].structure, rightVariants[rightIndex].structure, 16),
          edges: nibbleDistance(leftVariants[leftIndex].edges, rightVariants[rightIndex].edges, 9),
          chroma: nibbleDistance(leftVariants[leftIndex].chroma, rightVariants[rightIndex].chroma, 18)
        };
        candidate.score = candidate.structure + candidate.edges + candidate.chroma;
        if (!best || candidate.score < best.score) {
          best = candidate;
        }
      }
    }
    if (best.structure <= 0.3 && best.edges <= 2.25 && best.chroma <= 1.25) {
      return {
        kind: "visual-high",
        reason: "all-visual-signals-match",
        distances: { structure: best.structure, edges: best.edges, chroma: best.chroma }
      };
    }
    return {
      kind: "ambiguous",
      reason: "visual-signals-conflict",
      distances: { structure: best.structure, edges: best.edges, chroma: best.chroma }
    };
  }

  function encodeUtf8Hex(value) {
    var encoded;
    var hex = "";
    var index;
    try {
      encoded = encodeURIComponent(String(value || ""));
    } catch (error) {
      return "";
    }
    for (index = 0; index < encoded.length; index += 1) {
      if (encoded.charAt(index) === "%" && /^[a-f0-9]{2}$/i.test(encoded.slice(index + 1, index + 3))) {
        hex += encoded.slice(index + 1, index + 3).toLowerCase();
        index += 2;
      } else {
        hex += ("0" + encoded.charCodeAt(index).toString(16)).slice(-2);
      }
    }
    return hex;
  }

  function decodeUtf8Hex(hex) {
    var value = String(hex || "");
    var encoded = "";
    var index;
    if (!value || value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) {
      return "";
    }
    for (index = 0; index < value.length; index += 2) {
      encoded += "%" + value.slice(index, index + 2);
    }
    try {
      return decodeURIComponent(encoded);
    } catch (error) {
      return "";
    }
  }

  function makeStableSourceMarker(stableSourceId) {
    var value = String(stableSourceId || "");
    var type;
    var rawId;
    var encoded;
    if (value.indexOf("image-unique-id:") === 0) {
      type = "i";
      rawId = value.slice("image-unique-id:".length);
    } else if (value.indexOf("original-document-id:") === 0) {
      type = "o";
      rawId = value.slice("original-document-id:".length);
    } else {
      return "";
    }
    encoded = encodeUtf8Hex(rawId);
    return encoded && encoded.length <= 156 ? "s2" + type + encoded : "";
  }

  function serializeIdentity(analysis) {
    var stableMarker = makeStableSourceMarker(analysis && analysis.stableSourceId);
    var visual = analysis && analysis.visualSignature;
    var variants;
    if (stableMarker) {
      return stableMarker;
    }
    if (analysis && analysis.stableSourceId) {
      return "u2";
    }
    if (!(visual && visual.version === 2)) {
      return "";
    }
    variants = visual.variants && visual.variants.length === 3 ? visual.variants : [visual];
    if (variants.length !== 3) {
      return "";
    }
    return "v2" + variants.map(function (variant) {
      return String(variant.structure || "") + String(variant.edges || "") + String(variant.chroma || "");
    }).join("");
  }

  function parseIdentityMarker(marker) {
    var value = String(marker || "").toLowerCase();
    var variants = [];
    var stableMatch;
    var stableValue;
    var offset;
    var chunk;
    if (value === "u2") {
      return { unverifiableStrongSourceId: true };
    }
    stableMatch = value.match(/^s2([io])([a-f0-9]{2,156})$/);
    if (stableMatch && stableMatch[2].length % 2 === 0) {
      stableValue = decodeUtf8Hex(stableMatch[2]);
      if (stableValue) {
        return {
          stableSourceId: (stableMatch[1] === "i" ? "image-unique-id:" : "original-document-id:") + stableValue,
          stableSourceMarker: value
        };
      }
    }
    if (!/^v2[a-f0-9]{129}$/.test(value)) {
      return null;
    }
    for (offset = 2; offset < value.length; offset += 43) {
      chunk = value.slice(offset, offset + 43);
      variants.push({
        structure: chunk.slice(0, 16),
        edges: chunk.slice(16, 25),
        chroma: chunk.slice(25, 43)
      });
    }
    return {
      visualSignature: {
        version: 2,
        structure: variants[1].structure,
        edges: variants[1].edges,
        chroma: variants[1].chroma,
        variants: variants
      }
    };
  }

  function hammingDistance(left, right) {
    var a = String(left || "").toLowerCase();
    var b = String(right || "").toLowerCase();
    var distance = 0;
    var index;
    var value;
    if (!/^[a-f0-9]{16}$/.test(a) || !/^[a-f0-9]{16}$/.test(b)) {
      return 64;
    }
    for (index = 0; index < 16; index += 1) {
      value = parseInt(a.charAt(index), 16) ^ parseInt(b.charAt(index), 16);
      while (value) {
        distance += value & 1;
        value >>>= 1;
      }
    }
    return distance;
  }

  function isSamePerson(left, right) {
    return hammingDistance(left, right) <= 2;
  }

  function hash32(value, seed) {
    var hash = seed >>> 0;
    var text = String(value || "");
    var index;
    for (index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return ("00000000" + hash.toString(16)).slice(-8);
  }

  function makeSourceFingerprint(sourceName) {
    var normalized = String(sourceName || "未命名").replace(/\s+/g, "").toLowerCase();
    var reversed = normalized.split("").reverse().join("");
    return hash32(normalized, 2166136261) + hash32(reversed, 2246822519);
  }

  function analyzeSample(sample) {
    return {
      backgroundColor: classifyBackground(sample),
      personFingerprint: makePersonFingerprint(sample),
      visualSignature: makeVisualSignature(sample)
    };
  }

  async function analyzeDocument(documentRef) {
    var photoshop;
    if (typeof require !== "function") {
      throw new Error("当前环境无法读取 Photoshop 像素");
    }
    photoshop = require("photoshop");
    if (!photoshop || !photoshop.imaging || typeof photoshop.imaging.getPixels !== "function") {
      throw new Error("当前 Photoshop 不支持轻量像素采样");
    }
    if (!documentRef || !(Number(documentRef.id) > 0)) {
      throw new Error("当前处理照片缺少有效文档编号");
    }
    if (!window.IDPhotoPhotoshopExecution || typeof window.IDPhotoPhotoshopExecution.executeAsModal !== "function") {
      throw new Error("photoshopExecution 未加载，无法在安全作用域读取像素");
    }
    return await window.IDPhotoPhotoshopExecution.executeAsModal(
      async function () {
        var pixels = await photoshop.imaging.getPixels({
          documentID: Number(documentRef.id),
          targetSize: { width: 32, height: 32 },
          colorSpace: "RGB",
          componentSize: 8,
          applyAlpha: false
        });
        var imageData = pixels && pixels.imageData;
        var data;
        if (!imageData || typeof imageData.getData !== "function") {
          throw new Error("Photoshop 未返回可用的像素样本");
        }
        try {
          data = await imageData.getData();
          return analyzeSample({
            width: Number(imageData.width) || 32,
            height: Number(imageData.height) || 32,
            components: Number(imageData.components) || 3,
            data: data
          });
        } finally {
          if (typeof imageData.dispose === "function") {
            imageData.dispose();
          }
        }
      },
      "识别证件照底色"
    );
  }

  window.IDPhotoVariantService = {
    analyzeSample: analyzeSample,
    analyzeDocument: analyzeDocument,
    isSamePerson: isSamePerson,
    compareIdentity: compareIdentity,
    serializeIdentity: serializeIdentity,
    parseIdentityMarker: parseIdentityMarker,
    makeSourceFingerprint: makeSourceFingerprint
  };
})();
