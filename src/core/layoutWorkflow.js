(function () {
  "use strict";

  function errorToText(error) {
    if (window.IDPhotoErrorService && window.IDPhotoErrorService.toText) {
      return window.IDPhotoErrorService.toText(error);
    }
    return error && error.message ? error.message : String(error || "未知错误");
  }

  function requireMethod(moduleName, methodName) {
    var moduleRef = window[moduleName];
    if (!moduleRef || typeof moduleRef[methodName] !== "function") {
      throw new Error(moduleName + "." + methodName + " 未加载");
    }
    return moduleRef[methodName].bind(moduleRef);
  }

  function getEffectiveTemplateByName(name) {
    var template;
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
          message: "打印已完成，但拼版文档无法自动关闭"
        };
      }
      try {
        await documentService.closeWithoutSaving(targetDocument);
        step("cleanup", "closed printed layout document without saving");
        return {
          ok: true,
          closed: true,
          message: "打印成功，拼版文档已不保存关闭"
        };
      } catch (error) {
        reportError("cleanup-printed-target", error);
        return {
          ok: false,
          closed: false,
          error: errorToText(error),
          message: "打印已完成，但拼版文档自动关闭失败：" + errorToText(error)
        };
      }
    }

    async function renderInfoBar(targetDocument, layoutPlan, template, docInfo, runOptions) {
      var decision;
      var dateText = "";
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
          docInfo && docInfo.sourceMetadata ? docInfo.sourceMetadata : null
        );
        if (decision.leaveBlank) {
          return {
            ok: true,
            createdCount: 0,
            skipped: true,
            sourceNotOwned: true,
            eligibilityReason: decision.reason,
            message: "非本店拍摄照片，信息条区域留白"
          };
        }
      }
      if (window.IDPhotoDateService && typeof window.IDPhotoDateService.formatDisplayDate === "function") {
        dateText = window.IDPhotoDateService.formatDisplayDate();
      }
      return await requireMethod("IDPhotoInfoBarRenderer", "renderInfoBar")(
        targetDocument,
        layoutPlan.infoBar,
        getSettings(),
        {
          dateText: dateText,
          template: template,
          sourceDocument: targetDocument,
          sourceLayerName: template.name + "_照片_1",
          debugMode: Boolean(runOptions.debugMode)
        }
      );
    }

    async function runTemplateLayout(processedDocument, targetDocument, template, docInfo, runOptions) {
      var layoutPlan;
      var layerResult;
      var infoResult;

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

      step("infobar", "rendering info bar", layoutPlan.infoBar);
      status("步骤7：生成信息条");
      infoResult = await renderInfoBar(targetDocument, layoutPlan, template, docInfo, runOptions);

      return {
        ok: true,
        layoutPlan: layoutPlan,
        layerResult: layerResult,
        infoResult: infoResult,
        message: template.name + " 拼版完成：" + layerResult.placedCount + " 张 · " + infoResult.message
      };
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
        nasArchive: Boolean(runOptions.nasArchive)
      });
    }

    async function printLayout(targetDocument, runOptions) {
      if (runOptions.skipPrint || !runOptions.quickPrint) {
        return {
          ok: true,
          skipped: true,
          message: runOptions.skipPrint ? "当前入口禁止快速打印" : "快速打印已关闭"
        };
      }
      return await requireMethod("IDPhotoPrintService", "printOneCopy")(targetDocument);
    }

    async function runOne(templateName, sourceDocument, docInfo, runOptions, index, total) {
      var template = getEffectiveTemplateByName(templateName);
      var ratioResult;
      var processResult;
      var canvasResult;
      var targetDocument;
      var layoutResult;
      var printResult;
      var exportResult;
      var closeAfterPrintResult;

      if (!template) {
        throw new Error("模板注册表中未找到：" + templateName);
      }

      step("ratio", "checking", { document: docInfo, template: template });
      status("步骤2：比例检测 " + index + "/" + total + " · " + templateLabel(template));
      ratioResult = requireMethod("IDPhotoRatioChecker", "checkDocumentRatio")(docInfo, template);
      if (!ratioResult || !ratioResult.canCheck) {
        throw new Error(ratioResult && ratioResult.message ? ratioResult.message : "比例检测未返回有效结果");
      }

      step("crop", "preparing single photo", {
        document: docInfo,
        template: template,
        ratio: ratioResult,
        strategy: runOptions.cropStrategy
      });
      status("步骤3：" + templateLabel(template) + " 裁剪与扩图策略：" + getCropStrategyLabel(runOptions.cropStrategy));
      processResult = await requireMethod("IDPhotoCropService", "prepareSinglePhoto")(
        sourceDocument,
        docInfo,
        template,
        ratioResult,
        { strategy: runOptions.cropStrategy }
      );

      try {
        step("canvas", "creating 3600x2400 600ppi document");
        status("步骤4：" + templateLabel(template) + " 创建 3600x2400px / 600ppi 6 寸拼版画布");
        canvasResult = await requireMethod("IDPhotoCanvasService", "createSixInchCanvas")(getDocumentName(template));
        targetDocument = canvasResult && canvasResult.document;
        if (!targetDocument) {
          throw new Error("创建画布后未返回新文档对象");
        }
        if (targetDocument === sourceDocument) {
          throw new Error("创建画布返回了原片文档，已停止执行以避免覆盖原片");
        }
      } catch (canvasError) {
        await closeProcessedDocument(processResult, "canvas failed");
        throw canvasError;
      }

      try {
        layoutResult = await runTemplateLayout(processResult.document, targetDocument, template, docInfo, runOptions);
      } catch (layoutError) {
        await closeTargetDocument(targetDocument, "layout failed");
        targetDocument = null;
        await closeProcessedDocument(processResult, "layout failed");
        throw layoutError;
      }

      try {
        status("步骤8：DS-RX1 快速打印检查");
        printResult = await printLayout(targetDocument, runOptions);
        step("print", "done", printResult);
      } catch (printError) {
        reportError("print", printError);
        printResult = {
          ok: false,
          error: errorToText(printError),
          message: "快速打印失败：" + errorToText(printError)
        };
      }

      try {
        status("步骤9：单张 JPG 导出检查");
        exportResult = await exportSingleJpg(processResult.document, template, docInfo, runOptions);
        step("export", "done", exportResult);
      } catch (exportError) {
        reportError("export", exportError);
        exportResult = {
          ok: false,
          error: errorToText(exportError),
          message: "导出 JPG 失败：" + errorToText(exportError)
        };
      } finally {
        await closeProcessedDocument(processResult, "execute finished", targetDocument);
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

      for (index = 0; index < templateNames.length; index += 1) {
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
          reportError("execute " + templateNames[index], error);
        }
      }

      return {
        ok: failures.length === 0,
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
    }

    return {
      run: run
    };
  }

  window.IDPhotoLayoutWorkflow = {
    create: create
  };
})();
