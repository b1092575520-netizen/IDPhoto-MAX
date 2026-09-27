(function () {
  "use strict";
  function name(value) {
    return typeof value === "string" && value.length > 4 && value.length <= 120 && /\.jpe?g$/i.test(value) &&
      !/[\\/:*?"<>|\x00-\x1f]/.test(value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
  }
  function normalize(items, source) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error("每批请确认 1–20 份独立 JPG。");
    var seen = {};
    return items.map(function (item) {
      if (!name(item.filename) || seen[item.filename.toLowerCase()]) throw new Error("JPG 文件名不合法或重复，请更名。");
      seen[item.filename.toLowerCase()] = true;
      var width = item.width || source.width, height = item.height || source.height;
      if (Boolean(item.width) !== Boolean(item.height)) throw new Error("像素宽高需同时填写，或同时留空保留原尺寸。");
      if (![width, height].every(function (n) { return Number.isInteger(n) && n > 0; }) || width * height > 20000000) throw new Error("成片尺寸必须为正整数且不超过 2000 万像素。");
      if (width > source.width || height > source.height) throw new Error("不能把小图放大当高清；请改用合格原片。");
      if (Math.abs(width / source.width - height / source.height) > Math.max(1 / source.width, 1 / source.height)) throw new Error("目标比例不同，请先明确裁切照片，再生成对应规格；不会静默裁切或拉伸。");
      var minimum = item.minBytes || 0, maximum = item.maxBytes || 8388608, quality = item.minQuality == null ? 8 : item.minQuality;
      if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum < 4 || maximum > 8388608 || minimum > maximum || !Number.isInteger(quality) || quality < 1 || quality > 12) throw new Error("大小范围或最低 JPEG 品质无效（品质为 1–12）。");
      if ((item.purpose || "").length > 120 || (item.background || "").length > 80) throw new Error("用途或底色文字过长。");
      return { filename: item.filename, width: width, height: height, minBytes: minimum, maxBytes: maximum, minQuality: quality, purpose: item.purpose || "", background: item.background || "" };
    });
  }
  function jpegDimensions(input) {
    var b = new Uint8Array(input), i = 2;
    if (b.length < 4 || b[0] !== 255 || b[1] !== 216 || b[b.length - 2] !== 255 || b[b.length - 1] !== 217) throw new Error("编码结果不是完整 JPG。");
    while (i + 4 < b.length) {
      if (b[i++] !== 255) throw new Error("JPG 段标记不合法。");
      while (b[i] === 255) i++;
      var marker = b[i++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      var length = b[i] * 256 + b[i + 1];
      if (length < 2 || i + length > b.length) throw new Error("JPG 数据段不完整。");
      if ([192, 193, 194].indexOf(marker) !== -1) {
        if (length < 8) throw new Error("JPG 尺寸段不完整。");
        return { width: b[i + 5] * 256 + b[i + 6], height: b[i + 3] * 256 + b[i + 4] };
      }
      i += length;
    }
    throw new Error("未读取到支持的 JPG 编码尺寸。");
  }
  function verify(input, spec) {
    var size = input.byteLength, dimensions = jpegDimensions(input);
    if (dimensions.width !== spec.width || dimensions.height !== spec.height) throw new Error("真实 JPG 像素不符合确认要求，未交付。");
    return size >= spec.minBytes && size <= spec.maxBytes;
  }
  function target(value) {
    if (!value || value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.deliveryId || "") || !/^[a-f0-9]{64}$/.test(value.contextKey || "") || !Number.isInteger(value.groupVersion) || value.groupVersion < 0 || !/^(?=.*[A-Z])(?=.*[2-9])[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(value.code || "") || typeof value.title !== "string") throw new Error("请使用后台导出的目标交付核对文件。");
    return { deliveryId: value.deliveryId, contextKey: value.contextKey, groupVersion: value.groupVersion, code: value.code, title: value.title, preview: typeof value.preview === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.preview) ? value.preview : "" };
  }
  window.IDPhotoDeliverySpecifications = { normalize: normalize, verify: verify, jpegDimensions: jpegDimensions, target: target, validName: name };
})();
