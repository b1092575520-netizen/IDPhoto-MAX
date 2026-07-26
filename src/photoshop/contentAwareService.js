(function () {
  "use strict";

  var BLEND_OVERLAP_FRACTION = 0.015;
  var MIN_BLEND_OVERLAP_PX = 12;
  var MAX_BLEND_OVERLAP_PX = 96;

  function calculateExpansion(width, height, targetRatio) {
    var currentRatio = width / height;
    var newWidth = width;
    var newHeight = height;
    var offsetX = 0;
    var offsetY = 0;

    if (currentRatio > targetRatio) {
      newHeight = Math.round(width / targetRatio);
      offsetY = Math.round((newHeight - height) / 2);
    } else {
      newWidth = Math.round(height * targetRatio);
      offsetX = Math.round((newWidth - width) / 2);
    }

    return {
      width: newWidth,
      height: newHeight,
      offsetX: offsetX,
      offsetY: offsetY
    };
  }

  function calculateBlendOverlap(width, height, expansion) {
    var availableOffset = Math.max(expansion.offsetX, expansion.offsetY);
    var scaledOverlap = Math.round(Math.min(width, height) * BLEND_OVERLAP_FRACTION);
    return Math.min(
      availableOffset,
      Math.max(MIN_BLEND_OVERLAP_PX, Math.min(MAX_BLEND_OVERLAP_PX, scaledOverlap))
    );
  }

  async function batchPlay(commands) {
    return await window.IDPhotoPhotoshopExecution.batchPlay(commands);
  }

  async function resizeCanvas(expansion) {
    await batchPlay([
      {
        _obj: "canvasSize",
        width: { _unit: "pixelsUnit", _value: expansion.width },
        height: { _unit: "pixelsUnit", _value: expansion.height },
        horizontal: { _enum: "horizontalLocation", _value: "center" },
        vertical: { _enum: "verticalLocation", _value: "center" },
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
  }

  function rectangleCommand(left, top, right, bottom) {
    return {
      _obj: "set",
      _target: [{ _property: "selection", _ref: "channel" }],
      to: {
        _obj: "rectangle",
        top: { _unit: "pixelsUnit", _value: Math.max(0, Math.round(top)) },
        left: { _unit: "pixelsUnit", _value: Math.max(0, Math.round(left)) },
        bottom: { _unit: "pixelsUnit", _value: Math.max(0, Math.round(bottom)) },
        right: { _unit: "pixelsUnit", _value: Math.max(0, Math.round(right)) }
      },
      _options: { dialogOptions: "dontDisplay" }
    };
  }

  async function clearSelection() {
    try {
      await batchPlay([
        {
          _obj: "set",
          _target: [{ _property: "selection", _ref: "channel" }],
          to: { _enum: "ordinal", _value: "none" },
          _options: { dialogOptions: "dontDisplay" }
        }
      ]);
    } catch (error) {
      console.warn("[contentAware] clear selection failed", error);
    }
  }

  async function fillSelectionContentAware() {
    await batchPlay([
      {
        _obj: "fill",
        using: { _enum: "fillContents", _value: "contentAware" },
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" },
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
  }

  async function fillRect(left, top, right, bottom) {
    if (right <= left || bottom <= top) {
      return;
    }
    await batchPlay([rectangleCommand(left, top, right, bottom)]);
    await fillSelectionContentAware();
  }

  async function expandToRatio(documentRef, options) {
    var docInfo = options.docInfo;
    var targetRatio = options.targetRatio;
    var fallbackBounds = options.bounds
      ? {
          left: options.bounds.left,
          top: options.bounds.top,
          right: options.bounds.right,
          bottom: options.bounds.bottom
        }
      : null;
    var expansion = calculateExpansion(docInfo.widthPx, docInfo.heightPx, targetRatio);
    var blendOverlapPx = calculateBlendOverlap(docInfo.widthPx, docInfo.heightPx, expansion);

    console.log("[contentAware] start", {
      originalWidth: docInfo.widthPx,
      originalHeight: docInfo.heightPx,
      targetRatio: targetRatio,
      expansion: expansion
    });

    if (!documentRef) {
      throw new Error("内容识别扩图缺少 Photoshop 文档");
    }
    if (expansion.width === docInfo.widthPx && expansion.height === docInfo.heightPx) {
      return {
        ok: true,
        mode: "content-aware",
        blendOverlapPx: 0,
        message: "无需扩图"
      };
    }

    if (fallbackBounds) {
      fallbackBounds.left += expansion.offsetX;
      fallbackBounds.right += expansion.offsetX;
      fallbackBounds.top += expansion.offsetY;
      fallbackBounds.bottom += expansion.offsetY;
    }

    await resizeCanvas(expansion);

    try {
      if (expansion.offsetY > 0) {
        await fillRect(0, 0, expansion.width, expansion.offsetY + blendOverlapPx);
        await fillRect(
          0,
          expansion.offsetY + docInfo.heightPx - blendOverlapPx,
          expansion.width,
          expansion.height
        );
      }
      if (expansion.offsetX > 0) {
        await fillRect(0, 0, expansion.offsetX + blendOverlapPx, expansion.height);
        await fillRect(
          expansion.offsetX + docInfo.widthPx - blendOverlapPx,
          0,
          expansion.width,
          expansion.height
        );
      }
    } catch (fillError) {
      fillError.fallbackBounds = fallbackBounds;
      throw fillError;
    } finally {
      await clearSelection();
    }

    return {
      ok: true,
      mode: "content-aware",
      expansion: expansion,
      blendOverlapPx: blendOverlapPx,
      message: "已使用 Photoshop 内置内容识别填充扩图"
    };
  }

  window.IDPhotoContentAwareService = {
    calculateExpansion: calculateExpansion,
    expandToRatio: expandToRatio
  };
})();
