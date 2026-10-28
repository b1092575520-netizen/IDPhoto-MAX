(function () {
  "use strict";

  function errorToText(error) {
    if (window.IDPhotoErrorService && window.IDPhotoErrorService.toText) {
      return window.IDPhotoErrorService.toText(error);
    }
    return error && error.message ? error.message : String(error || "未知错误");
  }

  function sameDocument(left, right) {
    return Boolean(left && right && (left === right ||
      (left.id != null && right.id != null && String(left.id) === String(right.id))));
  }

  function isCancellation(error) {
    return Boolean(error && (error.cancelled === true || error.number === -128 || error.code === -128 ||
      /user cancel/i.test(String(error.message || error))));
  }
  // Esc in the panel (10-18): every running layout stops at its next step. Photoshop's own
  // Esc already cancels a running progress bar; this covers the steps in between.
  var cancelRequests = [];
  function stopAll() {
    cancelRequests.forEach(function (request) { request.requested = true; });
    return cancelRequests.length > 0;
  }
  function checkCancel(request) {
    if (request && request.requested) {
      var stopped = new Error("已按 Esc 停止");
      stopped.cancelled = true;
      throw stopped;
    }
  }

  function requireMethod(moduleName, methodName) {
    var moduleRef = window[moduleName];
    if (!moduleRef || typeof moduleRef[methodName] !== "function") {
      throw new Error(moduleName + "." + methodName + " 未加载");
    }
    return moduleRef[methodName].bind(moduleRef);
  }

  function getEffectiveTemplateByName(name, delivery) {
    var template;
    if (window.IDPhotoTemplates && window.IDPhotoTemplates.forDelivery) {
      template = window.IDPhotoTemplates.getTemplateByName(name);
      if (!template) return null;
      template = window.IDPhotoTemplates.forDelivery(template, Boolean(delivery));
      return window.IDPhotoTemplateOverrideService ?
        window.IDPhotoTemplateOverrideService.getEffectiveTemplate(template) : template;
    }
    if (
      window.IDPhotoTemplateOverrideService &&
      typeof window.IDPhotoTemplateOverrideService.getEffectiveTemplateByName === "function"
    ) {
      return window.IDPhotoTemplateOverrideService.getEffectiveTemplateByName(name);
    }
    if (!window.IDPhotoTemplates || typeof window.IDPhotoTemplates.getTemplateByName !== "function") {
      return null;
    }
    template = window.IDPhotoTemplates.getTemplateByName(name);
    return template ? JSON.parse(JSON.stringify(template)) : null;
  }

  function create(options) {
    options = options || {};
    var onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    var onStep = typeof options.onStep === "function" ? options.onStep : function () {};
    var onError = typeof options.onError === "function" ? options.onError : function () {};

    function status(message) {
      onStatus(message);
    }

    function step(name, message, payload) {
      onStep(name, message, payload);
    }

    function reportError(name, error) {
      onError(name, error);
    }

    function templateLabel(template) {
      return (template && (template.shortName || template.name)) || "未知模板";
    }

    function getCropStrategyLabel(strategy) {
      if (window.IDPhotoCropStrategyStore && typeof window.IDPhotoCropStrategyStore.getLabel === "function") {
        return window.IDPhotoCropStrategyStore.getLabel(strategy);
      }
      return strategy || "默认裁切";
    }

    function getDocumentName(template) {
      var label = template.documentLabel || template.shortName || template.name;
      if (window.IDPhotoDateService && typeof window.IDPhotoDateService.makeDocumentName === "function") {
        return window.IDPhotoDateService.makeDocumentName(label);
      }
      return "证件照排版_" + label;
    }

    function getSettings() {
      if (window.IDPhotoSettingsStore && typeof window.IDPhotoSettingsStore.load === "function") {
        return window.IDPhotoSettingsStore.load();
      }
      return {};
    }

    async function closeProcessedDocument(processResult, reason, documentToReactivate) {
      var documentService = window.IDPhotoDocumentService;
      if (!processResult || !processResult.document || !documentService || !documentService.closeWithoutSaving) {
        return;
      }
      try {
        if (
          documentToReactivate &&
          (processResult.document === documentToReactivate ||
            (processResult.document.id !== undefined &&
              processResult.document.id !== null &&
              processResult.document.id === documentToReactivate.id))
        ) {
          step("cleanup", "skipped stale processed document reference", { reason: reason || "" });
          processResult.document = null;
          if (typeof documentToReactivate.activate === "function") {
            await documentToReactivate.activate();
          }
          return;
        }
        if (
          processResult.compositeTemporaryLayer &&
          documentService.cleanupTempSourceLayer &&
          processResult.compositeLayer
        ) {
          await documentService.cleanupTempSourceLayer(processResult.document, processResult.compositeLayer);
        }
        await documentService.closeWithoutSaving(processResult.document);
        step("cleanup", "closed temporary processed document", { reason: reason || "" });
        processResult.document = null;
        if (documentToReactivate && typeof documentToReactivate.activate === "function") {
          await documentToReactivate.activate();
        }
      } catch (error) {
        reportError("cleanup", error);
      }
    }

    async function closeTargetDocument(targetDocument, reason) {
      var documentService = window.IDPhotoDocumentService;
      if (!targetDocument || !documentService || !documentService.closeWithoutSaving) {
        return;
      }
      try {
        await documentService.closeWithoutSaving(targetDocument);
        step("cleanup", "closed incomplete layout document", { reason: reason || "" });
      } catch (error) {
        reportError("cleanup-target", error);
      }
    }

    async function closePrintedTargetDocument(targetDocument) {
      var documentService = window.IDPhotoDocumentService;
      if (!targetDocument || !documentService || !documentService.closeWithoutSaving) {
        return {
          ok: false,
          closed: false,
          message: "打印任务已提交，但拼版文档无法自动关闭"
        };
      }
      try {
        await documentService.closeWithoutSaving(targetDocument);
        step("cleanup", "closed printed layout document without saving");
        return {
          ok: true,
          closed: true,
          message: "打印任务已提交，拼版文档已不保存关闭"
        };
      } catch (error) {
        reportError("cleanup-printed-target", error);
        return {
          ok: false,
          closed: false,
          error: errorToText(error),
          message: "打印任务已提交，但拼版文档自动关闭失败：" + errorToText(error)
        };
      }
    }

    async function renderInfoBar(targetDocument, layoutPlan, template, docInfo, runOptions) {
      var decision;
      var dateText = "";
      if (runOptions.forceBlankInfoBar) return { ok: true, createdCount: 0, skipped: true, message: "原片身份不明，信息条留白" };
      if (!layoutPlan.infoBar) {
        return {
          ok: true,
          createdCount: 0,
          message: template.name + " 不需要信息条"
        };
      }
      if (
        window.IDPhotoSourceEligibilityService &&
        typeof window.IDPhotoSourceEligibilityService.getInfoBarDecision === "function"
      ) {
        decision = window.IDPhotoSourceEligibilityService.getInfoBarDecision(
          docInfo && docInfo.sourceMetadata ? docInfo.sourceMetadata : null,
          docInfo && docInfo.name ? docInfo.name : ""
        );
        if (decision.leaveBlank && !runOptions.historicalDelivery && !runOptions.resumeDeliveryTask) {
          if (runOptions.delivery) throw window.IDPhotoDeliveryProtocol.pickupCodeError("当前照片的信息条不可用，已停止取件码模式输出。");
          return {
            ok: true,
            createdCount: 0,
            skipped: true,
            sourceNotOwned: true,
            eligibilityReason: decision.reason,
            message: "本次仅排版，信息条区域留白"
          };
        }
      }
      if (window.IDPhotoDateService && typeof window.IDPhotoDateService.formatDisplayDate === "function") {
        dateText = window.IDPhotoDateService.formatDisplayDate();
      }
      if (runOptions.historicalDelivery || runOptions.resumeDeliveryTask) dateText = runOptions.deliveryDateText || "";
      return await requireMethod("IDPhotoInfoBarRenderer", "renderInfoBar")(
        targetDocument,
        layoutPlan.infoBar,
        runOptions.deliverySettings || getSettings(),
        {
          dateText: dateText,
          pickupCodeMode: Boolean(runOptions.delivery),
          pickupCode: runOptions.pickupCode || "",
          entryLink: runOptions.entryLink || null,
          template: template,
          sourceDocument: targetDocument,
          sourceLayerName: template.name + "_照片_1",
          debugMode: Boolean(runOptions.debugMode)
        }
      );
    }

    async function placeLayout(processedDocument, targetDocument, template, runOptions) {
      var layoutPlan;
      var layerResult;

      if (!processedDocument) {
        throw new Error("处理后单张照片文档不可用");
      }
      if (!targetDocument) {
        throw new Error("6 寸目标画布对象不可用");
      }

      step("layout", "calculating layout", { template: template });
      status("步骤5：计算 " + template.name + " 拼版位置");
      layoutPlan = requireMethod("IDPhotoLayoutEngine", "createLayoutPlan")({
        template: template,
        rowGap: runOptions.rowGap,
        colGap: runOptions.colGap
      });
      if (!layoutPlan.positions || !layoutPlan.positions.length) {
        throw new Error(template.name + " 在 6 寸画布中没有可用排版位置，请检查模板尺寸和间距");
      }

      step("layout", "placing photo copies", layoutPlan);
      status("步骤6：复制照片到 6 寸画布");
      layerResult = await requireMethod("IDPhotoLayerService", "placePhotoCopies")(
        processedDocument,
        targetDocument,
        layoutPlan,
        template
      );
      return { layoutPlan: layoutPlan, layerResult: layerResult };
    }

    async function finishLayout(targetDocument, placed, template, docInfo, runOptions) {
      step("infobar", "rendering info bar", placed.layoutPlan.infoBar);
      status("步骤7：生成信息条");
      var infoResult = await renderInfoBar(targetDocument, placed.layoutPlan, template, docInfo, runOptions);
      step("infobar", "done");
      return {
        ok: true,
        layoutPlan: placed.layoutPlan,
        layerResult: placed.layerResult,
        infoResult: infoResult,
        message: template.name + " 拼版完成：" + placed.layerResult.placedCount + " 张 · " + infoResult.message
      };
    }

    // Archive and customer photos take the largest pixels of the size's shape group
    // (1寸 saves at 标准2寸 size); the printed sheet keeps the selected size.
    function saveTemplateFor(template) {
      var size = window.IDPhotoTemplates && typeof window.IDPhotoTemplates.getSaveSize === "function" ?
        window.IDPhotoTemplates.getSaveSize(template) : null;
      if (!size || (size.widthPx === template.widthPx && size.heightPx === template.heightPx)) return template;
      return Object.assign({}, template, { widthPx: size.widthPx, heightPx: size.heightPx,
        photoWidthPx: size.widthPx, photoHeightPx: size.heightPx });
    }

    function saveKey(template) {
      return template.widthPx + "x" + template.heightPx;
    }

    function exportEnabled(runOptions) {
      return !runOptions.skipExport && Boolean(runOptions.exportJpg || runOptions.tryExportSingle);
    }

    // Photos from other cameras are never archived, so they need no larger saved copy:
    // one Photoshop document fewer per sheet (user 10-20).
    function archivesSource(docInfo) {
      var eligibility = window.IDPhotoSourceEligibilityService;
      if (!eligibility || typeof eligibility.checkSource !== "function") return true;
      return eligibility.checkSource(docInfo && docInfo.sourceMetadata ? docInfo.sourceMetadata : null,
        docInfo && docInfo.name ? docInfo.name : "").eligible === true;
    }

    async function exportSingleJpg(processedDocument, template, docInfo, runOptions) {
      if (runOptions.skipExport || (!runOptions.exportJpg && !runOptions.tryExportSingle)) {
        return {
          ok: true,
          skipped: true,
          message: runOptions.skipExport ? "视觉验收不写入 JPG 或 NAS" : "导出单张 JPG 已关闭"
        };
      }
      return await requireMethod("IDPhotoExportService", "exportSingleJpg")(processedDocument, {
        template: template,
        docInfo: docInfo,
        nasArchive: Boolean(runOptions.nasArchive),
        deliveryTask: runOptions.deliveryTask,
        archiveIndexExecutor: runOptions.archiveIndexExecutor
      });
    }

    async function printLayout(targetDocument, runOptions, archiveOperations) {
      if (runOptions.skipPrint || !runOptions.quickPrint) {
        return {
          ok: true,
          skipped: true,
          message: runOptions.skipPrint ? "当前入口禁止快速打印" : "快速打印已关闭"
        };
      }
      return await requireMethod("IDPhotoPrintService", "printOneCopy")(targetDocument,
        archiveOperations ? { archiveOperations: archiveOperations } : {});
    }

    // The larger saved copy (if any) and the layout copy; the original is never touched.
    async function closeWorkingCopies(processResult, reason, documentToReactivate) {
      var documentService = window.IDPhotoDocumentService;
      if (processResult && processResult.saveDocument && processResult.document && documentService &&
          typeof documentService.closeManyWithoutSaving === "function" &&
          !sameDocument(processResult.document, documentToReactivate) && !sameDocument(processResult.saveDocument, documentToReactivate)) {
        try {
          await documentService.closeManyWithoutSaving([processResult.saveDocument, processResult.document]);
          processResult.saveDocument = null;
          processResult.document = null;
          step("cleanup", "closed temporary processed documents", { reason: reason || "", count: 2 });
          if (documentToReactivate && typeof documentToReactivate.activate === "function") await documentToReactivate.activate();
          return;
        } catch (error) {
          // Whatever is still open goes through the one-by-one path below.
          var closed = error && error.closedDocuments || [];
          if (closed.indexOf(processResult.saveDocument) !== -1) processResult.saveDocument = null;
          if (closed.indexOf(processResult.document) !== -1) processResult.document = null;
          reportError("cleanup", error);
        }
      }
      if (processResult && processResult.saveDocument) {
        await closeProcessedDocument({ document: processResult.saveDocument }, reason + " (saved size)");
        processResult.saveDocument = null;
      }
      await closeProcessedDocument(processResult, reason, documentToReactivate);
    }

    function markDeliveryFailure(deliveryTask, error) {
      if (deliveryTask && deliveryTask.automation && !deliveryTask.completionWritten)
        window.IDPhotoDeliveryAutomationService.failure(deliveryTask, error);
    }

    async function runOne(templateName, sourceDocument, docInfo, runOptions, index, total) {
      var template = runOptions.resumeDeliveryTask ? JSON.parse(JSON.stringify(runOptions.resumeDeliveryTask.template)) : getEffectiveTemplateByName(templateName, runOptions.delivery);
      var ratioResult;
      var processResult;
      var canvasResult;
      var targetDocument;
      var placed;
      var layoutResult;
      var printResult;
      var exportResult;
      var closeAfterPrintResult;
      var deliveryTask = null;
      var deliveryResult = { requested: Boolean(runOptions.delivery), message: "本次未启用电子交付" };
      var codePromise = null;
      var earlyPrint = false;

      if (!template) {
        throw new Error("模板注册表中未找到：" + templateName);
      }
      var saveTemplate = saveTemplateFor(template);
      var shared = runOptions.sharedDelivery || null;
      // Multi-size: a size whose saved photo this customer already received prints with the shared code only.
      var sharedOnly = Boolean(runOptions.delivery && shared && shared.code && shared.keys[saveKey(saveTemplate)]);
      if (runOptions.delivery && !sharedOnly) {
        try {
          if (!template.infoBar || template.infoBar.enabled === false || template.infoBar.position === "none") {
            throw new Error("当前模板缺少可用信息条，请选择带取件码信息条的模板。");
          }
          deliveryTask = runOptions.resumeDeliveryTask ||
            await requireMethod("IDPhotoDeliveryService", "begin")(docInfo, "print", template, getSettings(), runOptions.deliveryIntent, runOptions);
          if (!deliveryTask) throw new Error("未创建有效的交付任务。");
          runOptions.activeDeliveryTask = deliveryTask;
          runOptions.historicalDelivery = deliveryTask.historical === true;
          runOptions.deliveryDateText = deliveryTask.dateText || "";
          runOptions.deliverySettings = deliveryTask.settings;
        } catch (deliveryError) {
          throw window.IDPhotoDeliveryProtocol.pickupCodeError(deliveryError);
        }
      }

      checkCancel(runOptions.cancelRequest);
      step("ratio", "checking", { document: docInfo, template: template });
      status("步骤2：比例检测 " + index + "/" + total + " · " + templateLabel(template));
      ratioResult = requireMethod("IDPhotoRatioChecker", "checkDocumentRatio")(docInfo, template);
      if (!ratioResult || !ratioResult.canCheck) {
        throw new Error(ratioResult && ratioResult.message ? ratioResult.message : "比例检测未返回有效结果");
      }

      checkCancel(runOptions.cancelRequest);
      step("crop", "preparing single photo", {
        document: docInfo,
        template: template,
        ratio: ratioResult,
        strategy: runOptions.cropStrategy
      });
      status("步骤3：" + templateLabel(template) + " 裁剪与扩图策略：" + getCropStrategyLabel(runOptions.cropStrategy));
      var needsSaveCopy = !sharedOnly && saveTemplate !== template &&
        (Boolean(deliveryTask) || (exportEnabled(runOptions) && archivesSource(docInfo)));
      processResult = await requireMethod("IDPhotoCropService", "prepareSinglePhoto")(
        sourceDocument,
        docInfo,
        template,
        ratioResult,
        { strategy: runOptions.cropStrategy, keepHighResolution: false,
          saveSize: needsSaveCopy ? { widthPx: saveTemplate.widthPx, heightPx: saveTemplate.heightPx } : null }
      );
      if (!processResult || !processResult.document || sameDocument(processResult.document, sourceDocument)) {
        throw new Error("处理后单张不是独立文档，已停止以保护原片");
      }
      var saveDocument = processResult.saveDocument || processResult.document;
      runOptions.pickupCode = sharedOnly ? shared.code : "";
      // The per-order mini-program link, bound to the code it was made for (10-28).
      runOptions.entryLink = sharedOnly ? shared.entryLink || null : null;
      if (deliveryTask) {
        try {
          if (runOptions.resumeDeliveryTask) {
            runOptions.pickupCode = window.IDPhotoDeliveryProtocol.requirePickupCode(deliveryTask.code);
            runOptions.entryLink = deliveryTask.entryLink || null;
          } else {
            var photo = await requireMethod("IDPhotoDeliveryService", "savePhoto")(deliveryTask, saveDocument);
            // No modal scope while the delivery manager answers: the sheet is built meanwhile.
            codePromise = requireMethod("IDPhotoDeliveryService", "requestCode")(deliveryTask, photo);
            codePromise.catch(function () {});
          }
        } catch (deliveryError) {
          markDeliveryFailure(deliveryTask, deliveryError);
          await closeWorkingCopies(processResult, "pickup code blocked");
          throw window.IDPhotoDeliveryProtocol.pickupCodeError(deliveryError);
        } finally {
          if (processResult.highResolutionDocument && !sameDocument(processResult.highResolutionDocument, sourceDocument)) {
            await closeProcessedDocument({ document: processResult.highResolutionDocument }, "delivery high-resolution copy");
          }
          processResult.highResolutionDocument = null;
        }
      }

      try {
        try {
          checkCancel(runOptions.cancelRequest);
          step("canvas", "creating 3600x2400 600ppi document");
          status("步骤4：" + templateLabel(template) + " 创建 3600x2400px / 600ppi 6 寸拼版画布");
          canvasResult = await requireMethod("IDPhotoCanvasService", "createSixInchCanvas")(getDocumentName(template));
          targetDocument = canvasResult && canvasResult.document;
          if (!targetDocument) {
            throw new Error("创建画布后未返回新文档对象");
          }
          if (sameDocument(targetDocument, sourceDocument) || sameDocument(targetDocument, processResult.document)) {
            targetDocument = null;
            throw new Error("创建画布返回了原片文档，已停止执行以避免覆盖原片");
          }
        } catch (canvasError) {
          canvasError.canvasStage = true;
          throw canvasError;
        }
        checkCancel(runOptions.cancelRequest);
        placed = await placeLayout(processResult.document, targetDocument, template, runOptions);
      } catch (layoutError) {
        if (codePromise) {
          // A started code request finishes before the copies close; the task then waits for recovery.
          try { await codePromise; } catch (codeError) { markDeliveryFailure(deliveryTask, codeError); }
        }
        if (!layoutError.canvasStage) await closeTargetDocument(targetDocument, "layout failed");
        targetDocument = null;
        await closeWorkingCopies(processResult, layoutError.canvasStage ? "canvas failed" : "layout failed");
        throw layoutError;
      }

      if (deliveryTask) {
        try {
          if (codePromise) {
            try {
              runOptions.pickupCode = await codePromise;
              runOptions.entryLink = deliveryTask.entryLink || null;
              window.IDPhotoDeliveryProtocol.requirePickupCode(runOptions.pickupCode);
            } catch (codeError) {
              var preparing = codeError && (codeError.code === "AUTO_TARGET_PREPARING" || codeError.causeCode === "AUTO_TARGET_PREPARING");
              if (!(preparing && shared && shared.code)) throw codeError;
              // The customer's first photo is still uploading: this size prints now with the
              // shared code and its photo joins the same delivery in the background.
              markDeliveryFailure(deliveryTask, codeError);
              await requireMethod("IDPhotoDeliveryService", "markEarlyPrint")(deliveryTask, shared.code);
              runOptions.pickupCode = shared.code;
              runOptions.entryLink = shared.entryLink || null;
              earlyPrint = true;
            }
          }
          if (!earlyPrint) {
            await requireMethod("IDPhotoDeliveryService", "startOutput")(deliveryTask);
            deliveryResult = { requested: true, ok: true, taskId: deliveryTask.id, message: "取件码 " + runOptions.pickupCode + "，照片准备中" };
            if (shared && shared.code && shared.code !== runOptions.pickupCode)
              deliveryResult.message += "；注意：这个尺寸的取件码和前面的不一样";
          } else {
            deliveryResult = { requested: true, ok: true, taskId: deliveryTask.id, earlyPrint: true,
              message: "取件码 " + runOptions.pickupCode + "，这个尺寸的电子版稍后自动补上" };
          }
        } catch (deliveryError) {
          markDeliveryFailure(deliveryTask, deliveryError);
          await closeTargetDocument(targetDocument, "pickup code blocked");
          await closeWorkingCopies(processResult, "pickup code blocked");
          throw window.IDPhotoDeliveryProtocol.pickupCodeError(deliveryError);
        }
      } else if (sharedOnly) {
        deliveryResult = { requested: true, ok: true, shared: true, message: "沿用取件码 " + runOptions.pickupCode };
      }

      try {
        checkCancel(runOptions.cancelRequest);
        layoutResult = await finishLayout(targetDocument, placed, template, docInfo, runOptions);
      } catch (layoutError) {
        await closeTargetDocument(targetDocument, "layout failed");
        targetDocument = null;
        await closeWorkingCopies(processResult, "layout failed");
        // Nothing was saved or printed yet: release the task so the background redoes it.
        if (deliveryTask && !earlyPrint && !isCancellation(layoutError)) {
          try {
            if (await requireMethod("IDPhotoDeliveryService", "abortOutput")(deliveryTask, layoutError)) layoutError.autoRedo = true;
          } catch (abortError) { reportError("delivery-abort", abortError); }
        }
        throw layoutError;
      }
      if (deliveryTask && deliveryTask.fingerprint && !earlyPrint) {
        try {
          await requireMethod("IDPhotoDeliveryService", "verifyOutput")(deliveryTask, runOptions.pickupCode);
        } catch (changedDelivery) {
          await closeTargetDocument(targetDocument, "pickup code changed");
          await closeWorkingCopies(processResult, "pickup code changed");
          throw window.IDPhotoDeliveryProtocol.pickupCodeError(changedDelivery);
        }
        try {
          var deliveryStatus = await requireMethod("IDPhotoDeliveryService", "complete")(deliveryTask, targetDocument, layoutResult.layoutPlan.infoBar);
          step("delivery", "layout and info saved");
          deliveryResult.message += "；" + deliveryStatus.message + (deliveryStatus.info === "failed" ? "；信息条图片待重试" : "；信息条图片已保存");
        } catch (completionError) {
          deliveryResult.ok = false;
          deliveryResult.message += (deliveryTask.completionWritten ? "；处理完成信号已保存，后续状态未能记录：" : "；处理完成信号未提交：") + errorToText(completionError);
        }
      }

      var printAttempted = false;
      async function submitPrint(archiveOperations) {
        printAttempted = true;
        try {
          if (deliveryTask && !earlyPrint && runOptions.quickPrint && !runOptions.skipPrint)
            await requireMethod("IDPhotoDeliveryService", "verifyOutput")(deliveryTask, runOptions.pickupCode);
          printResult = await printLayout(targetDocument, runOptions, archiveOperations);
          // A background "已补好，可以打印" for this code and size is now done (10-18).
          if (printResult && printResult.printed === true && runOptions.pickupCode && window.IDPhotoDeliveryService &&
              typeof window.IDPhotoDeliveryService.notePrinted === "function")
            window.IDPhotoDeliveryService.notePrinted(runOptions.pickupCode, template.id);
        } catch (printError) {
          reportError("print", printError);
          printResult = { ok: false, cancelled: isCancellation(printError), error: errorToText(printError),
            message: "快速打印失败：" + errorToText(printError) };
        }
      }
      var exportOptions = Object.assign({}, runOptions);
      exportOptions.deliveryTask = deliveryTask;
      if (runOptions.quickPrint && !runOptions.skipPrint) {
        // The archive records and index travel with the print: one bridge launch, one prompt.
        exportOptions.archiveIndexExecutor = async function (archiveOperations) {
          if (printAttempted) throw new Error("本次打印已提交，拒绝重复启动");
          await submitPrint(archiveOperations);
          var batch = printResult && printResult.archiveBatch;
          if (!batch || batch.ok !== true) {
            throw new Error(batch && batch.message ? batch.message :
              "打印桥未确认存档已保存并隐藏" + (printResult && printResult.message ? "：" + printResult.message : ""));
          }
        };
      }
      try {
        try {
          status("步骤8：单张 JPG 导出检查");
          if (sharedOnly || earlyPrint) {
            exportResult = { ok: true, skipped: true, message: sharedOnly ? "同一顾客这张照片已存过" : "电子版补上后再存档" };
          } else {
            exportResult = await exportSingleJpg(saveDocument, saveTemplate, docInfo, exportOptions);
          }
          step("export", "done", exportResult);
        } catch (exportError) {
          reportError("export", exportError);
          if (isCancellation(exportError)) throw exportError;
          exportResult = { ok: false, error: errorToText(exportError), message: "导出 JPG 失败：" + errorToText(exportError) };
        }
        status("步骤9：DS-RX1 快速打印检查");
        if (!printAttempted) await submitPrint();
        if (printResult && printResult.cancelled) {
          var printCancellation = new Error("用户已取消打印准备");
          printCancellation.cancelled = true;
          throw printCancellation;
        }
        step("print", "done", printResult);
      } finally {
        await closeWorkingCopies(processResult, "execute finished", targetDocument);
      }

      if (shared && runOptions.delivery) {
        if (!shared.code && runOptions.pickupCode) { shared.code = runOptions.pickupCode; shared.entryLink = runOptions.entryLink || null; }
        shared.keys[saveKey(saveTemplate)] = true;
      }

      closeAfterPrintResult = {
        ok: true,
        skipped: true,
        closed: false,
        message: "未启用打印成功后自动关闭"
      };
      if (runOptions.closeAfterPrint && printResult && printResult.printed === true) {
        closeAfterPrintResult = await closePrintedTargetDocument(targetDocument);
        if (closeAfterPrintResult.closed) {
          targetDocument = null;
        }
      }

      return {
        ok: true,
        templateName: templateName,
        targetDocument: targetDocument,
        layoutPlan: layoutResult.layoutPlan,
        layerResult: layoutResult.layerResult,
        infoResult: layoutResult.infoResult,
        printResult: printResult,
        exportResult: exportResult,
        deliveryResult: deliveryResult,
        closeAfterPrintResult: closeAfterPrintResult,
        message: layoutResult.message
      };
    }

    async function run(runOptions) {
      var templateNames;
      var successes = [];
      var failures = [];
      var successResults = [];
      var index;
      var singleResult;
      var cancelled = false;

      runOptions = Object.assign(
        {
          templateNames: [],
          cropStrategy: "auto",
          exportJpg: false,
          nasArchive: false,
          tryExportSingle: false,
          skipExport: false,
          quickPrint: false,
          closeAfterPrint: false,
          skipPrint: false,
          debugMode: false,
          rowGap: 10,
          colGap: 10
        },
        runOptions || {}
      );
      templateNames = runOptions.templateNames.slice();
      var cancelRequest = { requested: false };
      runOptions.cancelRequest = cancelRequest;
      cancelRequests.push(cancelRequest);
      try {
      runOptions.historicalDelivery = false;
      runOptions.deliveryDateText = "";
      // Several sizes for one customer (user 10-17): each prints its own sheet, all with one code.
      runOptions.sharedDelivery = runOptions.delivery && !runOptions.resumeDeliveryTask && templateNames.length > 1 ?
        { code: "", keys: {} } : null;

      if (runOptions.sourceDocument && runOptions.docInfo && runOptions.docInfo.id != null &&
          runOptions.sourceDocument.id !== runOptions.docInfo.id) {
        throw new Error("读取原片后活动文档已改变，请重新执行排版");
      }
      // Freeze one identity before any template crops/resizes the original. The panel has
      // already read this original for a pickup run (and the operator may have picked its
      // background, 10-20); that reading is kept instead of being taken again.
      runOptions.docInfo = Object.assign({}, runOptions.docInfo, {
        sourceVariant: runOptions.resumeDeliveryTask ? runOptions.resumeDeliveryTask.docInfo.sourceVariant :
          runOptions.docInfo && runOptions.docInfo.sourceVariant || null });
      if (!runOptions.resumeDeliveryTask && !runOptions.docInfo.sourceVariant && !runOptions.skipExport && (runOptions.exportJpg || runOptions.tryExportSingle) &&
          window.IDPhotoVariantService && window.IDPhotoVariantService.analyzeDocument) {
        try {
          runOptions.docInfo.sourceVariant = await window.IDPhotoVariantService.analyzeDocument(runOptions.sourceDocument);
        } catch (analysisError) {
          reportError("source-analysis", analysisError);
          if (isCancellation(analysisError)) throw analysisError;
        }
      }

      for (index = 0; index < templateNames.length; index += 1) {
        runOptions.activeDeliveryTask = null;
        try {
          status("开始执行：" + templateNames[index] + " · 已完成：" + successes.length + "/" + templateNames.length);
          singleResult = await runOne(
            templateNames[index],
            runOptions.sourceDocument,
            runOptions.docInfo,
            runOptions,
            index + 1,
            templateNames.length
          );
          successes.push(templateNames[index]);
          successResults.push({ templateName: templateNames[index], result: singleResult });
        } catch (error) {
          failures.push({ templateName: templateNames[index], error: error });
          // A cancelled order is the staff's decision: the background must not redo it.
          if (isCancellation(error)) markDeliveryFailure(runOptions.activeDeliveryTask, error);
          reportError("execute " + templateNames[index], error);
          if (isCancellation(error)) {
            cancelled = true;
            break;
          }
          // Without its code a later size could start a second delivery: stop here.
          if (runOptions.delivery && error && error.code === "PICKUP_CODE_REQUIRED") {
            break;
          }
        }
      }

      return {
        ok: failures.length === 0,
        cancelled: cancelled,
        successes: successes,
        failures: failures,
        successResults: successResults,
        exportFailures: successResults.filter(function (entry) {
          return entry.result && entry.result.exportResult && entry.result.exportResult.ok === false;
        }),
        printFailures: successResults.filter(function (entry) {
          return entry.result && entry.result.printResult && entry.result.printResult.ok === false;
        }),
        printedResults: successResults.filter(function (entry) {
          return entry.result && entry.result.printResult && entry.result.printResult.printed === true;
        }),
        closedAfterPrintResults: successResults.filter(function (entry) {
          return entry.result && entry.result.closeAfterPrintResult && entry.result.closeAfterPrintResult.closed === true;
        }),
        closeAfterPrintFailures: successResults.filter(function (entry) {
          return entry.result && entry.result.closeAfterPrintResult && entry.result.closeAfterPrintResult.ok === false;
        }),
        duplicateExports: successResults.filter(function (entry) {
          return entry.result && entry.result.exportResult && entry.result.exportResult.duplicateSource === true;
        }),
        replacedExports: successResults.filter(function (entry) {
          return entry.result && entry.result.exportResult && entry.result.exportResult.replacedSmaller === true;
        })
      };
      } finally {
        cancelRequests = cancelRequests.filter(function (request) { return request !== cancelRequest; });
      }
    }

    return {
      run: run
    };
  }

  window.IDPhotoLayoutWorkflow = {
    create: create,
    stopAll: stopAll
  };
})();
