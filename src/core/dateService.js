(function () {
  "use strict";

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function getTodayParts() {
    var now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate()
    };
  }

  function formatDisplayDate() {
    var parts = getTodayParts();
    return parts.year + ". " + parts.month + ". " + parts.day;
  }

  function formatFileDate() {
    var parts = getTodayParts();
    return parts.year + "-" + pad(parts.month) + "-" + pad(parts.day);
  }

  function makeDocumentName(templateName) {
    return "证件照排版_" + String(templateName || "未命名尺寸").replace(/\s+/g, "") + "_" + formatFileDate();
  }

  window.IDPhotoDateService = {
    getTodayParts: getTodayParts,
    formatDisplayDate: formatDisplayDate,
    formatFileDate: formatFileDate,
    makeDocumentName: makeDocumentName
  };
})();
