(function () {
  "use strict";

  function getPhotoshopModule() {
    if (!window.IDPhotoPhotoshopExecution) {
      throw new Error("photoshopExecution 未加载");
    }
    return window.IDPhotoPhotoshopExecution.getPhotoshop();
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

  function readResolution(value) {
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

  function getActiveDocument() {
    var photoshop = getPhotoshopModule();
    var app = photoshop.app;
    if (!app || !app.documents || app.documents.length === 0) {
      return null;
    }
    return app.activeDocument || null;
  }

  async function activateDocument(documentRef) {
    if (documentRef && typeof documentRef.activate === "function") {
      await documentRef.activate();
    }
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

  function getCompositeLayer(documentRef) {
    return getActiveLayer(documentRef) || getTopLayer(documentRef) || (documentRef ? documentRef.backgroundLayer : null);
  }

  async function batchPlay(commands) {
    return await window.IDPhotoPhotoshopExecution.batchPlay(commands);
  }

  async function getActiveDocumentXmp() {
    var result = await batchPlay([
      {
        _obj: "get",
        _target: [
          { _property: "XMPMetadataAsUTF8" },
          { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
        ],
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
    return result && result[0] ? String(result[0].XMPMetadataAsUTF8 || "") : "";
  }

  async function attachSourceMetadata(info) {
    var raw;
    if (!info) {
      return info;
    }
    try {
      raw = await getActiveDocumentXmp();
    } catch (error) {
      raw = "";
    }
    if (window.IDPhotoSourceEligibilityService && window.IDPhotoSourceEligibilityService.parseXmp) {
      info.sourceMetadata = window.IDPhotoSourceEligibilityService.parseXmp(raw);
    }
    return info;
  }

  async function closeDocumentDirect(documentRef) {
    if (!documentRef) {
      return false;
    }

    await activateDocument(documentRef);
    if (typeof documentRef.close === "function") {
      try {
        await documentRef.close("no");
        return true;
      } catch (closeStringError) {
        try {
          await documentRef.close({ save: false });
          return true;
        } catch (closeObjectError) {
          console.warn("[document] document.close failed, falling back to batchPlay", closeStringError, closeObjectError);
        }
      }
    }

    await batchPlay([
      {
        _obj: "close",
        saving: { _enum: "yesNo", _value: "no" },
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
    return true;
  }

  async function closeWithoutSaving(documentRef) {
    if (!documentRef) {
      return {
        ok: true,
        closed: false,
        message: "没有需要关闭的文档"
      };
    }
    await window.IDPhotoPhotoshopExecution.executeAsModal(
      async function () {
        await closeDocumentDirect(documentRef);
      },
      "关闭未保存文档"
    );

    return {
      ok: true,
      closed: true,
      message: "已关闭文档且未保存"
    };
  }

  async function renameLayer(layer, name) {
    var layerId = getLayerId(layer);
    if (!layerId) {
      return;
    }
    await batchPlay([
      {
        _obj: "set",
        _target: [{ _ref: "layer", _id: layerId }],
        to: { _obj: "layer", name: name },
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
  }

  async function flattenVisibleDocument(documentRef) {
    await activateDocument(documentRef);
    await batchPlay([
      {
        _obj: "flattenImage",
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
    return getCompositeLayer(documentRef);
  }

  async function createStampedVisibleLayer(sourceDocument) {
    var layer;

    await activateDocument(sourceDocument);
    await batchPlay([
      {
        _obj: "selectAll",
        _options: { dialogOptions: "dontDisplay" }
      },
      {
        _obj: "copyEvent",
        merged: true,
        _options: { dialogOptions: "dontDisplay" }
      },
      {
        _obj: "paste",
        _options: { dialogOptions: "dontDisplay" }
      },
      {
        _obj: "set",
        _target: [{ _property: "selection", _ref: "channel" }],
        to: { _enum: "ordinal", _value: "none" },
        _options: { dialogOptions: "dontDisplay" }
      }
    ]);
    layer = getCompositeLayer(sourceDocument);
    await renameLayer(layer, "证件照拼版源_盖印可见");
    return layer;
  }

  async function prepareCompositeSourceLayer(sourceDocument) {
    var layer;
    var flattenError = null;

    if (!sourceDocument) {
      throw new Error("缺少源文档，无法生成拼版源图像层");
    }

    try {
      layer = await flattenVisibleDocument(sourceDocument);
      await renameLayer(layer, "证件照拼版源_盖印可见");
      return {
        ok: true,
        method: "flatten-visible-temp-document",
        layer: layer,
        temporaryLayer: false
      };
    } catch (error) {
      flattenError = error;
      console.warn("[document] flatten visible failed, falling back to stamped visible layer", error);
    }

    try {
      layer = await createStampedVisibleLayer(sourceDocument);
      return {
        ok: true,
        method: "copy-merged-visible-layer",
        layer: layer,
        temporaryLayer: true
      };
    } catch (stampError) {
      throw new Error(
        "生成完整可见画面拼版源失败：" +
          (stampError.message || stampError) +
          (flattenError ? "；flatten 失败：" + (flattenError.message || flattenError) : "")
      );
    }
  }

  async function cleanupTempSourceLayer(sourceDocument, tempLayer) {
    if (!sourceDocument || !tempLayer) {
      return {
        ok: true,
        cleaned: false,
        message: "没有需要清理的临时盖印层"
      };
    }
    return {
      ok: true,
      cleaned: false,
      message: "临时盖印层位于处理后单张临时文档中，将随临时文档关闭"
    };
  }

  async function getInfoFromDom() {
    var photoshop = getPhotoshopModule();
    var app = photoshop.app;
    var doc;

    if (!app || !app.documents || app.documents.length === 0) {
      return null;
    }

    doc = app.activeDocument;
    if (!doc) {
      return null;
    }

    return {
      id: doc.id || doc._id || null,
      name: doc.title || doc.name || "未命名文档",
      widthPx: readDimension(doc.width),
      heightPx: readDimension(doc.height),
      resolution: readResolution(doc.resolution)
    };
  }

  async function getInfoFromBatchPlay() {
    var result = await window.IDPhotoPhotoshopExecution.batchPlay(
      [
        {
          _obj: "get",
          _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
          _options: { dialogOptions: "dontDisplay" }
        }
      ]
    );
    var doc = result && result[0] ? result[0] : null;
    if (!doc) {
      return null;
    }
    return {
      id: doc.documentID || doc.ID || null,
      name: doc.title || doc.name || "未命名文档",
      widthPx: readDimension(doc.width),
      heightPx: readDimension(doc.height),
      resolution: readResolution(doc.resolution)
    };
  }

  async function getActiveDocumentInfo() {
    var info;
    if (!getActiveDocument()) {
      return null;
    }
    try {
      info = await getInfoFromDom();
      if (info && info.widthPx && info.heightPx && info.resolution) {
        return await attachSourceMetadata(info);
      }
    } catch (error) {
      // Fall back to batchPlay below.
    }

    try {
      return await attachSourceMetadata(await getInfoFromBatchPlay());
    } catch (error) {
      return null;
    }
  }

  async function ensureActiveDocument() {
    var info = await getActiveDocumentInfo();
    if (!info) {
      return {
        ok: false,
        message: "当前没有打开照片，请先拖入照片到 Photoshop"
      };
    }
    return {
      ok: true,
      document: info,
      message: "已读取当前文档：" + info.name + "，" + info.widthPx + "x" + info.heightPx + "px，" + info.resolution + "ppi"
    };
  }

  window.IDPhotoDocumentService = {
    getActiveDocument: getActiveDocument,
    getActiveDocumentInfo: getActiveDocumentInfo,
    getActiveDocumentXmp: getActiveDocumentXmp,
    ensureActiveDocument: ensureActiveDocument,
    getActiveLayer: getActiveLayer,
    getTopLayer: getTopLayer,
    getLayerId: getLayerId,
    closeWithoutSaving: closeWithoutSaving,
    prepareCompositeSourceLayer: prepareCompositeSourceLayer,
    createStampedVisibleLayer: createStampedVisibleLayer,
    cleanupTempSourceLayer: cleanupTempSourceLayer
  };
})();
