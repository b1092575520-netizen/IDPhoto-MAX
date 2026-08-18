(function () {
  "use strict";

  function decodeXml(value) {
    return String(value || "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function readXmpValue(raw, names) {
    var source = String(raw || "");
    var index;
    var name;
    var escaped;
    var match;

    for (index = 0; index < names.length; index += 1) {
      name = names[index];
      escaped = escapeRegExp(name);
      match = source.match(new RegExp("<" + escaped + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + escaped + ">", "i"));
      if (match && match[1]) {
        return decodeXml(match[1]);
      }
      match = source.match(new RegExp("(?:^|\\s)" + escaped + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
      if (match && match[2]) {
        return decodeXml(match[2]);
      }
    }
    return "";
  }

  function normalizeSerial(value) {
    return String(value || "").replace(/\s+/g, "").toUpperCase();
  }

  function parseXmp(raw) {
    var source = String(raw || "");
    return {
      make: readXmpValue(source, ["tiff:Make", "exif:Make"]),
      model: readXmpValue(source, ["tiff:Model", "exif:Model"]),
      serialNumber: normalizeSerial(
        readXmpValue(source, [
          "aux:SerialNumber",
          "exifEX:BodySerialNumber",
          "exif:BodySerialNumber",
          "aux:CameraSerialNumber"
        ])
      ),
      hasXmp: Boolean(source.trim())
    };
  }

  function getStableSourceIdFromXmp(raw) {
    var source = String(raw || "");
    var imageUniqueId = readXmpValue(source, ["exif:ImageUniqueID", "photoshop:ImageUniqueID"]);
    var originalDocumentId = readXmpValue(source, ["xmpMM:OriginalDocumentID"]);
    if (imageUniqueId) {
      return "image-unique-id:" + imageUniqueId;
    }
    if (originalDocumentId) {
      return "original-document-id:" + originalDocumentId;
    }
    return "";
  }

  function loadRegisteredCameras() {
    var parsed;
    try {
      parsed = window.IDPhotoSettingsProfile.load().cameras;
      return Array.isArray(parsed)
        ? parsed.filter(function (camera) {
            return camera && normalizeSerial(camera.serialNumber);
          })
        : [];
    } catch (error) {
      return [];
    }
  }

  function saveRegisteredCameras(cameras) {
    try {
      window.IDPhotoSettingsProfile.update("cameras", cameras || []);
      return true;
    } catch (error) {
      return false;
    }
  }

  function cameraLabel(camera) {
    var serial = normalizeSerial(camera && camera.serialNumber);
    var tail = serial.length > 4 ? serial.slice(-4) : serial;
    return [camera && camera.make, camera && camera.model].filter(Boolean).join(" ") + (tail ? " · 尾号 " + tail : "");
  }

  function registerCamera(metadata) {
    var serial = normalizeSerial(metadata && metadata.serialNumber);
    var cameras;
    var existing;
    var camera;

    if (!serial) {
      return {
        ok: false,
        reason: "missing-serial",
        message: "当前照片没有可用的相机机身序列号，无法登记为本店相机"
      };
    }

    cameras = loadRegisteredCameras();
    existing = cameras.find(function (item) {
      return normalizeSerial(item.serialNumber) === serial;
    });
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        camera: existing,
        cameras: cameras,
        message: "本店相机已登记：" + cameraLabel(existing)
      };
    }

    camera = {
      make: String(metadata.make || "").trim(),
      model: String(metadata.model || "").trim(),
      serialNumber: serial
    };
    cameras.push(camera);
    if (!saveRegisteredCameras(cameras)) {
      return {
        ok: false,
        reason: "storage-failed",
        message: "本店相机登记保存失败"
      };
    }
    return {
      ok: true,
      camera: camera,
      cameras: cameras,
      message: "已登记本店相机：" + cameraLabel(camera)
    };
  }

  function clearRegisteredCameras() {
    if (saveRegisteredCameras([])) {
      return { ok: true, cameras: [], message: "已清除本店相机登记" };
    }
    return { ok: false, cameras: loadRegisteredCameras(), message: "清除本店相机登记失败" };
  }

  function checkSource(metadata) {
    var serial = normalizeSerial(metadata && metadata.serialNumber);
    var cameras = loadRegisteredCameras();
    var matched;

    if (!serial) {
      return {
        eligible: false,
        reason: "missing-serial",
        message: "照片缺少本店相机序列号：仅排版，不保存"
      };
    }
    if (!cameras.length) {
      return {
        eligible: false,
        reason: "no-registered-camera",
        message: "尚未登记本店相机：仅排版，不保存"
      };
    }
    matched = cameras.find(function (camera) {
      return normalizeSerial(camera.serialNumber) === serial;
    });
    if (!matched) {
      return {
        eligible: false,
        reason: "external-camera",
        message: "外来相片：仅排版，不保存"
      };
    }
    return {
      eligible: true,
      reason: "registered-camera",
      camera: matched,
      message: "本店相机已匹配：" + cameraLabel(matched)
    };
  }

  function getInfoBarDecision(metadata) {
    var eligibility = checkSource(metadata);
    return {
      showInfoBar: Boolean(eligibility.eligible),
      leaveBlank: !eligibility.eligible,
      reason: eligibility.reason,
      message: eligibility.message
    };
  }

  function getRegistrationSummary() {
    var cameras = loadRegisteredCameras();
    return cameras.length ? cameras.map(cameraLabel).join("；") : "尚未登记本店相机";
  }

  window.IDPhotoSourceEligibilityService = {
    parseXmp: parseXmp,
    getStableSourceIdFromXmp: getStableSourceIdFromXmp,
    normalizeSerial: normalizeSerial,
    loadRegisteredCameras: loadRegisteredCameras,
    registerCamera: registerCamera,
    clearRegisteredCameras: clearRegisteredCameras,
    checkSource: checkSource,
    getInfoBarDecision: getInfoBarDecision,
    getRegistrationSummary: getRegistrationSummary
  };
})();
