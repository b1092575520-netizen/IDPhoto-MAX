(function () {
  "use strict";

  var TARGET_PPI = 600;

  function makeProcessedName(template, sourceName) {
    return "单张处理_" + template.name.replace(/\s+/g, "") + "_" + String(sourceName || "未命名").replace(/\.[^.]+$/, "");
  }

  async function activateDocument(documentRef) {
    await window.IDPhotoPhotoshopExecution.activateDocument(documentRef);
  }

  async function duplicateDocument(sourceDocument, name) {
    if (typeof sourceDocument.duplicate === "function") {
      return await sourceDocument.duplicate(name);
    }
    throw new Error("当前 Photoshop DOM 不支持复制当前照片文档");
  }

  async function closeDocumentWithoutSaving(documentRef) {
    if (!window.IDPhotoDocumentService || !window.IDPhotoDocumentService.closeWithoutSaving) {
      throw new Error("documentService 缺少 closeWithoutSaving");
    }
    return await window.IDPhotoDocumentService.closeWithoutSaving(documentRef);
  }

  async function cropDocumentWithDomOrBatchPlay(documentRef, bounds) {
    var domError = null;

    if (documentRef && typeof documentRef.crop === "function") {
      try {
        await documentRef.crop({
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom
        });
        return "dom";
      } catch (error) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
        domError = error;
        console.warn("[crop] document.crop failed, falling back to batchPlay", error);
      }
    }

    try {
      await window.IDPhotoPhotoshopExecution.batchPlay([
        {
          _obj: "crop",
          to: {
            _obj: "rectangle",
            top: { _unit: "pixelsUnit", _value: bounds.top },
            left: { _unit: "pixelsUnit", _value: bounds.left },
            bottom: { _unit: "pixelsUnit", _value: bounds.bottom },
            right: { _unit: "pixelsUnit", _value: bounds.right }
          },
          angle: { _unit: "angleUnit", _value: 0 },
          delete: true,
          _options: { dialogOptions: "dontDisplay" }
        }
      ]);
    } catch (batchError) {
      window.IDPhotoPhotoshopExecution.throwIfCancelled(batchError);
      throw domError || batchError;
    }
    return "batchPlay";
  }

  async function resizeDocumentWithDomOrBatchPlay(documentRef, widthPx, heightPx) {
    var domError = null;

    if (documentRef && typeof documentRef.resizeImage === "function") {
      try {
        await documentRef.resizeImage(widthPx, heightPx, TARGET_PPI);
        return "dom";
      } catch (error) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
        domError = error;
        console.warn("[crop] document.resizeImage failed, falling back to batchPlay", error);
      }
    }

    try {
      await window.IDPhotoPhotoshopExecution.batchPlay([
        {
          _obj: "imageSize",
          width: { _unit: "pixelsUnit", _value: widthPx },
          height: { _unit: "pixelsUnit", _value: heightPx },
          resolution: { _unit: "densityUnit", _value: TARGET_PPI },
          constrainProportions: false,
          interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" },
          _options: { dialogOptions: "dontDisplay" }
        }
      ]);
    } catch (batchError) {
      window.IDPhotoPhotoshopExecution.throwIfCancelled(batchError);
      throw domError || batchError;
    }
    return "batchPlay";
  }

  async function rotateDocumentWithDomOrBatchPlay(documentRef, degrees) {
    var domError = null;

    if (!degrees) {
      return "skipped";
    }

    if (documentRef && typeof documentRef.rotateCanvas === "function") {
      try {
        await documentRef.rotateCanvas(degrees);
        return "dom";
      } catch (error) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
        domError = error;
        console.warn("[crop] document.rotateCanvas failed, falling back to batchPlay", error);
      }
    }

    try {
      await window.IDPhotoPhotoshopExecution.batchPlay([
        {
          _obj: "rotateEventEnum",
          _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
          angle: { _unit: "angleUnit", _value: degrees },
          _options: { dialogOptions: "dontDisplay" }
        }
      ]);
    } catch (batchError) {
      window.IDPhotoPhotoshopExecution.throwIfCancelled(batchError);
      throw domError || batchError;
    }
    return "batchPlay";
  }

  function normalizeStrategy(strategy) {
    if (window.IDPhotoCropStrategyStore && window.IDPhotoCropStrategyStore.normalize) {
      return window.IDPhotoCropStrategyStore.normalize(strategy);
    }
    if (strategy === "generative") {
      return "content-aware";
    }
    return strategy === "content-aware" || strategy === "auto" ? strategy : "crop";
  }

  function getStrategyLabel(strategy) {
    if (window.IDPhotoCropStrategyStore && window.IDPhotoCropStrategyStore.getLabel) {
      return window.IDPhotoCropStrategyStore.getLabel(strategy);
    }
    return strategy;
  }

  function planCropComposition(docInfo, targetRatio) {
    if (!window.IDPhotoSmartCropPlanner || !window.IDPhotoSmartCropPlanner.plan) {
      throw new Error("smartCropPlanner 未加载");
    }
    return window.IDPhotoSmartCropPlanner.plan({
      width: docInfo.widthPx,
      height: docInfo.heightPx,
      targetRatio: targetRatio
    });
  }

  async function runContentAwareExpansion(documentRef, docInfo, targetRatio, bounds) {
    if (!window.IDPhotoContentAwareService || !window.IDPhotoContentAwareService.expandToRatio) {
      throw new Error("contentAwareService 未加载");
    }
    return await window.IDPhotoContentAwareService.expandToRatio(documentRef, {
      docInfo: docInfo,
      targetRatio: targetRatio,
      bounds: bounds
    });
  }

  function getAutomaticCropLabel(compositionPlan) {
    return compositionPlan ? "自动裁切（快速构图，保留顶部）" : "自动裁切";
  }

  async function applyMismatchStrategy(documentRef, docInfo, compositionPlan, targetRatio, strategy) {
    var warnings = [];
    var bounds = compositionPlan.bounds;
    var autoDecision = strategy === "auto" ? compositionPlan : null;
    var automaticSquareExpansion = strategy === "auto" && compositionPlan.squareTarget;
    var effectiveStrategy = strategy === "content-aware" || automaticSquareExpansion ? "content-aware" : "crop";

    if (effectiveStrategy === "content-aware") {
      try {
        await runContentAwareExpansion(documentRef, docInfo, targetRatio, bounds);
        return {
          cropMode: "content-aware-expand",
          strategyUsed: automaticSquareExpansion ? "正方形模板，自动内容识别填充扩图" : "内容识别填充扩图",
          warnings: warnings,
          autoDecision: autoDecision,
          cropBounds: bounds
        };
      } catch (contentAwareError) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(contentAwareError);
        warnings.push("内容识别填充扩图失败：" + (contentAwareError.message || contentAwareError));
        if (contentAwareError.fallbackBounds) {
          bounds = contentAwareError.fallbackBounds;
        }
        console.warn("[crop] content-aware expand failed, falling back to crop", contentAwareError);
      }
    }

    return {
      cropMode: await cropDocumentWithDomOrBatchPlay(documentRef, bounds),
      strategyUsed: autoDecision ? getAutomaticCropLabel(compositionPlan) : "默认裁切（保留顶部，裁掉富余背景）",
      warnings: warnings,
      autoDecision: autoDecision,
      cropBounds: bounds
    };
  }

  async function prepareSinglePhoto(sourceDocument, docInfo, template, ratioResult, options) {
    var targetRatio = template.widthPx / template.heightPx;
    var rotationDegrees = ratioResult && Number(ratioResult.rotationDegrees) ? Number(ratioResult.rotationDegrees) : 0;
    var effectiveDocInfo = Object.assign({}, docInfo, {
      widthPx: ratioResult && ratioResult.effectiveWidthPx ? ratioResult.effectiveWidthPx : rotationDegrees ? docInfo.heightPx : docInfo.widthPx,
      heightPx: ratioResult && ratioResult.effectiveHeightPx ? ratioResult.effectiveHeightPx : rotationDegrees ? docInfo.widthPx : docInfo.heightPx
    });
    var compositionPlan = planCropComposition(effectiveDocInfo, targetRatio);
    var bounds = compositionPlan.bounds;
    var processedDocument = null;
    var cropped = !(ratioResult && ratioResult.ok);
    var requestedStrategy = normalizeStrategy(options && options.strategy);
    var strategyResult = {
      cropMode: "skipped",
      strategyUsed: cropped ? getStrategyLabel(requestedStrategy) : "比例符合，跳过裁切",
      warnings: []
    };
    var cropMode = "skipped";
    var resizeMode = "skipped";
    var rotationMode = "skipped";
    var processedName = makeProcessedName(template, docInfo.name);
    var compositeResult = null;

    try {
      await window.IDPhotoPhotoshopExecution.executeAsModal(
        async function () {
          processedDocument = await duplicateDocument(sourceDocument, processedName);
          if (processedDocument === sourceDocument || (processedDocument && processedDocument.id != null &&
              sourceDocument && processedDocument.id === sourceDocument.id)) {
            processedDocument = null;
            throw new Error("复制结果指向原片，已停止处理以保护原片");
          }
          await activateDocument(processedDocument);
          rotationMode = await rotateDocumentWithDomOrBatchPlay(processedDocument, rotationDegrees);
          if (!window.IDPhotoDocumentService || !window.IDPhotoDocumentService.prepareCompositeSourceLayer) {
            throw new Error("documentService 缺少 prepareCompositeSourceLayer，无法生成完整可见画面拼版源");
          }
          compositeResult = await window.IDPhotoDocumentService.prepareCompositeSourceLayer(processedDocument);

          if (cropped) {
            compositionPlan = planCropComposition(effectiveDocInfo, targetRatio);
            bounds = compositionPlan.bounds;
            strategyResult = await applyMismatchStrategy(processedDocument, effectiveDocInfo, compositionPlan, targetRatio, requestedStrategy);
            bounds = strategyResult.cropBounds || bounds;
            cropMode = strategyResult.cropMode;
          }

          resizeMode = await resizeDocumentWithDomOrBatchPlay(processedDocument, template.widthPx, template.heightPx);
        },
        "裁切并处理单张证件照"
      );
    } catch (error) {
      if (processedDocument) {
        try {
          await closeDocumentWithoutSaving(processedDocument);
        } catch (closeError) {
          console.warn("[crop] failed to close temporary processed document after error", closeError);
        }
      }
      throw error;
    }

    return {
      ok: true,
      document: processedDocument,
      temporaryDocument: true,
      cropped: cropped,
      cropBounds: bounds,
      cropMode: cropMode,
      resizeMode: resizeMode,
      rotationDegrees: rotationDegrees,
      rotationMode: rotationMode,
      compositeMode: compositeResult ? compositeResult.method : "none",
      compositeLayer: compositeResult ? compositeResult.layer : null,
      compositeTemporaryLayer: compositeResult ? compositeResult.temporaryLayer : false,
      requestedStrategy: requestedStrategy,
      strategyUsed: strategyResult.strategyUsed,
      strategyWarnings: strategyResult.warnings || [],
      autoDecision: strategyResult.autoDecision || null,
      compositionPlan: compositionPlan,
      widthPx: template.widthPx,
      heightPx: template.heightPx,
      resolution: TARGET_PPI,
      message:
        (rotationDegrees ? "已自动旋转为横向；" : "") +
        (cropped ? "已按策略处理：" + strategyResult.strategyUsed : "比例已符合，跳过裁切") +
        "，单张已处理为 " +
        template.widthPx +
        "x" +
        template.heightPx +
        "px / " +
        TARGET_PPI +
        "ppi" +
        (strategyResult.warnings && strategyResult.warnings.length ? "；回退记录：" + strategyResult.warnings.join("；") : "")
    };
  }

  window.IDPhotoCropService = {
    TARGET_PPI: TARGET_PPI,
    planCropComposition: planCropComposition,
    rotateDocumentWithDomOrBatchPlay: rotateDocumentWithDomOrBatchPlay,
    prepareSinglePhoto: prepareSinglePhoto,
    closeDocumentWithoutSaving: closeDocumentWithoutSaving
  };
})();
