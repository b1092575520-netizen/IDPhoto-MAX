(function () {
  "use strict";

  var DEBUG_LAYER_SERVICE = false;
  var COMPOSITE_SOURCE_LAYER_NAME = "证件照拼版源_盖印可见";
  var DEBUG_LAYER_NAMES = {
    background: "DEBUG_infoBar_background",
    avatar: "DEBUG_infoBar_avatar",
    text: {
      shopNameDate: "DEBUG_text_shopNameDate",
      shopName: "DEBUG_text_shopName",
      date: "DEBUG_text_date",
      phone: "DEBUG_text_phone",
      tip: "DEBUG_text_tip",
      pickupCode: "DEBUG_text_pickupCode",
      shopContact: "DEBUG_text_shopContact"
    }
  };

  function debugLog(message, payload) {
    if (!DEBUG_LAYER_SERVICE) {
      return;
    }
    if (payload !== undefined) {
      console.log(message, payload);
    } else {
      console.log(message);
    }
  }

  function getPhotoshopModule() {
    if (!window.IDPhotoPhotoshopExecution) {
      throw new Error("photoshopExecution 未加载");
    }
    return window.IDPhotoPhotoshopExecution.getPhotoshop();
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

  function readDimension(value) {
    if (typeof value === "number") {
      return Math.round(value);
    }
    if (value && typeof value === "object") {
      if (typeof value.value === "number") {
        return Math.round(value.value);
      }
      if (typeof value._value === "number") {
        return Math.round(value._value);
      }
    }
    return Math.round(Number(value) || 0);
  }

  function getLayerBounds(layer) {
    var bounds = layer.bounds || layer.boundsNoEffects;
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
      width: Math.round(bounds.right - bounds.left),
      height: Math.round(bounds.bottom - bounds.top),
      bounds: bounds
    };
  }

  function getLayerId(layer) {
    return layer && (layer.id || layer._id || layer.layerID || null);
  }

  function isClose(value, target) {
    return Math.abs(Math.round(value) - Math.round(target)) <= 2;
  }

  function formatBounds(bounds) {
    return {
      left: Math.round(bounds.left),
      top: Math.round(bounds.top),
      right: Math.round(bounds.right),
      bottom: Math.round(bounds.bottom)
    };
  }

  function getDocumentId(documentRef) {
    return documentRef && (documentRef.id || documentRef._id || documentRef.documentID || null);
  }

  async function activateDocument(documentRef) {
    await window.IDPhotoPhotoshopExecution.activateDocument(documentRef);
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

  function isUsableSourceLayer(layer) {
    var size;
    if (!layer) {
      return false;
    }
    size = getLayerSize(layer);
    return size.width > 0 && size.height > 0;
  }

  function findLayerByName(layers, name) {
    var index;
    var layer;
    var childMatch;

    if (!layers || !name) {
      return null;
    }

    for (index = 0; index < layers.length; index += 1) {
      layer = layers[index];
      if (layer && layer.name === name) {
        return layer;
      }
      childMatch = findLayerByName(layer && layer.layers, name);
      if (childMatch) {
        return childMatch;
      }
    }

    return null;
  }

  function collectLayers(layers, result) {
    var index;
    var layer;
    for (index = 0; layers && index < layers.length; index += 1) {
      layer = layers[index];
      if (layer) {
        result.push(layer);
        collectLayers(layer.layers, result);
      }
    }
    return result;
  }

  function getDocumentLayers(documentRef) {
    return collectLayers(documentRef && documentRef.layers, []);
  }

  function getDocumentLayerIds(documentRef) {
    var ids = {};
    getDocumentLayers(documentRef).forEach(function (layer) {
      var id = getLayerId(layer);
      if (id !== null && id !== undefined) {
        ids[String(id)] = true;
      }
    });
    return ids;
  }

  function boundsToRect(bounds) {
    return {
      x: Math.round(bounds.left),
      y: Math.round(bounds.top),
      width: Math.max(1, Math.round(bounds.right - bounds.left)),
      height: Math.max(1, Math.round(bounds.bottom - bounds.top))
    };
  }

  function readOptionalFontSize(layer) {
    var candidates = [];
    var textItem;

    try {
      textItem = layer && layer.textItem ? layer.textItem : null;
      if (textItem) {
        candidates.push(textItem.size);
        candidates.push(textItem.fontSize);
        candidates.push(textItem.characterStyle && textItem.characterStyle.size);
        candidates.push(textItem.textStyle && textItem.textStyle.size);
      }
      candidates.push(layer && layer.characterStyle && layer.characterStyle.size);
      candidates.push(layer && layer.textStyle && layer.textStyle.size);
    } catch (error) {
      return null;
    }

    for (var index = 0; index < candidates.length; index += 1) {
      var value = readBoundValue(candidates[index]);
      if (Number.isFinite(value) && value > 0) {
        return Math.round(value * 10) / 10;
      }
    }

    return null;
  }

  function getLayerBoundsByName(documentRef, name) {
    var layer = findLayerByName(documentRef && documentRef.layers, name);
    var bounds;
    var fontSize;

    if (!layer) {
      return null;
    }

    bounds = getLayerBounds(layer);
    fontSize = readOptionalFontSize(layer);
    return {
      layer: layer,
      bounds: bounds,
      rect: boundsToRect(bounds),
      fontSize: fontSize
    };
  }

  function getDebugInfoBarLayerBounds(documentRef) {
    var result = {
      background: getLayerBoundsByName(documentRef, DEBUG_LAYER_NAMES.background),
      avatar: getLayerBoundsByName(documentRef, DEBUG_LAYER_NAMES.avatar),
      text: {},
      missing: []
    };

    Object.keys(DEBUG_LAYER_NAMES.text).forEach(function (key) {
      var entry = getLayerBoundsByName(documentRef, DEBUG_LAYER_NAMES.text[key]);
      if (entry) {
        result.text[key] = entry;
      } else {
        result.missing.push(DEBUG_LAYER_NAMES.text[key]);
      }
    });

    if (!result.background) {
      result.missing.push(DEBUG_LAYER_NAMES.background);
    }
    if (!result.avatar) {
      result.missing.push(DEBUG_LAYER_NAMES.avatar);
    }

    return result;
  }

  function getSourceLayer(sourceDocument) {
    var compositeLayer = findLayerByName(sourceDocument && sourceDocument.layers, COMPOSITE_SOURCE_LAYER_NAME);
    var topLayer = getTopLayer(sourceDocument);
    var backgroundLayer = sourceDocument ? sourceDocument.backgroundLayer : null;

    if (isUsableSourceLayer(compositeLayer)) {
      return compositeLayer;
    }
    if (isUsableSourceLayer(backgroundLayer)) {
      return backgroundLayer;
    }
    if (sourceDocument && sourceDocument.layers && sourceDocument.layers.length === 1 && isUsableSourceLayer(topLayer)) {
      return topLayer;
    }
    return null;
  }

  async function moveLayerByBatchPlay(layer, deltaX, deltaY) {
    var layerId = getLayerId(layer);

    if (!layerId) {
      throw new Error("batchPlay move 缺少 layer id");
    }

    await window.IDPhotoPhotoshopExecution.batchPlay([
        {
          _obj: "move",
          _target: [{ _ref: "layer", _id: layerId }],
          to: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: Math.round(deltaX) },
            vertical: { _unit: "pixelsUnit", _value: Math.round(deltaY) }
          },
          _options: { dialogOptions: "dontDisplay" }
        }
      ]);
  }

  async function moveLayerWithDom(layer, deltaX, deltaY) {
    if (typeof layer.translate !== "function") {
      throw new Error("当前 Photoshop DOM 不支持图层移动");
    }
    await layer.translate(Math.round(deltaX), Math.round(deltaY));
  }

  async function moveLayerTo(layer, x, y, index) {
    var bounds = getLayerBounds(layer);
    var deltaX = Math.round(x - bounds.left);
    var deltaY = Math.round(y - bounds.top);
    var method = "domTranslate";
    var finalBounds;
    var domError = null;
    var batchError = null;

    debugLog("[layerService] move start", {
      index: index,
      layerName: layer.name,
      layerId: getLayerId(layer),
      targetX: Math.round(x),
      targetY: Math.round(y),
      initialBounds: formatBounds(bounds),
      deltaX: deltaX,
      deltaY: deltaY
    });

    if (isClose(bounds.left, x) && isClose(bounds.top, y)) {
      return bounds;
    }

    // Photoshop 27 can apply a text-layer transform to the active selection
    // even when a retained DOM Layer is passed. Select the verified target
    // before transforming an earlier text layer in the same document.
    var app = getPhotoshopModule().app;
    if (app && app.activeDocument) {
      var activeLayers = app.activeDocument.activeLayers;
      if (!activeLayers || activeLayers.length !== 1 || getLayerId(activeLayers[0]) !== getLayerId(layer)) {
        app.activeDocument.activeLayers = [layer];
      }
    }
    try {
      await moveLayerWithDom(layer, deltaX, deltaY);
      finalBounds = getLayerBounds(layer);
      if (!isClose(finalBounds.left, x) || !isClose(finalBounds.top, y)) {
        throw new Error("DOM translate 返回后图层未到目标位置");
      }
    } catch (error) {
      window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
      domError = error;
      method = "batchPlay";
      console.warn("[layerService] layer.translate failed or missed target, falling back to batchPlay move", error);
      bounds = getLayerBounds(layer);
      try {
        await moveLayerByBatchPlay(layer, Math.round(x - bounds.left), Math.round(y - bounds.top));
      } catch (error) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
        batchError = error;
      }
    }

    finalBounds = getLayerBounds(layer);
    debugLog("[layerService] move done", {
      index: index,
      layerName: layer.name,
      method: method,
      targetX: Math.round(x),
      targetY: Math.round(y),
      finalBounds: formatBounds(finalBounds),
      reachedTarget: isClose(finalBounds.left, x) && isClose(finalBounds.top, y)
    });
    if (batchError || !isClose(finalBounds.left, x) || !isClose(finalBounds.top, y)) {
      console.error("[layerService] move failed", {
        domError: domError,
        batchError: batchError,
        targetX: Math.round(x),
        targetY: Math.round(y),
        finalBounds: formatBounds(finalBounds)
      });
      throw new Error(
        "图层未到达目标位置：" +
          Math.round(x) +
          "," +
          Math.round(y) +
          "，实际 " +
          Math.round(finalBounds.left) +
          "," +
          Math.round(finalBounds.top)
      );
    }
    return finalBounds;
  }

  async function rotateLayerByBatchPlay(layer, degrees) {
    var layerId = getLayerId(layer);

    if (!layerId) {
      throw new Error("batchPlay transform 缺少 layer id");
    }

    await window.IDPhotoPhotoshopExecution.batchPlay([
        {
          _obj: "transform",
          _target: [{ _ref: "layer", _id: layerId }],
          freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
          angle: { _unit: "angleUnit", _value: Math.round(degrees) },
          interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
          _options: { dialogOptions: "dontDisplay" }
        }
      ]);
  }

  async function rotateLayer(layer, degrees) {
    if (!degrees) {
      return;
    }
    if (typeof layer.rotate === "function") {
      try {
        await layer.rotate(degrees);
        return;
      } catch (error) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
        console.warn("[layerService] layer.rotate failed, falling back to batchPlay transform", error);
      }
    }
    await rotateLayerByBatchPlay(layer, degrees);
  }

  async function runNewLayerOperation(targetDocument, operation, label, knownLayerIds) {
    var beforeIds;
    var newLayers;
    var error;

    if (!targetDocument || typeof operation !== "function") {
      throw new Error("新图层操作缺少目标文档或执行函数");
    }

    await activateDocument(targetDocument);
    beforeIds = knownLayerIds || getDocumentLayerIds(targetDocument);
    await operation();
    await activateDocument(targetDocument);
    newLayers = getDocumentLayers(targetDocument).filter(function (layer) {
      var id = getLayerId(layer);
      return id !== null && id !== undefined && !beforeIds[String(id)];
    });

    if (newLayers.length !== 1) {
      error = new Error((label || "图层操作") + "后无法确认唯一新图层：新增 " + newLayers.length + " 个");
      error.code = "NEW_LAYER_RESOLUTION_FAILED";
      throw error;
    }
    beforeIds[String(getLayerId(newLayers[0]))] = true;
    return newLayers[0];
  }

  async function duplicateLayerToDocument(sourceDocument, sourceLayer, targetDocument, knownLayerIds) {
    var layer;
    var method;

    if (!sourceDocument || !sourceLayer || !targetDocument) {
      throw new Error("复制图层缺少源文档、源图层或目标文档");
    }

    if (typeof sourceDocument.duplicateLayers === "function") {
      method = "duplicateLayers";
      layer = await runNewLayerOperation(
        targetDocument,
        async function () {
          await sourceDocument.duplicateLayers([sourceLayer], targetDocument);
        },
        "复制图层",
        knownLayerIds
      );
    } else if (typeof sourceLayer.duplicate === "function") {
      method = "layer.duplicate";
      layer = await runNewLayerOperation(
        targetDocument,
        async function () {
          await sourceLayer.duplicate(targetDocument);
        },
        "复制图层",
        knownLayerIds
      );
    } else {
      throw new Error("当前 Photoshop DOM 不支持复制图层到目标文档");
    }

    debugLog("[layerService] duplicate layer", {
      method: method,
      returnedLayerName: layer.name || "",
      returnedLayerId: getLayerId(layer),
      newLayerCount: 1
    });
    return layer;
  }

  function assertPreparedSize(sourceDocument, template) {
    var sourceSize = {
      width: readDimension(sourceDocument.width),
      height: readDimension(sourceDocument.height)
    };
    if (Math.abs(sourceSize.width - template.widthPx) > 3 || Math.abs(sourceSize.height - template.heightPx) > 3) {
      throw new Error(
        "处理后照片尺寸仍不符合模板，模板需要 " +
          template.widthPx +
          "x" +
          template.heightPx +
          "px，当前为 " +
          sourceSize.width +
          "x" +
          sourceSize.height +
          "px"
      );
    }
    return sourceSize;
  }

  function getImaging() {
    try {
      var ps = getPhotoshopModule();
      var img = ps && ps.imaging;
      if (
        img &&
        typeof img.getPixels === "function" &&
        typeof img.createImageDataFromBuffer === "function" &&
        typeof img.putPixels === "function"
      ) {
        return img;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function normalizeRightAngle(degrees) {
    if (degrees === undefined || degrees === null || degrees === "") {
      return 0;
    }
    var raw = Number(degrees);
    if (!Number.isFinite(raw) || Math.abs(raw - Math.round(raw)) > 1e-6) {
      return null;
    }
    var mod = ((Math.round(raw) % 360) + 360) % 360;
    if (mod === 0 || mod === 90 || mod === 180 || mod === 270) {
      return mod;
    }
    return null;
  }

  function stampPhotoIntoBuffer(outRgb, boxW, boxH, minX, minY, srcBuf, srcW, srcH, srcC, pos, backgroundRgb) {
    var angle = normalizeRightAngle(pos && pos.rotate);
    if (angle === null) {
      throw new Error("不支持非直角旋转：" + (pos && pos.rotate));
    }
    var baseX = Math.round(pos.x) - minX;
    var baseY = Math.round(pos.y) - minY;
    var bgR = backgroundRgb ? backgroundRgb.red : 255;
    var bgG = backgroundRgb ? backgroundRgb.green : 255;
    var bgB = backgroundRgb ? backgroundRgb.blue : 255;
    var sx;
    var sy;

    if (angle === 0 && srcC === 3 && typeof outRgb.set === "function" && typeof srcBuf.subarray === "function") {
      var rowBytes = srcW * 3;
      for (sy = 0; sy < srcH; sy += 1) {
        var srcRowOff = sy * rowBytes;
        var dstRowOff = ((baseY + sy) * boxW + baseX) * 3;
        outRgb.set(srcBuf.subarray(srcRowOff, srcRowOff + rowBytes), dstRowOff);
      }
      return;
    }

    for (sy = 0; sy < srcH; sy += 1) {
      for (sx = 0; sx < srcW; sx += 1) {
        var srcOff = (sy * srcW + sx) * srcC;
        var r = srcBuf[srcOff];
        var g = srcBuf[srcOff + 1];
        var b = srcBuf[srcOff + 2];
        if (srcC >= 4) {
          var a = srcBuf[srcOff + 3];
          if (a < 255) {
            if (a === 0) {
              r = bgR;
              g = bgG;
              b = bgB;
            } else {
              var inv = 255 - a;
              r = Math.round((r * a + bgR * inv) / 255);
              g = Math.round((g * a + bgG * inv) / 255);
              b = Math.round((b * a + bgB * inv) / 255);
            }
          }
        }
        var dx;
        var dy;
        if (angle === 0) {
          dx = sx;
          dy = sy;
        } else if (angle === 90) {
          dx = srcH - 1 - sy;
          dy = sx;
        } else if (angle === 180) {
          dx = srcW - 1 - sx;
          dy = srcH - 1 - sy;
        } else {
          dx = sy;
          dy = srcW - 1 - sx;
        }
        var dstOff = ((baseY + dy) * boxW + (baseX + dx)) * 3;
        outRgb[dstOff] = r;
        outRgb[dstOff + 1] = g;
        outRgb[dstOff + 2] = b;
      }
    }
  }

  async function tryPlacePhotoCopiesWithImaging(sourceDocument, targetDocument, layoutPlan, template, options) {
    if (options && options.separateLayers) {
      return null;
    }
    var imaging = getImaging();
    var sourceDocId = getDocumentId(sourceDocument);
    var targetDocId = getDocumentId(targetDocument);
    var positions = layoutPlan && layoutPlan.positions;
    if (
      !imaging ||
      sourceDocId === null ||
      sourceDocId === undefined ||
      targetDocId === null ||
      targetDocId === undefined ||
      typeof targetDocument.createLayer !== "function" ||
      !positions ||
      !positions.length
    ) {
      return null;
    }

    for (var checkIndex = 0; checkIndex < positions.length; checkIndex += 1) {
      var checkPos = positions[checkIndex];
      if (
        !checkPos ||
        normalizeRightAngle(checkPos.rotate) === null ||
        !Number.isFinite(Number(checkPos.x)) ||
        !Number.isFinite(Number(checkPos.y))
      ) {
        return null;
      }
    }

    var canvasW = (layoutPlan.canvas && layoutPlan.canvas.widthPx) || readDimension(targetDocument.width) || 3600;
    var canvasH = (layoutPlan.canvas && layoutPlan.canvas.heightPx) || readDimension(targetDocument.height) || 2400;
    var result = null;
    var dirtyLayerError = null;

    try {
      await window.IDPhotoPhotoshopExecution.executeAsModal(
        async function () {
          var createdLayer = null;
          var got = await imaging.getPixels({
            documentID: sourceDocId,
            colorSpace: "RGB",
            colorProfile: "sRGB IEC61966-2.1",
            componentSize: 8,
            applyAlpha: false
          });
          var srcW;
          var srcH;
          var srcC;
          var srcBuf;
          try {
            var srcImage = got && got.imageData;
            if (!srcImage) {
              return;
            }
            srcW = Number(srcImage.width);
            srcH = Number(srcImage.height);
            srcC = Number(srcImage.components);
            srcBuf = await srcImage.getData();
          } finally {
            if (got && got.imageData && typeof got.imageData.dispose === "function") {
              got.imageData.dispose();
            }
          }

          if (
            !(srcW > 0 && srcH > 0 && srcC >= 3) ||
            !srcBuf ||
            srcBuf.length < srcW * srcH * srcC ||
            Math.abs(srcW - template.widthPx) > 3 ||
            Math.abs(srcH - template.heightPx) > 3
          ) {
            return;
          }

          var minX = canvasW;
          var minY = canvasH;
          var maxX = 0;
          var maxY = 0;
          for (var i = 0; i < positions.length; i += 1) {
            var pos = positions[i];
            var angle = normalizeRightAngle(pos.rotate);
            var placedW = angle === 90 || angle === 270 ? srcH : srcW;
            var placedH = angle === 90 || angle === 270 ? srcW : srcH;
            var px = Math.round(pos.x);
            var py = Math.round(pos.y);
            if (px < 0 || py < 0 || px + placedW > canvasW || py + placedH > canvasH) {
              return;
            }
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px + placedW > maxX) maxX = px + placedW;
            if (py + placedH > maxY) maxY = py + placedH;
          }

          var boxW = maxX - minX;
          var boxH = maxY - minY;
          if (!(boxW > 0 && boxH > 0)) {
            return;
          }

          var outRgb = new Uint8Array(boxW * boxH * 3);
          outRgb.fill(255);
          for (var j = 0; j < positions.length; j += 1) {
            stampPhotoIntoBuffer(outRgb, boxW, boxH, minX, minY, srcBuf, srcW, srcH, srcC, positions[j]);
          }

          await activateDocument(targetDocument);
          createdLayer = await targetDocument.createLayer("pixel", { name: template.name + "_照片拼版" });
          var layerId = getLayerId(createdLayer);
          try {
            if (!createdLayer || layerId === null || layerId === undefined) {
              throw new Error("创建拼版像素图层失败");
            }

            var outImage = await imaging.createImageDataFromBuffer(outRgb, {
              width: boxW,
              height: boxH,
              components: 3,
              colorSpace: "RGB",
              colorProfile: "sRGB IEC61966-2.1"
            });
            try {
              await imaging.putPixels({
                documentID: targetDocId,
                layerID: layerId,
                imageData: outImage,
                targetBounds: { left: minX, top: minY }
              });
            } finally {
              if (outImage && typeof outImage.dispose === "function") {
                outImage.dispose();
              }
            }

            result = {
              ok: true,
              placedCount: positions.length,
              sourceSize: { width: srcW, height: srcH },
              layerSize: { width: srcW, height: srcH },
              pixelComposite: true,
              message: template.name + " 已拼版：" + positions.length + " 张"
            };
          } catch (modalError) {
            if (createdLayer) {
              try {
                if (typeof createdLayer.delete !== "function") {
                  throw new Error("图层不支持 delete");
                }
                await createdLayer.delete();
              } catch (cleanupError) {
                dirtyLayerError = new Error(
                  "拼版像素图异常且残留空图层清理失败，已停止回退叠加：" +
                    (cleanupError && cleanupError.message ? cleanupError.message : String(cleanupError || "未知错误"))
                );
              }
            }
            throw modalError;
          }
        },
        "证件照复制排版"
      );
    } catch (error) {
      window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
      if (dirtyLayerError) {
        throw dirtyLayerError;
      }
      console.warn("[layerService] imaging composite unavailable, falling back to layer copies", error);
      return null;
    }

    return result;
  }

  async function placePhotoCopies(sourceDocument, targetDocument, layoutPlan, template, options) {
    var sourceSize = assertPreparedSize(sourceDocument, template);
    var compositeResult = await tryPlacePhotoCopiesWithImaging(sourceDocument, targetDocument, layoutPlan, template, options);
    if (compositeResult) {
      return compositeResult;
    }

    var sourceLayer = getSourceLayer(sourceDocument);
    var placedLayers = [];
    var position;
    var layer;
    var layerId;
    var placedLayerIds = {};
    var reusableTargetLayer = null;
    var knownTargetLayerIds;
    var copyDocument;
    var copyLayer;
    var index;

    if (!sourceLayer) {
      throw new Error("当前文档没有可复制的完整图像画面，请检查是否成功生成盖印可见源图层");
    }

    await window.IDPhotoPhotoshopExecution.executeAsModal(
      async function () {
        await activateDocument(targetDocument);
        knownTargetLayerIds = getDocumentLayerIds(targetDocument);
        for (index = 0; index < layoutPlan.positions.length; index += 1) {
          position = layoutPlan.positions[index];
          debugLog("[layerService] placing photo", {
            index: index + 1,
            row: position.row,
            col: position.col,
            targetX: position.x,
            targetY: position.y,
            slotWidth: position.width,
            slotHeight: position.height,
            rotate: position.rotate || 0
          });
          copyDocument = reusableTargetLayer ? targetDocument : sourceDocument;
          copyLayer = reusableTargetLayer || sourceLayer;
          layer = await duplicateLayerToDocument(copyDocument, copyLayer, targetDocument, knownTargetLayerIds);
          if (!layer) {
            throw new Error("复制照片图层失败");
          }
          layerId = getLayerId(layer);
          if (layerId === null || layerId === undefined || placedLayerIds[String(layerId)]) {
            throw new Error("复制照片图层未产生唯一图层 id");
          }
          placedLayerIds[String(layerId)] = true;
          layer.name = template.name + "_照片_" + (index + 1);
          await rotateLayer(layer, position.rotate || 0);
          await moveLayerTo(layer, position.x, position.y, index + 1);
          placedLayers.push(layer);
          if (index === 0 && !(position.rotate || 0)) {
            reusableTargetLayer = layer;
          }
        }
      },
      "证件照复制排版"
    );

    if (placedLayers.length !== layoutPlan.positions.length) {
      throw new Error(
        "拼版图层数量不匹配：需要 " +
          layoutPlan.positions.length +
          " 张，实际 " +
          placedLayers.length +
          " 张"
      );
    }

    return {
      ok: true,
      placedCount: placedLayers.length,
      sourceSize: sourceSize,
      layerSize: placedLayers[0] ? getLayerSize(placedLayers[0]) : null,
      message: template.name + " 已复制排版：" + placedLayers.length + " 张"
    };
  }

  window.IDPhotoLayerService = {
    placePhotoCopies: placePhotoCopies,
    placeSourcePhotoCopies: placePhotoCopies,
    normalizeRightAngle: normalizeRightAngle,
    stampPhotoIntoBuffer: stampPhotoIntoBuffer,
    getLayerSize: getLayerSize,
    getLayerBounds: getLayerBounds,
    getLayerBoundsByName: getLayerBoundsByName,
    getDebugInfoBarLayerBounds: getDebugInfoBarLayerBounds,
    getDocumentLayerIds: getDocumentLayerIds,
    findLayerByName: findLayerByName,
    runNewLayerOperation: runNewLayerOperation,
    duplicateLayerToDocument: duplicateLayerToDocument,
    moveLayerTo: moveLayerTo
  };
})();
