(function () {
  "use strict";

  var CANVAS_WIDTH_PX = 3600;
  var CANVAS_HEIGHT_PX = 2400;
  var DEBUG_INFO_BAR = false;
  var DEBUG_LAYER_NAMES = {
    background: "DEBUG_infoBar_background",
    avatar: "DEBUG_infoBar_avatar",
    text: {
      shopNameDate: "DEBUG_text_shopNameDate",
      shopName: "DEBUG_text_shopName",
      date: "DEBUG_text_date",
      phone: "DEBUG_text_phone",
      tip: "DEBUG_text_tip"
    }
  };

  function debugLog(message, payload) {
    if (!DEBUG_INFO_BAR) {
      return;
    }
    if (payload !== undefined) {
      console.log(message, payload);
    } else {
      console.log(message);
    }
  }

  function isDebugRender(options) {
    return Boolean(options && options.debugMode);
  }

  function getDebugTextLayerName(item) {
    var key = item && (item.fieldKey || item.key);
    return (key && DEBUG_LAYER_NAMES.text[key]) || (item && item.name) || "DEBUG_text";
  }

  function getPhotoshopModule() {
    if (!window.IDPhotoPhotoshopExecution) {
      throw new Error("photoshopExecution 未加载");
    }
    return window.IDPhotoPhotoshopExecution.getPhotoshop();
  }

  function getDocumentId(documentRef) {
    return documentRef && (documentRef.id || documentRef._id || documentRef.documentID || null);
  }

  async function activateDocument(documentRef) {
    await window.IDPhotoPhotoshopExecution.activateDocument(documentRef);
  }

  function readBoundValue(value) {
    if (typeof value === "number") {
      return value;
    }
    if (value && typeof value === "object") {
      if (typeof value.value === "number") {
        return value.value;
      }
      if (typeof value._value === "number") {
        return value._value;
      }
    }
    return Number(value) || 0;
  }

  function getLayerBounds(layer) {
    var bounds = layer && (layer.boundsNoEffects || layer.bounds);
    if (!bounds) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    return {
      left: readBoundValue(bounds.left),
      top: readBoundValue(bounds.top),
      right: readBoundValue(bounds.right),
      bottom: readBoundValue(bounds.bottom)
    };
  }

  function getLayerSize(layer) {
    var bounds = getLayerBounds(layer);
    return {
      width: Math.max(1, Math.round(bounds.right - bounds.left)),
      height: Math.max(1, Math.round(bounds.bottom - bounds.top)),
      bounds: bounds
    };
  }

  function getLayerId(layer) {
    return layer && (layer.id || layer._id || layer.layerID || null);
  }

  function getActiveLayer(documentRef) {
    if (documentRef && documentRef.activeLayers && documentRef.activeLayers.length > 0) {
      return documentRef.activeLayers[0];
    }
    return null;
  }

  function getTopLayer(documentRef) {
    if (documentRef && documentRef.layers && documentRef.layers.length > 0) {
      return documentRef.layers[0];
    }
    return null;
  }

  function getSourceLayer(sourceDocument) {
    if (sourceDocument && sourceDocument.activeLayers && sourceDocument.activeLayers.length > 0) {
      return sourceDocument.activeLayers[0];
    }
    if (sourceDocument && sourceDocument.layers && sourceDocument.layers.length > 0) {
      return sourceDocument.layers[0];
    }
    if (sourceDocument && sourceDocument.backgroundLayer) {
      return sourceDocument.backgroundLayer;
    }
    return null;
  }

  function formatBounds(bounds) {
    return {
      left: Math.round(bounds.left),
      top: Math.round(bounds.top),
      right: Math.round(bounds.right),
      bottom: Math.round(bounds.bottom)
    };
  }

  function unionTextBounds(entries) {
    var union = null;
    entries.forEach(function (entry) {
      var bounds = entry && entry.bounds;
      if (!bounds) {
        return;
      }
      if (!union) {
        union = {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom
        };
        return;
      }
      union.left = Math.min(union.left, bounds.left);
      union.top = Math.min(union.top, bounds.top);
      union.right = Math.max(union.right, bounds.right);
      union.bottom = Math.max(union.bottom, bounds.bottom);
    });
    return union;
  }

  function clampNumber(value, min, max) {
    if (max < min) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  function isBoundsInsideRect(bounds, rect) {
    return (
      bounds.left >= rect.x &&
      bounds.top >= rect.y &&
      bounds.right <= rect.x + rect.width &&
      bounds.bottom <= rect.y + rect.height
    );
  }

  function isBoundsInsideCanvas(bounds) {
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= CANVAS_WIDTH_PX && bounds.bottom <= CANVAS_HEIGHT_PX;
  }

  async function alignTextGroup(layerService, entries, infoBar) {
    var union;
    var groupWidth;
    var groupHeight;
    var targetLeft;
    var targetTop;
    var deltaX = 0;
    var deltaY = 0;
    var index;
    var entry;
    var bounds;

    if (!entries || entries.length === 0) {
      return entries;
    }

    union = unionTextBounds(entries);
    if (!union) {
      return entries;
    }

    groupWidth = union.right - union.left;
    groupHeight = union.bottom - union.top;

    if (infoBar.orientation === "vertical" || infoBar.position === "right" || infoBar.kind === "right") {
      targetLeft = infoBar.x + Math.round((infoBar.width - groupWidth) / 2);
      targetLeft = clampNumber(targetLeft, infoBar.x, infoBar.x + infoBar.width - groupWidth);
      deltaX = Math.round(targetLeft - union.left);
    } else {
      targetTop = infoBar.y + Math.round((infoBar.height - groupHeight) / 2);
      targetTop = clampNumber(targetTop, infoBar.y, infoBar.y + infoBar.height - groupHeight);
      deltaY = Math.round(targetTop - union.top);
    }

    if (deltaX === 0 && deltaY === 0) {
      return entries;
    }

    for (index = 0; index < entries.length; index += 1) {
      entry = entries[index];
      bounds = entry.bounds;
      entry.bounds = await layerService.moveLayerTo(entry.layer, bounds.left + deltaX, bounds.top + deltaY, entry.item.key || index + 1);
    }

    return entries;
  }

  function clampAvatarRect(infoBar, avatar) {
    var rect;
    var maxRight;
    var maxBottom;

    if (!avatar) {
      return null;
    }

    rect = Object.assign({}, avatar, {
      x: Math.max(infoBar.x, Math.round(avatar.x || infoBar.x)),
      y: Math.max(infoBar.y, Math.round(avatar.y || infoBar.y)),
      width: Math.max(1, Math.round(avatar.width || 1)),
      height: Math.max(1, Math.round(avatar.height || 1))
    });
    maxRight = infoBar.x + infoBar.width;
    maxBottom = infoBar.y + infoBar.height;

    if (rect.x + rect.width > maxRight) {
      rect.width = Math.max(1, maxRight - rect.x);
    }
    if (rect.y + rect.height > maxBottom) {
      rect.height = Math.max(1, maxBottom - rect.y);
    }

    return rect;
  }

  function getLayerService() {
    if (
      !window.IDPhotoLayerService ||
      !window.IDPhotoLayerService.getLayerBounds ||
      !window.IDPhotoLayerService.getDocumentLayerIds ||
      !window.IDPhotoLayerService.findLayerByName ||
      !window.IDPhotoLayerService.moveLayerTo ||
      !window.IDPhotoLayerService.runNewLayerOperation
    ) {
      throw new Error("layerService 缺少图层 bounds、移动或新图层判定能力");
    }
    return window.IDPhotoLayerService;
  }

  async function batchPlay(commands) {
    return await window.IDPhotoPhotoshopExecution.batchPlay(commands);
  }

  async function scaleLayerByPercent(layer, percent, label) {
    var layerId = getLayerId(layer);
    var scale = Math.max(1, Number(percent) || 100);

    try {
      if (typeof layer.resize === "function") {
        await layer.resize(scale, scale);
        return;
      }
    } catch (domError) {
      window.IDPhotoPhotoshopExecution.throwIfCancelled(domError);
      console.warn("[infoBarRenderer] layer.resize failed, falling back to batchPlay", {
        label: label,
        error: domError
      });
    }

    if (!layerId) {
      throw new Error("缩放图层缺少 layer id");
    }

    await batchPlay([
      {
        _obj: "transform",
        _target: [{ _ref: "layer", _id: layerId }],
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        width: { _unit: "percentUnit", _value: scale },
        height: { _unit: "percentUnit", _value: scale },
        interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
  }

  async function moveLayerToFront(layer) {
    var layerId = getLayerId(layer);

    if (!layerId) {
      throw new Error("提升信息条图层缺少 layer id");
    }

    await batchPlay([
      {
        _obj: "move",
        _target: [{ _ref: "layer", _id: layerId }],
        to: { _ref: "layer", _enum: "ordinal", _value: "front" },
        adjustment: false,
        version: 5,
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
  }

  async function scaleLayerToPercent(layer, widthPercent, heightPercent, label) {
    var layerId = getLayerId(layer);
    var widthScale = Math.max(1, Number(widthPercent) || 100);
    var heightScale = Math.max(1, Number(heightPercent) || 100);

    try {
      if (typeof layer.resize === "function") {
        await layer.resize(widthScale, heightScale);
        return;
      }
    } catch (domError) {
      window.IDPhotoPhotoshopExecution.throwIfCancelled(domError);
      console.warn("[infoBarRenderer] layer.resize exact failed, falling back to batchPlay", {
        label: label,
        error: domError
      });
    }

    if (!layerId) {
      throw new Error("缩放图层缺少 layer id");
    }

    await batchPlay([
      {
        _obj: "transform",
        _target: [{ _ref: "layer", _id: layerId }],
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        width: { _unit: "percentUnit", _value: widthScale },
        height: { _unit: "percentUnit", _value: heightScale },
        interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
  }

  async function fitTextLayerToSavedBounds(layerService, layer, item, targetX, targetY) {
    var saved = item && item.debugTargetBounds ? item.debugTargetBounds : null;
    var bounds;
    var currentWidth;
    var currentHeight;
    var targetWidth;
    var targetHeight;
    var widthScale;
    var heightScale;
    var needsScale = false;

    if (!saved) {
      return layerService.getLayerBounds(layer);
    }

    bounds = layerService.getLayerBounds(layer);
    currentWidth = Math.max(1, bounds.right - bounds.left);
    currentHeight = Math.max(1, bounds.bottom - bounds.top);
    targetWidth = Number(saved.width);
    targetHeight = Number(saved.height);
    targetWidth = Number.isFinite(targetWidth) && targetWidth > 0 ? targetWidth : null;
    targetHeight = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : null;

    widthScale = targetWidth ? (targetWidth / currentWidth) * 100 : 100;
    heightScale = targetHeight ? (targetHeight / currentHeight) * 100 : 100;
    needsScale =
      (targetWidth && Math.abs(currentWidth - targetWidth) / targetWidth > 0.05) ||
      (targetHeight && Math.abs(currentHeight - targetHeight) / targetHeight > 0.05);

    if (needsScale) {
      await scaleLayerToPercent(layer, widthScale, heightScale, item.key || "debug text");
    }

    return await layerService.moveLayerTo(layer, targetX, targetY, item.key || "debug text");
  }

  async function duplicateSourceLayerToTarget(sourceDocument, targetDocument, sourceLayer) {
    sourceLayer = sourceLayer || getSourceLayer(sourceDocument);

    if (!sourceDocument || !sourceLayer) {
      throw new Error("信息条头像缺少可复制的源照片图层");
    }
    if (!window.IDPhotoLayerService || !window.IDPhotoLayerService.duplicateLayerToDocument) {
      throw new Error("layerService 缺少 duplicateLayerToDocument");
    }
    return await window.IDPhotoLayerService.duplicateLayerToDocument(sourceDocument, sourceLayer, targetDocument);
  }

  function clampInfoBar(infoBar) {
    var normalized = Object.assign({}, infoBar, {
      kind: infoBar.kind || infoBar.position,
      position: infoBar.position || infoBar.kind,
      x: Math.max(0, Math.round(infoBar.x || 0)),
      y: Math.max(0, Math.round(infoBar.y || 0)),
      width: Math.max(1, Math.round(infoBar.width || 1)),
      height: Math.max(1, Math.round(infoBar.height || 1)),
      orientation: infoBar.orientation || (infoBar.kind === "right" || infoBar.position === "right" ? "vertical" : "horizontal")
    });

    if (normalized.x + normalized.width > CANVAS_WIDTH_PX) {
      normalized.width = CANVAS_WIDTH_PX - normalized.x;
    }
    if (normalized.y + normalized.height > CANVAS_HEIGHT_PX) {
      normalized.height = CANVAS_HEIGHT_PX - normalized.y;
    }
    return normalized;
  }

  function assertPointInCanvas(x, y, label) {
    if (x < 0 || y < 0 || x > CANVAS_WIDTH_PX || y > CANVAS_HEIGHT_PX) {
      throw new Error(label + " 坐标超出 3600x2400 画布：" + Math.round(x) + "," + Math.round(y));
    }
  }

  function colorOrDefault(color, fallback) {
    return {
      red: Math.round(color && typeof color.red === "number" ? color.red : fallback.red),
      green: Math.round(color && typeof color.green === "number" ? color.green : fallback.green),
      blue: Math.round(color && typeof color.blue === "number" ? color.blue : fallback.blue)
    };
  }

  function toBatchColor(color) {
    return {
      _obj: "RGBColor",
      red: color.red,
      green: color.green,
      blue: color.blue
    };
  }

  function setSelectionRectCommand(x, y, width, height) {
    return {
      _obj: "set",
      _target: [{ _property: "selection", _ref: "channel" }],
      to: {
        _obj: "rectangle",
        top: { _unit: "pixelsUnit", _value: Math.round(y) },
        left: { _unit: "pixelsUnit", _value: Math.round(x) },
        bottom: { _unit: "pixelsUnit", _value: Math.round(y + height) },
        right: { _unit: "pixelsUnit", _value: Math.round(x + width) }
      },
      _options: { dialogOptions: "dontDisplay" }
    };
  }

  function fillColorCommand(red, green, blue) {
    var color = colorOrDefault({ red: red, green: green, blue: blue }, { red: 128, green: 22, blue: 20 });
    return {
      _obj: "fill",
      using: { _enum: "fillContents", _value: "color" },
      color: toBatchColor(color),
      opacity: { _unit: "percentUnit", _value: 100 },
      mode: { _enum: "blendMode", _value: "normal" },
      _options: { dialogOptions: "dontDisplay" }
    };
  }

  function clearSelectionCommand() {
    return {
      _obj: "set",
      _target: [{ _property: "selection", _ref: "channel" }],
      to: { _enum: "ordinal", _value: "none" },
      _options: { dialogOptions: "dontDisplay" }
    };
  }

  async function fillRectLayer(name, x, y, width, height, color) {
    assertPointInCanvas(x, y, name + " 左上角");
    assertPointInCanvas(x + width, y + height, name + " 右下角");
    await batchPlay([
      {
        _obj: "make",
        _target: [{ _ref: "layer" }],
        _options: { dialogOptions: "dontDisplay" }
      },
      {
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "layer", name: name },
        _options: { dialogOptions: "dontDisplay" }
      },
      setSelectionRectCommand(x, y, width, height),
      fillColorCommand(color.red, color.green, color.blue),
      clearSelectionCommand()
    ]);
  }

  async function createInfoBarBackground(infoBar, options) {
    var background = colorOrDefault(infoBar.background, { red: 176, green: 28, blue: 35 });
    await fillRectLayer(isDebugRender(options) ? DEBUG_LAYER_NAMES.background : "信息条背景", infoBar.x, infoBar.y, infoBar.width, infoBar.height, background);
  }

  async function createAvatarThumbnail(targetDocument, avatar, options) {
    var sourceDocument = options && options.sourceDocument;
    var sourceLayer = options && options.sourceLayer;
    var avatarLayer;
    var size;
    var scale;
    var bounds;
    var targetX;
    var targetY;

    if (!avatar) {
      return null;
    }

    if (!sourceDocument) {
      console.warn("[infoBarRenderer] avatar source document missing; skip avatar thumbnail");
      return null;
    }

    if (!sourceLayer && options && options.sourceLayerName) {
      sourceLayer = getLayerService().findLayerByName(sourceDocument.layers, options.sourceLayerName);
    }
    avatarLayer = await duplicateSourceLayerToTarget(sourceDocument, targetDocument, sourceLayer);
    if (!avatarLayer) {
      throw new Error("信息条头像复制失败");
    }

    avatarLayer.name = isDebugRender(options) ? DEBUG_LAYER_NAMES.avatar : "信息条小头像";
    await moveLayerToFront(avatarLayer);
    size = getLayerSize(avatarLayer);
    scale =
      avatar.fit === "cover" || avatar.fitMode === "cover"
        ? Math.max(avatar.width / size.width, avatar.height / size.height) * 100
        : Math.min(avatar.width / size.width, avatar.height / size.height) * 100;
    await scaleLayerByPercent(avatarLayer, scale, "信息条小头像");

    bounds = getLayerBounds(avatarLayer);
    targetX = Math.round(avatar.x + (avatar.width - (bounds.right - bounds.left)) / 2);
    targetY = Math.round(avatar.y + (avatar.height - (bounds.bottom - bounds.top)) / 2);
    bounds = await getLayerService().moveLayerTo(avatarLayer, targetX, targetY, "信息条小头像");

    console.log("[infoBarRenderer] avatar thumbnail bounds", {
      target: {
        x: avatar.x,
        y: avatar.y,
        width: avatar.width,
        height: avatar.height
      },
      scalePercent: scale && typeof scale === "object" ? scale : Math.round(scale * 100) / 100,
      finalBounds: formatBounds(bounds),
      insideCanvas: isBoundsInsideCanvas(bounds),
      insideAvatar: isBoundsInsideRect(bounds, avatar)
    });

    return avatarLayer;
  }

  function makeTextCommand(text, x, y, fontSize, name, color, fontConfig, orientation) {
    var textColor = colorOrDefault(color, { red: 255, green: 238, blue: 150 });
    var textStyle = {
      _obj: "textStyle",
      size: { _unit: "pointsUnit", _value: fontSize },
      color: toBatchColor(textColor)
    };

    if (fontConfig) {
      textStyle.fontPostScriptName = fontConfig.postScriptName;
      textStyle.fontName = fontConfig.name;
      textStyle.fontStyleName = fontConfig.style || "Regular";
    }

    return {
      _obj: "make",
      _target: [{ _ref: "textLayer" }],
      using: {
        _obj: "textLayer",
        name: name,
        textKey: text,
        textClickPoint: {
          _obj: "paint",
          horizontal: { _unit: "pixelsUnit", _value: Math.round(x) },
          vertical: { _unit: "pixelsUnit", _value: Math.round(y) }
        },
        orientation: { _enum: "orientation", _value: orientation === "vertical" ? "vertical" : "horizontal" },
        antiAlias: { _enum: "antiAliasType", _value: "antiAliasSharp" },
        textStyleRange: [
          {
            _obj: "textStyleRange",
            from: 0,
            to: text.length,
            textStyle: textStyle
          }
        ],
        paragraphStyleRange: [
          {
            _obj: "paragraphStyleRange",
            from: 0,
            to: text.length,
            paragraphStyle: {
              _obj: "paragraphStyle",
              align: { _enum: "alignmentType", _value: "left" }
            }
          }
        ]
      },
      _options: { dialogOptions: "dontDisplay" }
    };
  }

  async function makeTextLayerWithBatchPlay(targetDocument, text, x, y, fontSize, name, color, orientation, knownLayerIds) {
    var attempts = [
      { postScriptName: "AdobeHeitiStd-Regular", name: "Adobe 黑体 Std", style: "Regular" },
      { postScriptName: "SimHei", name: "黑体", style: "Regular" },
      null
    ];
    var index;
    var lastError;
    var layerService = getLayerService();

    for (index = 0; index < attempts.length; index += 1) {
      try {
        return await layerService.runNewLayerOperation(
          targetDocument,
          async function () {
            await batchPlay([makeTextCommand(text, x, y, fontSize, name, color, attempts[index], orientation)]);
          },
          "创建文字图层",
          knownLayerIds
        );
      } catch (fontError) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(fontError);
        if (fontError && fontError.code === "NEW_LAYER_RESOLUTION_FAILED") {
          throw fontError;
        }
        lastError = fontError;
        console.warn("[infoBarRenderer] text layer font attempt failed", {
          name: name,
          font: attempts[index],
          error: fontError
        });
      }
    }

    throw lastError || new Error("创建文字图层失败");
  }

  async function createTextLayer(targetDocument, text, x, y, fontSize, name, color, orientation, knownLayerIds) {
    var layer;

    assertPointInCanvas(x, y, name);
    await activateDocument(targetDocument);
    layer = await makeTextLayerWithBatchPlay(targetDocument, text, x, y, fontSize, name, color, orientation, knownLayerIds);
    if (!layer) {
      throw new Error("创建文字图层后未获取到目标图层：" + name);
    }
    layer.name = name;
    return layer;
  }

  function buildTextValue(key, settings, options, item) {
    var dateText = options && options.dateText ? options.dateText : "";
    var value = "";

    if (key === "shopNameDate") {
      value =
        buildTextValue("shopName", settings, options) +
        (item && typeof item.separator === "string" ? item.separator : " ") +
        buildTextValue("date", settings, options);
    } else if (key === "shopName") {
      value = settings.shopName || "福清印象照相馆";
    } else if (key === "date") {
      value = dateText;
    } else if (key === "phone") {
      value = settings.shopPhone || "13003825982（微信同号）";
    } else if (key === "tip") {
      value = settings.shopTip || "[请妥善保管此单据]";
    }

    if (item && item.prefix && value && value.indexOf(item.prefix) !== 0) {
      value = item.prefix + value;
    }
    return value;
  }

  function buildLines(settings, options) {
    return [
      { key: "shopName", text: buildTextValue("shopName", settings, options), name: "店铺名称" },
      { key: "date", text: buildTextValue("date", settings, options), name: "日期" },
      { key: "phone", text: buildTextValue("phone", settings, options), name: "电话" },
      { key: "tip", text: buildTextValue("tip", settings, options), name: "提示语" }
    ].filter(function (line) {
      return String(line.text || "").trim().length > 0;
    });
  }

  function getAvatarRect(infoBar) {
    var size;
    if (infoBar.avatar) {
      return clampAvatarRect(infoBar, infoBar.avatar);
    }
    if (infoBar.kind === "right" || infoBar.position === "right") {
      size = Math.max(56, Math.min(infoBar.width - 28, 132));
      if (size <= 20) {
        return null;
      }
      return clampAvatarRect(infoBar, {
        x: infoBar.x + Math.round((infoBar.width - size) / 2),
        y: infoBar.y + 22,
        width: size,
        height: size
      });
    }

    size = Math.max(70, Math.min(infoBar.height - 44, 120));
    if (size <= 30) {
      return null;
    }
    return clampAvatarRect(infoBar, {
      x: infoBar.x + 24,
      y: infoBar.y + Math.round((infoBar.height - size) / 2),
      width: size,
      height: size
    });
  }

  function getLineLayout(infoBar) {
    var avatar = getAvatarRect(infoBar);
    if (infoBar.texts && ((Array.isArray(infoBar.texts) && infoBar.texts.length) || (!Array.isArray(infoBar.texts) && infoBar.texts.mode))) {
      return {
        explicitTexts: infoBar.texts,
        avatar: avatar
      };
    }
    if (infoBar.kind === "right") {
      return {
        startX: infoBar.x + Math.max(10, Math.min(22, Math.round(infoBar.width * 0.08))),
        startY: avatar ? avatar.y + avatar.height + 36 : infoBar.y + Math.max(52, Math.min(90, Math.round(infoBar.height * 0.04))),
        lineGap: Math.max(58, Math.min(92, Math.round(infoBar.height * 0.04))),
        titleSize: infoBar.width <= 220 ? 10 : 13,
        textSize: infoBar.width <= 220 ? 8 : 11
      };
    }
    return {
      startX: avatar ? avatar.x + avatar.width + 34 : infoBar.x + Math.max(24, Math.min(36, Math.round(infoBar.width * 0.01))),
      startY: infoBar.y + (infoBar.height <= 260 ? 38 : 72),
      lineGap: infoBar.height <= 260 ? 42 : 54,
      titleSize: infoBar.height <= 260 ? 10 : 12,
      textSize: infoBar.height <= 260 ? 8 : 10
    };
  }

  function buildExplicitTextItems(infoBar, settings, options) {
    var color = colorOrDefault(infoBar.textColor, { red: 255, green: 238, blue: 150 });
    if (infoBar.texts && !Array.isArray(infoBar.texts)) {
      if (infoBar.texts.mode === "verticalText") {
        return buildVerticalConfiguredItems(infoBar, settings, options, infoBar.texts);
      }
      if (infoBar.texts.mode === "horizontalBlock") {
        return buildHorizontalConfiguredItems(infoBar, settings, options, infoBar.texts);
      }
    }
    return (infoBar.texts || [])
      .map(function (item, index) {
        return {
          key: item.key,
          fieldKey: item.key,
          text: buildTextValue(item.key, settings || {}, options || {}, item),
          x: Math.round(item.x),
          y: Math.round(item.y),
          width: Math.round(item.width || 0),
          height: Math.round(item.height || 0),
          fontSize: Number(item.fontSize) || 10,
          lineGap: typeof item.lineGap === "number" ? item.lineGap : 8,
          orientation: item.orientation || "horizontal",
          color: item.color ? colorOrDefault(item.color, color) : color,
          name: item.name || item.key || "文字_" + (index + 1),
          debugFixedPosition: Boolean(item.debugFixedPosition)
        };
      })
      .filter(function (item) {
        return String(item.text || "").trim().length > 0;
      });
  }

  function buildAutoTextItems(lines, layout, infoBar) {
    var color = colorOrDefault(infoBar.textColor, { red: 255, green: 238, blue: 150 });
    return lines.map(function (line, index) {
      return {
        key: line.key,
        text: line.text,
        x: layout.startX,
        y: layout.startY + index * layout.lineGap,
        fontSize: index === 0 ? layout.titleSize : layout.textSize,
        orientation: "horizontal",
        color: color,
        name: line.name || "信息条_" + (index + 1)
      };
    });
  }

  function inferFontSizeFromDebugHeight(height, fallback) {
    var value = Number(height);
    if (Number.isFinite(value) && value > 0) {
      return Math.max(3, Math.min(96, Math.round((value / 8.5) * 10) / 10));
    }
    return fallback;
  }

  function applyTextLayerOverrides(textItems, infoBar) {
    var textLayers = infoBar && infoBar.textLayers ? infoBar.textLayers : null;

    if (!textLayers) {
      return textItems;
    }

    return textItems.map(function (item) {
      var key = item.fieldKey || item.key;
      var override = key ? textLayers[key] : null;

      if (!override) {
        return item;
      }

      if (typeof override.x === "number") {
        item.x = Math.round(override.x);
      }
      if (typeof override.y === "number") {
        item.y = Math.round(override.y);
      }
      if (typeof override.width === "number") {
        item.width = Math.round(override.width);
      }
      if (typeof override.height === "number") {
        item.height = Math.round(override.height);
      }
      if (typeof override.fontSize === "number" && override.fontSize > 0) {
        item.fontSize = override.fontSize;
      } else if (typeof override.height === "number") {
        item.fontSize = inferFontSizeFromDebugHeight(override.height, item.fontSize);
      }
      item.debugTargetBounds = {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize
      };
      item.debugFixedPosition = true;
      return item;
    });
  }

  function configuredKeys(config) {
    if (config.keys && config.keys.length) {
      return config.keys.slice();
    }
    return config.omitTip ? ["shopName", "date", "phone"] : ["shopName", "date", "phone", "tip"];
  }

  function configuredFontSize(config, key, fallback) {
    var value = config.fontSizes && typeof config.fontSizes[key] === "number" ? config.fontSizes[key] : fallback;
    var min = typeof config.minFontSize === "number" ? config.minFontSize : 6;
    var max = typeof config.maxFontSize === "number" ? config.maxFontSize : 13;
    return Math.max(min, Math.min(max, value));
  }

  function resolveHorizontalTextStartX(infoBar, config) {
    var gap;
    var avatar;

    if (config.useAvatarGap === false) {
      return Math.round(config.x || infoBar.x || 0);
    }

    avatar = getAvatarRect(infoBar);
    if (!avatar) {
      return Math.round(config.x || infoBar.x || 0);
    }

    gap = typeof config.gap === "number" ? config.gap : 28;
    return Math.round(avatar.x + avatar.width + gap);
  }

  function normalizeHorizontalConfig(infoBar, config) {
    var normalized = Object.assign({}, config, {
      x: resolveHorizontalTextStartX(infoBar, config)
    });

    if (!normalized.width) {
      normalized.width = Math.max(1, infoBar.x + infoBar.width - normalized.x - (normalized.rightPadding || 24));
    }

    return normalized;
  }

  function estimatedTextHeight(fontSize) {
    return Math.max(8, Math.ceil(fontSize * 8.5));
  }

  function estimateHorizontalHeight(keys, config) {
    return keys.reduce(function (total, key, index) {
      return total + estimatedTextHeight(configuredFontSize(config, key, config.maxFontSize || 10)) + (index === 0 ? 0 : config.lineGap || 0);
    }, 0);
  }

  function fitHorizontalConfig(infoBar, config, keys) {
    var fitted = Object.assign({}, config);
    var available = Math.max(1, infoBar.y + infoBar.height - config.y - (config.bottomPadding || 12));
    var estimated = estimateHorizontalHeight(keys, fitted);
    var scale;

    if (estimated > available && keys.indexOf("tip") >= 0) {
      keys = keys.filter(function (key) {
        return key !== "tip";
      });
      fitted.omitTip = true;
      estimated = estimateHorizontalHeight(keys, fitted);
    }

    if (estimated > available) {
      scale = Math.max(0.55, available / estimated);
      fitted.fontSizes = Object.assign({}, fitted.fontSizes || {});
      keys.forEach(function (key) {
        fitted.fontSizes[key] = Math.max(
          fitted.minFontSize || 6,
          Math.round(configuredFontSize(config, key, config.maxFontSize || 10) * scale * 10) / 10
        );
      });
      fitted.lineGap = Math.max(0, Math.floor((fitted.lineGap || 0) * scale));
    }

    return {
      keys: keys,
      config: fitted
    };
  }

  function estimateVerticalTextHeight(key, config, settings, options) {
    var itemConfig = {};
    var value;
    if (key === "phone" && config.phonePrefix) {
      itemConfig.prefix = config.phonePrefix;
    }
    if (config.separators && typeof config.separators[key] === "string") {
      itemConfig.separator = config.separators[key];
    }
    value = buildTextValue(key, settings || {}, options || {}, itemConfig);
    return String(value || "").replace(/\s+/g, "").length * estimatedTextHeight(configuredFontSize(config, key, config.maxFontSize || 6));
  }

  function estimateVerticalHeight(keys, config, settings, options) {
    var total = 0;
    keys.forEach(function (key) {
      total = Math.max(total, estimateVerticalTextHeight(key, config, settings, options));
    });
    return total;
  }

  function fitVerticalConfig(infoBar, config, keys, settings, options) {
    var fitted = Object.assign({}, config);
    var available = Math.max(1, infoBar.y + infoBar.height - config.y - (config.bottomPadding || 18));
    var estimated = estimateVerticalHeight(keys, fitted, settings, options);
    var scale;

    if (estimated > available && keys.indexOf("tip") >= 0) {
      keys = keys.filter(function (key) {
        return key !== "tip";
      });
      fitted.omitTip = true;
      estimated = estimateVerticalHeight(keys, fitted, settings, options);
    }

    if (estimated > available) {
      scale = Math.max(0.5, available / estimated);
      fitted.fontSizes = Object.assign({}, fitted.fontSizes || {});
      keys.forEach(function (key) {
        fitted.fontSizes[key] = Math.max(
          fitted.minFontSize || 5.5,
          Math.round(configuredFontSize(config, key, config.maxFontSize || 6) * scale * 10) / 10
        );
      });
      fitted.groupGap = Math.max(2, Math.floor((fitted.groupGap || 8) * scale));
      fitted.lineGap = Math.max(0, Math.floor((fitted.lineGap || 0) * scale));
    }

    return {
      keys: keys,
      config: fitted
    };
  }

  function makeConfiguredItem(key, text, config, infoBar, options) {
    var color = colorOrDefault(infoBar.textColor, { red: 255, green: 238, blue: 150 });
    var baseSizes = {
      shopName: config.maxFontSize || 12,
      date: Math.max(config.minFontSize || 6, (config.maxFontSize || 12) - 1),
      phone: Math.max(config.minFontSize || 6, (config.maxFontSize || 12) - 2),
      tip: Math.max(config.minFontSize || 6, (config.maxFontSize || 12) - 3)
    };
    return {
      key: key,
      fieldKey: key,
      text: text,
      x: Math.round(config.x),
      y: Math.round(config.y),
      width: Math.round(config.width || 0),
      height: Math.round(config.height || 0),
      fontSize: configuredFontSize(config, key, baseSizes[key] || config.minFontSize || 6),
      lineGap: typeof config.lineGap === "number" ? config.lineGap : 8,
      color: config.color ? colorOrDefault(config.color, color) : color,
      name: config.names && config.names[key] ? config.names[key] : key,
      debugFixedPosition: Boolean(config.debugFixedPosition)
    };
  }

  function buildHorizontalConfiguredItems(infoBar, settings, options, config) {
    config = normalizeHorizontalConfig(infoBar, config);
    var fit = fitHorizontalConfig(infoBar, config, configuredKeys(config));
    var keys = fit.keys;
    config = fit.config;
    return keys
      .map(function (key, index) {
        var itemConfig = {};
        var text;
        var column = config.columns && config.columns[key] ? config.columns[key] : null;
        var itemOptions;
        if (key === "phone" && config.phonePrefix) {
          itemConfig.prefix = config.phonePrefix;
        }
        if (config.separators && typeof config.separators[key] === "string") {
          itemConfig.separator = config.separators[key];
        }
        text = buildTextValue(key, settings || {}, options || {}, itemConfig);
        itemOptions = Object.assign({}, config, {
          x: column && typeof column.x === "number" ? column.x : config.x,
          y: column && typeof column.y === "number" ? column.y : index === 0 ? config.y : 0,
          width: column && column.width ? column.width : config.width,
          height: column && column.height ? column.height : config.height,
          debugFixedPosition: Boolean(config.debugFixedPosition || column)
        });
        itemOptions = makeConfiguredItem(key, text, itemOptions, infoBar, options);
        if (column && (column.width || column.height)) {
          itemOptions.debugTargetBounds = {
            x: itemOptions.x,
            y: itemOptions.y,
            width: Math.round(column.width || 0),
            height: Math.round(column.height || 0),
            fontSize: itemOptions.fontSize
          };
        }
        return itemOptions;
      })
      .filter(function (item) {
        return String(item.text || "").trim().length > 0;
      });
  }

  function buildVerticalConfiguredItems(infoBar, settings, options, config) {
    var fit = fitVerticalConfig(infoBar, config, configuredKeys(config), settings, options);
    var keys = fit.keys;
    var items = [];
    config = fit.config;

    keys.forEach(function (key, index) {
      var itemConfig = {};
      var value;
      var fontSize;
      var column = config.columns && config.columns[key] ? config.columns[key] : null;

      if (key === "phone" && config.phonePrefix) {
        itemConfig.prefix = config.phonePrefix;
      }
      if (config.separators && typeof config.separators[key] === "string") {
        itemConfig.separator = config.separators[key];
      }
      value = buildTextValue(key, settings || {}, options || {}, itemConfig);
      fontSize = configuredFontSize(config, key, config.maxFontSize || 6);

      if (String(value || "").trim().length > 0) {
        items.push({
          key: key,
          fieldKey: key,
          text: value,
          x: Math.round(column && typeof column.x === "number" ? column.x : config.x - index * (config.columnGap || 48)),
          y: Math.round(column && typeof column.y === "number" ? column.y : config.y),
          width: Math.round(column && column.width ? column.width : 0),
          height: Math.round(column && column.height ? column.height : 0),
          fontSize: fontSize,
          lineGap: 0,
          orientation: "vertical",
          color: colorOrDefault(infoBar.textColor, { red: 255, green: 238, blue: 150 }),
          name: key,
          debugFixedPosition: Boolean(config.debugFixedPosition || column)
        });
      }
    });

    return items;
  }

  async function renderInfoBar(targetDocument, infoBar, settings, options) {
    var lines = infoBar ? buildLines(settings || {}, options || {}) : [];
    var textItems = [];
    var createdCount = 0;
    var layout;
    var template = options && options.template ? options.template : {};
    var hasConfiguredHorizontalTextBlock;

    if (!infoBar || infoBar.enabled === false || infoBar.position === "none") {
      return {
        ok: true,
        createdCount: 0,
        message: "当前模板不需要信息条"
      };
    }

    infoBar = clampInfoBar(infoBar);
    layout = getLineLayout(infoBar);
    hasConfiguredHorizontalTextBlock = Boolean(infoBar.texts && !Array.isArray(infoBar.texts) && infoBar.texts.mode === "horizontalBlock");
    textItems = layout.explicitTexts ? buildExplicitTextItems(infoBar, settings || {}, options || {}) : buildAutoTextItems(lines, layout, infoBar);
    textItems = applyTextLayerOverrides(textItems, infoBar);

    debugLog("[infoBarRenderer] infoBar bounds", {
      templateId: template.id || "",
      templateName: template.name || "",
      enabled: true,
      position: infoBar.position || infoBar.kind,
      orientation: infoBar.orientation,
      x: infoBar.x,
      y: infoBar.y,
      width: infoBar.width,
      height: infoBar.height,
      canvasWidth: CANVAS_WIDTH_PX,
      canvasHeight: CANVAS_HEIGHT_PX,
      avatar: getAvatarRect(infoBar),
      texts: textItems.map(function (item) {
        return {
          key: item.key,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          fontSize: item.fontSize,
          outOfCanvas: item.x < 0 || item.y < 0 || item.x > CANVAS_WIDTH_PX || item.y > CANVAS_HEIGHT_PX
        };
      })
    });

    await window.IDPhotoPhotoshopExecution.executeAsModal(
      async function () {
        var i;
        var item;
        var layerService = getLayerService();
        var previousBottom = null;
        var targetLeft;
        var targetTop;
        var textLayer;
        var bounds;
        var textLayerEntries = [];
        var textSummary = {};
        var hasFixedTextPositions = false;
        var knownTargetLayerIds;
        var omittedTip = Boolean(infoBar.texts && !Array.isArray(infoBar.texts) && infoBar.texts.omitTip);
        var targetRect = {
          x: infoBar.x,
          y: infoBar.y,
          width: infoBar.width,
          height: infoBar.height
        };
        await activateDocument(targetDocument);
        await createInfoBarBackground(infoBar, options || {});
        await createAvatarThumbnail(targetDocument, getAvatarRect(infoBar), options || {});
        knownTargetLayerIds = layerService.getDocumentLayerIds(targetDocument);
        for (i = 0; i < textItems.length; i += 1) {
          item = textItems[i];
          hasFixedTextPositions = hasFixedTextPositions || Boolean(item.debugFixedPosition);
          targetLeft = item.x;
          targetTop =
            item.debugFixedPosition || item.orientation === "vertical"
              ? item.y
              : previousBottom === null
                ? item.y
                : previousBottom + (typeof item.lineGap === "number" ? item.lineGap : 8);
          debugLog("[infoBarRenderer] text layer", {
            templateId: template.id || "",
            index: i + 1,
            key: item.key,
            text: item.text,
            x: Math.round(targetLeft),
            y: Math.round(targetTop),
            width: item.width,
            height: item.height,
            fontSize: item.fontSize,
            outOfCanvas: targetLeft < 0 || targetTop < 0 || targetLeft > CANVAS_WIDTH_PX || targetTop > CANVAS_HEIGHT_PX,
            aboveBackground: true
          });
          textLayer = await createTextLayer(
            targetDocument,
            item.text,
            targetLeft,
            targetTop,
            item.fontSize,
            isDebugRender(options) ? getDebugTextLayerName(item) : item.name,
            item.color,
            item.orientation,
            knownTargetLayerIds
          );
          await layerService.moveLayerTo(textLayer, targetLeft, targetTop, item.key || i + 1);
          bounds = await fitTextLayerToSavedBounds(layerService, textLayer, item, targetLeft, targetTop);
          textLayerEntries.push({
            item: item,
            layer: textLayer,
            bounds: bounds
          });
          if (item.orientation !== "vertical") {
            previousBottom = Math.round(bounds.bottom);
          }
          if (template.id === "one-inch" || DEBUG_INFO_BAR) {
            console.log("[infoBarRenderer] final text layer", {
              key: item.key,
              targetX: Math.round(targetLeft),
              targetY: Math.round(targetTop),
              fontSize: item.fontSize,
              bounds: formatBounds(bounds),
              outOfCanvas: !isBoundsInsideCanvas(bounds),
              outOfInfoBar: !isBoundsInsideRect(bounds, targetRect)
            });
          }
          createdCount += 1;
        }
        if (!hasFixedTextPositions && !hasConfiguredHorizontalTextBlock) {
          await alignTextGroup(layerService, textLayerEntries, infoBar);
        }
        textLayerEntries.forEach(function (entry) {
          textSummary[entry.item.fieldKey || entry.item.key] = {
            fontSize: entry.item.fontSize,
            lastBounds: formatBounds(entry.bounds),
            outOfCanvas: !isBoundsInsideCanvas(entry.bounds),
            outOfInfoBar: !isBoundsInsideRect(entry.bounds, targetRect)
          };
        });
        console.log("[infoBarRenderer] summary", {
          templateId: template.id || "",
          position: infoBar.position || infoBar.kind,
          orientation: infoBar.orientation,
          infoBar: {
            x: infoBar.x,
            y: infoBar.y,
            width: infoBar.width,
            height: infoBar.height
          },
          avatar: getAvatarRect(infoBar),
          shownTextKeys: Object.keys(textSummary),
          textSummary: textSummary,
          omittedTip: omittedTip
        });
      },
      "绘制证件照信息条"
    );

    return {
      ok: true,
      createdCount: createdCount,
      message: (infoBar.kind === "right" ? "右侧" : "底部") + "信息条已生成：" + createdCount + " 行"
    };
  }

  async function renderRightInfoBar(targetDocument, infoBar, settings, options) {
    infoBar.kind = "right";
    return renderInfoBar(targetDocument, infoBar, settings, options);
  }

  window.IDPhotoInfoBarRenderer = {
    renderInfoBar: renderInfoBar,
    renderRightInfoBar: renderRightInfoBar
  };
})();
