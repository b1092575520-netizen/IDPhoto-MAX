(function () {
  "use strict";

  var EXPECTED_PRINTER_NAME = "DS-RX1";
  var EXPECTED_PAPER_NAME = "(6x4)";
  var EXPECTED_WIDTH_PX = 3600;
  var EXPECTED_HEIGHT_PX = 2400;
  var JOB_SCHEMA_VERSION = 1;
  var DEFAULT_TIMEOUT_MS = 30000;
  var DEFAULT_POLL_INTERVAL_MS = 50;
  // Every job launches the bridge, so Photoshop's permission prompt shows each time: the
  // staff use "阻止" as a last chance to cancel a print (user 10-20). The bridge could stay
  // resident and take later jobs silently; jobs no longer ask it to.

  function getUxp() {
    var uxp;
    if (typeof require !== "function") {
      throw new Error("当前环境无法访问 UXP 打印桥接口");
    }
    uxp = require("uxp");
    if (
      !uxp ||
      !uxp.storage ||
      !uxp.storage.localFileSystem ||
      !uxp.shell ||
      typeof uxp.shell.openPath !== "function"
    ) {
      throw new Error("当前 UXP 环境不支持本地打印桥");
    }
    return uxp;
  }

  function getExecution() {
    if (!window.IDPhotoPhotoshopExecution) {
      throw new Error("photoshopExecution 未加载");
    }
    return window.IDPhotoPhotoshopExecution;
  }

  function makeJobId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  async function getOrCreateJobFolder(fileSystem) {
    var dataFolder = await fileSystem.getDataFolder();
    try {
      return await dataFolder.getEntry("print-jobs");
    } catch (error) {
      return await dataFolder.createFolder("print-jobs");
    }
  }

  async function writeJson(file, value, formats) {
    await file.write(JSON.stringify(value), formats && formats.utf8 ? { format: formats.utf8 } : undefined);
  }

  async function exportLayoutJpeg(documentRef, file) {
    await getExecution().executeAsModal(async function () {
      if (!documentRef.saveAs || typeof documentRef.saveAs.jpg !== "function") {
        throw new Error("当前 Photoshop DOM 不支持导出打印临时 JPG");
      }
      await documentRef.saveAs.jpg(file, { quality: 12 }, true);
    }, "导出 DS-RX1 打印临时图");
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function invalidResult(message) {
    return {
      ok: false,
      printed: null,
      blocked: false,
      outcomeUnknown: true,
      reason: "bridge-invalid-result",
      message: "打印结果无法确认：" + message + "；请先检查 DS-RX1 队列和出纸情况，勿直接重复打印"
    };
  }

  // Shown in the panel: Chinese only, and say plainly that nothing was printed.
  var PERMISSION_DENIED_MESSAGE = "没有打印：Photoshop 权限框点了“阻止”。要打印就重新排一次，在权限框里点“允许”；勾上“记住我的选择”以后就不再问";

  // "阻止" in the permission box means the staff do not want this now (10-18): remembered so
  // the background stops starting new work that would ask again.
  var lastDeniedAt = 0;
  function isPermissionDenied(error) {
    var text = error && error.message ? error.message : String(error || "");
    var denied = /denied|拒绝/i.test(text);
    if (denied) lastDeniedAt = Date.now();
    return denied;
  }

  function getBridgeFailureMessage(reason) {
    var messages = {
      "printer-not-found": "快速打印已阻止：未找到名称精确为 DS-RX1 的打印机",
      "printer-invalid": "快速打印已阻止：DS-RX1 当前不可用",
      "paper-not-found": "快速打印已阻止：DS-RX1 驱动中未找到普通 (6x4) 纸张",
      "paper-too-small": "快速打印已阻止：DS-RX1 纸张比 6 寸照片小",
      "wrong-printer": "快速打印已阻止：作业目标不是 DS-RX1",
      "wrong-paper": "快速打印已阻止：作业目标不是普通 (6x4) 纸张",
      "wrong-copies": "快速打印已阻止：作业份数不是一份",
      "wrong-image-size": "快速打印已阻止：打印临时图不是 3600x2400 像素",
      "image-not-found": "没有打印：打印用的临时图没生成出来，请重新排一次",
      "job-not-found": "没有打印：打印任务文件不见了，请重新排一次"
    };
    return messages[reason] || "没有打印：打印桥拒绝了这次任务（" + (reason || "原因不明") + "），请重新排一次";
  }

  function normalizeBridgeResult(result, jobId) {
    if (!result || result.schemaVersion !== JOB_SCHEMA_VERSION || result.jobId !== jobId) {
      return invalidResult("Windows 打印桥返回了无效结果");
    }
    if (result.outcomeUnknown === true) {
      return invalidResult(result.message || "打印桥未确认是否已提交");
    }
    if (result.ok === true) {
      if (
        result.printed !== true ||
        result.printerName !== EXPECTED_PRINTER_NAME ||
        result.paperName !== EXPECTED_PAPER_NAME ||
        result.copies !== 1
      ) {
        return invalidResult("打印桥未确认精确的打印机、纸张和份数");
      }
      return {
        ok: true,
        printed: true,
        printerName: EXPECTED_PRINTER_NAME,
        paperName: EXPECTED_PAPER_NAME,
        copies: 1,
        message: result.message || "已发送到 DS-RX1，以 (6x4) 打印一份"
      };
    }
    return {
      ok: false,
      printed: false,
      blocked: true,
      reason: result.reason || "bridge-rejected",
      message: getBridgeFailureMessage(result.reason)
    };
  }

  async function waitForBridgeResult(folder, resultName, jobId, timeoutMs, pollIntervalMs) {
    var deadline = Date.now() + timeoutMs;
    var resultFile;
    var parsed;

    do {
      try {
        resultFile = await folder.getEntry(resultName);
      } catch (error) {
        resultFile = null;
      }
      if (resultFile) {
        try {
          parsed = JSON.parse(await resultFile.read());
        } catch (error) {
          parsed = null;
        }
        if (parsed) {
          var normalized = normalizeBridgeResult(parsed, jobId);
          if (parsed.schemaVersion === JOB_SCHEMA_VERSION && parsed.jobId === jobId) {
            normalized.archiveIndexResult = parsed.archiveIndexResult;
          }
          return { result: normalized, resultFile: resultFile };
        }
      }
      if (Date.now() >= deadline) {
        break;
      }
      await wait(pollIntervalMs);
    } while (Date.now() < deadline);

    return {
      result: {
        ok: false,
        printed: null,
        blocked: false,
        outcomeUnknown: true,
        reason: "bridge-timeout",
        message: "等待打印结果超时，可能已进入 DS-RX1 队列；请先检查队列和出纸情况，勿直接重复打印"
      },
      resultFile: null
    };
  }

  async function deleteNamed(folder, names) {
    for (var name of names) {
      var entry = null;
      try { entry = await folder.getEntry(name); } catch (missing) { entry = null; }
      if (entry) await safeDelete(entry);
    }
  }

  // Photoshop has returned from saveAs without writing the file (10-17, 14:33).
  // Check before launching, so no permission prompt is spent on an empty job.
  async function hasWrittenImage(folder, file) {
    var written;
    try { written = await folder.getEntry(file.name); } catch (missing) { return false; }
    if (!written) return false;
    if (typeof written.getMetadata === "function") {
      try {
        var metadata = await written.getMetadata();
        if (metadata && Number.isFinite(metadata.size) && metadata.size <= 0) return false;
      } catch (unknown) { /* Size is optional evidence; the entry exists. */ }
    }
    return true;
  }

  async function safeDelete(entry) {
    try {
      if (entry && typeof entry.delete === "function") {
        await entry.delete();
      }
    } catch (error) {
      console.warn("[print] failed to clean completed bridge job", error);
    }
  }

  async function printOneCopy(documentRef, options) {
    var uxp;
    var fileSystem;
    var jobFolder;
    var jobId;
    var imageFile;
    var jobFile;
    var resultName;
    var launchMessage;
    var bridgeResponse;
    var timeoutMs;
    var pollIntervalMs;
    var launchAttempted = false;
    var completed = false;

    options = options || {};
    if (!documentRef) {
      return {
        ok: false,
        printed: false,
        blocked: true,
        reason: "missing-document",
        message: "快速打印已阻止：拼版文档不可用"
      };
    }

    try {
      uxp = getUxp();
      fileSystem = uxp.storage.localFileSystem;
      jobFolder = await getOrCreateJobFolder(fileSystem);
      jobId = makeJobId();
      imageFile = await jobFolder.createFile("idphoto-" + jobId + ".jpg", { overwrite: false });
      jobFile = await jobFolder.createFile("idphoto-" + jobId + ".idprint", { overwrite: false });
      resultName = "idphoto-" + jobId + ".result.json";

      var timing = { start: Date.now() };
      await exportLayoutJpeg(documentRef, imageFile);
      timing.jpeg = Date.now();
      if (!await hasWrittenImage(jobFolder, imageFile)) {
        await exportLayoutJpeg(documentRef, imageFile);
        if (!await hasWrittenImage(jobFolder, imageFile)) {
          completed = true;
          return { ok: false, printed: false, blocked: true, reason: "image-not-found",
            message: getBridgeFailureMessage("image-not-found") };
        }
      }
      var archiveOperations = Array.isArray(options.archiveOperations) && options.archiveOperations.length ?
        options.archiveOperations.map(function (item) { return item.indexPath ? item : archiveRequest(item.file, item.operation); }) : undefined;
      await writeJson(
        jobFile,
        {
          schemaVersion: JOB_SCHEMA_VERSION,
          jobId: jobId,
          imagePath: imageFile.nativePath,
          printerName: EXPECTED_PRINTER_NAME,
          paperName: EXPECTED_PAPER_NAME,
          copies: 1,
          expectedWidthPx: EXPECTED_WIDTH_PX,
          expectedHeightPx: EXPECTED_HEIGHT_PX,
          archiveIndex: archiveOperations ? undefined : options.archiveIndex || undefined,
          archiveOperations: archiveOperations
        },
        uxp.storage.formats
      );

      launchAttempted = true;
      timing.job = Date.now();
      try {
        launchMessage = await uxp.shell.openPath(jobFile.nativePath);
        timing.launched = Date.now();
      } catch (launchError) {
        if (!isPermissionDenied(launchError)) throw launchError;
        // The bridge never started: nothing can be in the printer queue.
        completed = true;
        return {
          ok: false,
          printed: false,
          blocked: true,
          reason: "permission-denied",
          message: PERMISSION_DENIED_MESSAGE
        };
      }
      if (typeof launchMessage === "string" && launchMessage.trim()) {
        completed = true;
        return {
          ok: false,
          printed: false,
          blocked: true,
          reason: "bridge-launch-failed",
          message: "快速打印已阻止：Windows 打印桥无法启动，请重新运行一键安装程序。" + launchMessage
        };
      }

      timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
      pollIntervalMs = Number.isFinite(options.pollIntervalMs)
        ? Math.max(0, options.pollIntervalMs)
        : DEFAULT_POLL_INTERVAL_MS;
      bridgeResponse = await waitForBridgeResult(jobFolder, resultName, jobId, timeoutMs, pollIntervalMs);
      console.log("[print] timing ms: jpeg=" + (timing.jpeg - timing.start) + " job=" + (timing.job - timing.jpeg) +
        " launch=" + (timing.launched - timing.job) + " bridge=" + (Date.now() - timing.launched));
      if (archiveOperations) {
        try {
          checkArchiveBatch(bridgeResponse.result.archiveIndexResult, archiveOperations);
          bridgeResponse.result.archiveBatch = { ok: true };
        } catch (batchError) {
          bridgeResponse.result.archiveBatch = { ok: false, message: batchError.message };
        }
      }
      if (bridgeResponse.result.ok) {
        completed = true;
        await safeDelete(bridgeResponse.resultFile);
      }
      return bridgeResponse.result;
    } catch (error) {
      return {
        ok: false,
        printed: launchAttempted ? null : false,
        blocked: !launchAttempted,
        outcomeUnknown: launchAttempted,
        reason: "bridge-error",
        cancelled: Boolean(error && (error.cancelled === true || error.number === -128 || error.code === -128)),
        message: "快速打印失败：" + (error && error.message ? error.message : String(error)) +
          (launchAttempted ? "；请先检查 DS-RX1 队列和出纸情况，勿直接重复打印" : "")
      };
    } finally {
      if (!launchAttempted || completed) {
        await safeDelete(jobFile);
        await safeDelete(imageFile);
        if (jobFolder && jobId) await deleteNamed(jobFolder, ["idphoto-" + jobId + ".idprint.claim", "idphoto-" + jobId + ".idprint.submitted"]);
      }
    }
  }

  var ARCHIVE_RECORD = /^\.idphoto-(?:output-[a-f0-9]{32}|archive(?:-(?:retired-)?[a-f0-9]{32}|-root|-sync)?)\.json$/;
  var STAGED_ARCHIVE_RECORD = /^\.idphoto-(?:output-[a-f0-9]{32}|archive(?:-(?:retired-)?[a-f0-9]{32}|-root|-sync)?)\.json\.[a-f0-9]{32}\.tmp$/;

  function archiveRequest(file, operation) {
    var validName = file && (operation === "commit-archive-record" ? STAGED_ARCHIVE_RECORD.test(file.name)
      : operation === "hide-archive-record" ? ARCHIVE_RECORD.test(file.name)
      : operation === "commit-archive-index"
        ? /^\.idphoto-jpg-index\.json\.[a-z0-9]+-[a-z0-9.]+\.tmp$/.test(file.name)
        : operation === "hide-archive-index" && file.name === ".idphoto-jpg-index.json");
    if (!validName || !file.nativePath) {
      throw new Error("无效的存档索引路径");
    }
    return { operation: operation, indexPath: file.nativePath };
  }

  // Reuse the installed Windows bridge; this job never exports or prints a photo.
  async function launchArchiveJob(fields, options, checkResult) {
    options = options || {};
    var uxp = getUxp();
    var folder = await getOrCreateJobFolder(uxp.storage.localFileSystem);
    var jobId = makeJobId();
    var jobFile = await folder.createFile("hide-" + jobId + ".idprint", { overwrite: false });
    var resultName = "hide-" + jobId + ".result.json";
    var resultFile;
    var completed = false;
    var launched = false;
    try {
      await writeJson(jobFile, Object.assign({ schemaVersion: JOB_SCHEMA_VERSION, jobId: jobId }, fields), uxp.storage.formats);
      launched = true;
      var launchError;
      try {
        launchError = await uxp.shell.openPath(jobFile.nativePath);
      } catch (openError) {
        if (!isPermissionDenied(openError)) throw openError;
        launched = false;
        throw new Error("Photoshop 权限框点了“阻止”，这次没存档");
      }
      if (launchError) throw new Error(String(launchError));
      var deadline = Date.now() + (options.timeoutMs || 5000);
      do {
        try { resultFile = await folder.getEntry(resultName); } catch (missing) { resultFile = null; }
        if (resultFile) {
          var result = JSON.parse(await resultFile.read());
          if (result.schemaVersion !== JOB_SCHEMA_VERSION || result.jobId !== jobId) {
            throw new Error("隐藏索引的回执不匹配");
          }
          completed = true;
          return checkResult(result);
        }
        await wait(100);
      } while (Date.now() < deadline);
      throw new Error("等待隐藏索引超时");
    } finally {
      if (!launched || completed) {
        await safeDelete(jobFile);
        await safeDelete(resultFile);
        await deleteNamed(folder, ["hide-" + jobId + ".idprint.claim"]);
      }
    }
  }

  async function archiveIndexOperation(file, operation, options) {
    var request = archiveRequest(file, operation);
    await launchArchiveJob(request, options, function (result) {
      if (result.ok !== true || result.hidden !== true || result.printed !== false || result.operation !== operation) {
        throw new Error("Windows 未确认索引已隐藏" + (result.message ? "：" + result.message : ""));
      }
    });
  }

  // Check a batch receipt from either an archive-only job or a print job.
  function checkArchiveBatch(result, requests) {
    var results = result && Array.isArray(result.results) ? result.results : [];
    if (!result || result.ok !== true || result.printed !== false || results.length !== requests.length ||
        results.some(function (item, index) { return !item || item.ok !== true || item.hidden !== true || item.operation !== requests[index].operation; })) {
      throw new Error("Windows 未确认存档记录已保存并隐藏" + (result && result.message ? "：" + result.message : ""));
    }
    return result;
  }

  // Several archive records and the index in one bridge launch: one prompt per save.
  async function runArchiveOperations(items, options) {
    var requests = (items || []).map(function (item) { return archiveRequest(item.file, item.operation); });
    if (!requests.length) return { ok: true, results: [] };
    return await launchArchiveJob({ operations: requests }, options, function (result) {
      return checkArchiveBatch(result, requests);
    });
  }

  window.IDPhotoPrintService = {
    lastDeniedAt: function () { return lastDeniedAt; },
    hideArchiveRecord: function (file, options) { return archiveIndexOperation(file, "hide-archive-record", options); },
    commitArchiveRecord: function (file, options) { return archiveIndexOperation(file, "commit-archive-record", options); },
    hideArchiveIndex: function (file, options) { return archiveIndexOperation(file, "hide-archive-index", options); },
    commitArchiveIndex: function (file, options) { return archiveIndexOperation(file, "commit-archive-index", options); },
    runArchiveOperations: runArchiveOperations,
    archiveRequest: archiveRequest,
    checkArchiveBatch: checkArchiveBatch,
    EXPECTED_PRINTER_NAME: EXPECTED_PRINTER_NAME,
    EXPECTED_PAPER_NAME: EXPECTED_PAPER_NAME,
    JOB_SCHEMA_VERSION: JOB_SCHEMA_VERSION,
    normalizeBridgeResult: normalizeBridgeResult,
    printOneCopy: printOneCopy
  };
})();
