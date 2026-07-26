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

  function makeJpgFileName(templateName, sourceName, widthPx, heightPx) {
    var folders = getDateFolders();
    var sizePart = Number(widthPx) > 0 && Number(heightPx) > 0 ? "_" + Math.round(widthPx) + "x" + Math.round(heightPx) : "";
    return folders.day + "_" + sanitizeFilePart(templateName) + sizePart + "_" + sanitizeFilePart(stripExtension(sourceName)) + ".jpg";
  }

  function makeJpgSourceKey(sourceName) {
    return sanitizeFilePart(stripExtension(sourceName));
  }

  window.IDPhotoPathService = {
    sanitizeFilePart: sanitizeFilePart,
    stripExtension: stripExtension,
    getDateFolders: getDateFolders,
    makeJpgFileName: makeJpgFileName,
    makeJpgSourceKey: makeJpgSourceKey
  };
})();
