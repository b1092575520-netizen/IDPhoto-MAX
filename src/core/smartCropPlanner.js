(function () {
  "use strict";

  var SQUARE_RATIO_TOLERANCE = 0.005;

  function asPositiveNumber(value, name) {
    var number = Number(value);
    if (!isFinite(number) || number <= 0) {
      throw new Error(name + " 必须是大于 0 的数字");
    }
    return number;
  }

  function calculateCoverSize(width, height, targetRatio) {
    var cropWidth = width;
    var cropHeight = height;

    if (width / height > targetRatio) {
      cropWidth = Math.round(height * targetRatio);
    } else if (width / height < targetRatio) {
      cropHeight = Math.round(width / targetRatio);
    }

    return {
      width: Math.min(width, Math.max(1, cropWidth)),
      height: Math.min(height, Math.max(1, cropHeight))
    };
  }

  function makeBounds(left, top, cropSize) {
    return {
      left: left,
      top: top,
      right: left + cropSize.width,
      bottom: top + cropSize.height,
      width: cropSize.width,
      height: cropSize.height
    };
  }

  function plan(options) {
    var width = asPositiveNumber(options && options.width, "照片宽度");
    var height = asPositiveNumber(options && options.height, "照片高度");
    var targetRatio = asPositiveNumber(options && options.targetRatio, "目标比例");
    var cropSize = calculateCoverSize(width, height, targetRatio);
    var left = Math.round((width - cropSize.width) / 2);
    var top = 0;
    var bounds;

    bounds = makeBounds(left, top, cropSize);

    return {
      mode: "crop",
      reason: "fast-composition",
      bounds: bounds,
      headroomPx: null,
      subjectDetected: false,
      squareTarget: Math.abs(targetRatio - 1) <= SQUARE_RATIO_TOLERANCE
    };
  }

  window.IDPhotoSmartCropPlanner = {
    SQUARE_RATIO_TOLERANCE: SQUARE_RATIO_TOLERANCE,
    plan: plan
  };
})();
