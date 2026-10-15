(function () {
  "use strict";

  function normalizeOriginalId(value) {
    var text = String(value || "").trim().toLowerCase();
    var match = text.match(/^(?:(?:uuid|xmp\.did):)?([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/);
    var id = match ? match[1].replace(/-/g, "") : "";
    return id && !/^0+$/.test(id) ? id : "";
  }

  function normalizeCaptureTime(value, subsecond, offset) {
    var text = String(value || "").trim();
    var match = text.match(/^(\d{4})([-:])(\d{2})\2(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|[+-](\d{2}):?(\d{2}))?$/);
    var separate = String(subsecond || "").trim();
    var fraction, zone = text.match(/(Z|[+-]\d{2}:?\d{2})$/);
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
    // Photoshop maps some two-digit EXIF subseconds as a zero-padded millisecond
    // integer (.053 for EXIF 53). The EXIF digit string remains authoritative.
    var paddedExif = separate.length < 3 && match[8] === separate.padStart(3, "0");
    fraction = String(separate || match[8] || "").replace(/0+$/, "");
    if (match[8] && separate && match[8].replace(/0+$/, "") !== separate.replace(/0+$/, "") && !paddedExif) {
      return "";
    }
    function normalizedOffset(value) {
      if (!value) return "";
      if (!/^(?:Z|[+-](?:0\d|1[0-4]):?[0-5]\d)$/.test(value) || /^[+-]14:?/.test(value) && !/00$/.test(value)) return null;
      if (value !== "Z") value = value.slice(0, 3) + ":" + value.slice(-2);
      return value === "+00:00" || value === "-00:00" ? "Z" : value;
    }
    var inlineZone = normalizedOffset(zone ? zone[1] : ""), separateZone = normalizedOffset(String(offset || "").trim());
    if (inlineZone === null || separateZone === null || inlineZone && separateZone && inlineZone !== separateZone) return "";
    zone = inlineZone || separateZone;
    return match[1] + "-" + match[3] + "-" + match[4] + "T" + match[5] + ":" + match[6] + ":" + match[7] +
      (fraction ? "." + fraction : /^(?:0+)$/.test(separate || match[8] || "") ? ".0" : "") + zone;
  }

  function describeSourceIdentity(input) {
    var metadata = input && input.sourceMetadata || input || {};
    var serial = String(metadata.serialNumber || "").replace(/\s+/g, "").toUpperCase();
    var captureTime = normalizeCaptureTime(metadata.captureDate, metadata.captureSubsecond, metadata.captureOffsetTime);
    var hasSubsecond = /^\d{1,9}$/.test(String(metadata.captureSubsecond || "").trim()) || /\.\d{1,9}(?:Z|[+-]\d{2}:?\d{2})?$/.test(String(metadata.captureDate || ""));
    var imageId = normalizeOriginalId(metadata.imageUniqueId);
    var originalId = normalizeOriginalId(metadata.originalDocumentId);
    var legacy = String(input && input.stableSourceId || "");
    var legacyMatch = legacy.match(/^(image-unique-id|original-document-id):(.+)$/);
    var legacyId = legacyMatch ? normalizeOriginalId(legacyMatch[2]) : "";
    if (metadata.imageUniqueId && !imageId || metadata.originalDocumentId && !originalId || legacy && !legacyId)
      return { key: "", strength: "" };
    if (legacyId && legacyMatch[1] === "image-unique-id") {
      if (imageId && imageId !== legacyId) {
        return { key: "", strength: "" };
      }
      imageId = imageId || legacyId;
    }
    if (legacyId && legacyMatch[1] === "original-document-id") {
      if (originalId && originalId !== legacyId) {
        return { key: "", strength: "" };
      }
      originalId = originalId || legacyId;
    }
    if (!serial || serial.length > 80 || /[\x00-\x1f]/.test(serial) || !captureTime || !(imageId || originalId || hasSubsecond)) {
      return { key: "", strength: "" };
    }
    var strength = imageId ? "image-unique-id" : originalId ? "original-document-id" : "capture-subsecond";
    // The capture key is unchanged when Photoshop first adds OriginalDocumentID.
    // Strong identifiers remain evidence for legacy lookup/conflict checking.
    return { key: hasSubsecond ? "source-v2:" + JSON.stringify([serial, captureTime]) :
      "source-v1:" + JSON.stringify([serial, captureTime.replace(/(?:Z|[+-]\d{2}:\d{2})$/, ""), imageId ? "image" : "original", imageId || originalId]),
      strength: strength, imageId: imageId, originalId: originalId, serial: serial, captureTime: captureTime };
  }
  function getSourceIdentity(input) { return describeSourceIdentity(input).key; }
  function matchesSourceIdentity(key, input) {
    var current = describeSourceIdentity(input);
    if (!current.key) return false;
    if (key === current.key) return true;
    if (!String(key).startsWith("source-v1:")) return false;
    var saved;
    try { saved = JSON.parse(key.slice(10)); } catch (_) { return false; }
    if (!Array.isArray(saved) || saved.length !== 4 || !["image", "original"].includes(saved[2]) || saved[0] !== current.serial ||
        saved[1] !== current.captureTime.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "").replace(/\.0$/, "")) return false;
    var strong = saved[2] === "image" ? current.imageId : saved[2] === "original" ? current.originalId : "";
    return Boolean(normalizeOriginalId(saved[3])) && (!strong || strong === saved[3]);
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
    describeSourceIdentity: describeSourceIdentity,
    matchesSourceIdentity: matchesSourceIdentity,
    makeVariantKey: makeVariantKey,
    normalizeCaptureTime: normalizeCaptureTime
  };
})();
