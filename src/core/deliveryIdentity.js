(function () {
  "use strict";

  function normalizeOriginalId(value) {
    var text = String(value || "").trim().toLowerCase();
    var match = text.match(/^(?:(?:uuid|xmp\.did):)?([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/);
    var id = match ? match[1].replace(/-/g, "") : "";
    return id && !/^0+$/.test(id) ? id : "";
  }

  function normalizeCaptureTime(value, subsecond) {
    var text = String(value || "").trim();
    var match = text.match(/^(\d{4})([-:])(\d{2})\2(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|[+-](\d{2}):?(\d{2}))?$/);
    var separate = String(subsecond || "").trim();
    var fraction;
    var date;
    if (!match || (separate && !/^\d{1,9}$/.test(separate))) {
      return "";
    }
    date = new Date(Date.UTC(Number(match[1]), Number(match[3]) - 1, Number(match[4])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[3]) - 1 ||
        date.getUTCDate() !== Number(match[4]) || Number(match[5]) > 23 || Number(match[6]) > 59 || Number(match[7]) > 59 ||
        match[9] && (Number(match[9]) > 14 || Number(match[10]) > 59 || Number(match[9]) === 14 && Number(match[10]) !== 0)) {
      return "";
    }
    fraction = String(match[8] || separate || "").replace(/0+$/, "");
    if (match[8] && separate && match[8].replace(/0+$/, "") !== separate.replace(/0+$/, "")) {
      return "";
    }
    return match[1] + "-" + match[3] + "-" + match[4] + "T" + match[5] + ":" + match[6] + ":" + match[7] +
      (fraction ? "." + fraction : "");
  }

  function getSourceIdentity(input) {
    var metadata = input && input.sourceMetadata || input || {};
    var serial = String(metadata.serialNumber || "").replace(/\s+/g, "").toUpperCase();
    var captureTime = normalizeCaptureTime(metadata.captureDate, metadata.captureSubsecond);
    var imageId = normalizeOriginalId(metadata.imageUniqueId);
    var originalId = normalizeOriginalId(metadata.originalDocumentId);
    var legacy = String(input && input.stableSourceId || "");
    var legacyMatch = legacy.match(/^(image-unique-id|original-document-id):(.+)$/);
    var legacyId = legacyMatch ? normalizeOriginalId(legacyMatch[2]) : "";
    if (legacyId && legacyMatch[1] === "image-unique-id") {
      if (imageId && imageId !== legacyId) {
        return "";
      }
      imageId = imageId || legacyId;
    }
    if (legacyId && legacyMatch[1] === "original-document-id") {
      if (originalId && originalId !== legacyId) {
        return "";
      }
      originalId = originalId || legacyId;
    }
    if (!serial || serial.length > 80 || /[\x00-\x1f]/.test(serial) || !captureTime || !(imageId || originalId)) {
      return "";
    }
    // The capture identity is separate from editable names, pixels and document-save IDs.
    return "source-v1:" + JSON.stringify([serial, captureTime, imageId ? "image" : "original", imageId || originalId]);
  }

  function makeVariantKey(options) {
    var width = Number(options && (options.widthPx !== undefined ? options.widthPx : options.width));
    var height = Number(options && (options.heightPx !== undefined ? options.heightPx : options.height));
    var background = String(options && options.backgroundColor || "").toLowerCase();
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
        !Number.isSafeInteger(width * height) || !/^(red|blue|white)$/.test(background)) {
      return "";
    }
    return "variant-v1:" + width + "x" + height + ":" + background;
  }

  window.IDPhotoDeliveryIdentity = {
    getSourceIdentity: getSourceIdentity,
    makeVariantKey: makeVariantKey,
    normalizeCaptureTime: normalizeCaptureTime
  };
})();
