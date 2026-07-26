(function () {
  "use strict";

  var RATIO_TOLERANCE = 0.01;

  function round(value, digits) {
    var base = Math.pow(10, digits || 4);
    return Math.round(value * base) / base;
  }

  function getRequiredRotation(docInfo, template) {
    var sourceIsPortrait;
    var targetIsLandscape;

    if (!docInfo || !template || template.id !== "wedding") {
      return 0;
    }

    sourceIsPortrait = Number(docInfo.heightPx) > Number(docInfo.widthPx);
    targetIsLandscape = Number(template.widthCm) > Number(template.heightCm);
    return sourceIsPortrait && targetIsLandscape ? 90 : 0;
  }

  function checkDocumentRatio(docInfo, template) {
    var docRatio;
    var targetRatio;
    var errorRate;
    var rotationDegrees;
    var effectiveWidthPx;
    var effectiveHeightPx;

    if (!docInfo || !template || !docInfo.widthPx || !docInfo.heightPx) {
      return {
        ok: false,
        canCheck: false,
        message: "比例检测：缺少文档或模板信息"
      };
    }

    rotationDegrees = getRequiredRotation(docInfo, template);
    effectiveWidthPx = rotationDegrees ? Number(docInfo.heightPx) : Number(docInfo.widthPx);
    effectiveHeightPx = rotationDegrees ? Number(docInfo.widthPx) : Number(docInfo.heightPx);
    docRatio = effectiveWidthPx / effectiveHeightPx;
    targetRatio = Number(template.widthCm) / Number(template.heightCm);
    errorRate = Math.abs(docRatio - targetRatio) / targetRatio;

    return {
      ok: errorRate <= RATIO_TOLERANCE,
      canCheck: true,
      docRatio: round(docRatio, 5),
      targetRatio: round(targetRatio, 5),
      errorRate: errorRate,
      errorPercent: round(errorRate * 100, 2),
      rotationDegrees: rotationDegrees,
      effectiveWidthPx: effectiveWidthPx,
      effectiveHeightPx: effectiveHeightPx,
      message: errorRate <= RATIO_TOLERANCE ? "比例检测：符合，跳过裁切" : "比例检测：不符合，需要裁切"
    };
  }

  window.IDPhotoRatioChecker = {
    RATIO_TOLERANCE: RATIO_TOLERANCE,
    getRequiredRotation: getRequiredRotation,
    checkDocumentRatio: checkDocumentRatio
  };
})();
