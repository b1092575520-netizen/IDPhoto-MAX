(function () {
  "use strict";

  function sanitizeFilePart(value) {
    return String(value || "未命名")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "")
      .replace(/_+/g, "_");
  }

  function stripExtension(name) {
    return String(name || "未命名").replace(/\.[^.]+$/, "");
  }

  function getDateParts() {
    if (window.IDPhotoDateService && window.IDPhotoDateService.getTodayParts) {
      return window.IDPhotoDateService.getTodayParts();
    }
    var now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate()
    };
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function getDateFolders() {
    var parts = getDateParts();
    var year = String(parts.year);
    var month = year + "-" + pad(parts.month);
    var day = month + "-" + pad(parts.day);
    return {
      year: year,
      month: month,
      day: day
    };
  }

  function hash32(value, seed) {
    var hash = seed >>> 0;
    var text = String(value || "");
    var index;
    for (index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function makeJpgVariantToken(variant, sourceName) {
    var identity = variant && (
      variant.identityMarker ||
      variant.stableSourceId ||
      variant.personFingerprint
    );
    if (variant && variant.unverifiableStrongSourceId) {
      identity = "unverifiable:" + stripExtension(sourceName);
    }
    var value = identity || "source:" + stripExtension(sourceName);
    var token = hash32(value, 2166136261).toString(36).toUpperCase();
    return ("000000" + token).slice(-6);
  }

  function getTemplateFilePart(templateName) {
    var value = String(templateName || "未命名").trim();
    return sanitizeFilePart(value.split(/\s+/)[0] || "未命名");
  }

  function getBackgroundFilePart(backgroundColor) {
    return {
      red: "红",
      blue: "蓝",
      white: "白",
      unknown: "未知"
    }[String(backgroundColor || "unknown")] || "未知";
  }

  function makeJpgFileName(templateName, sourceName, widthPx, heightPx, variant) {
    var sizePart = Number(widthPx) > 0 && Number(heightPx) > 0
      ? Math.round(widthPx) + "x" + Math.round(heightPx)
      : "未指定尺寸";
    var background = variant && /^(red|blue|white|unknown)$/.test(String(variant.backgroundColor || ""))
      ? String(variant.backgroundColor)
      : "unknown";
    return getTemplateFilePart(templateName) + "_" + sizePart + "_" + getBackgroundFilePart(background) + "_" +
      makeJpgVariantToken(variant, sourceName) + ".jpg";
  }

  function makeJpgSourceKey(sourceName) {
    return sanitizeFilePart(stripExtension(sourceName));
  }

  window.IDPhotoPathService = {
    sanitizeFilePart: sanitizeFilePart,
    stripExtension: stripExtension,
    getDateFolders: getDateFolders,
    makeJpgFileName: makeJpgFileName,
    makeJpgSourceKey: makeJpgSourceKey,
    makeJpgVariantToken: makeJpgVariantToken,
    getBackgroundFilePart: getBackgroundFilePart
  };
})();
