(function () {
  "use strict";

  var EXPECTED_PRINTER_NAME = "DS-RX1";
  var EXPECTED_PAPER_NAME = "(6x4)";
  var EXPECTED_WIDTH_PX = 3600;
  var EXPECTED_HEIGHT_PX = 2400;
  var JOB_SCHEMA_VERSION = 1;
  var DEFAULT_TIMEOUT_MS = 30000;
  var DEFAULT_POLL_INTERVAL_MS = 250;

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
    if (typeof documentRef.activate === "function") {
      await documentRef.activate();
    }
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
      printed: false,
      blocked: true,
      reason: "bridge-invalid-result",
      message: "快速打印已阻止：" + message
    };
  }

  function getBridgeFailureMessage(reason, fallback) {
    var messages = {
      "printer-not-found": "快速打印已阻止：未找到名称精确为 DS-RX1 的打印机",
      "printer-invalid": "快速打印已阻止：DS-RX1 当前不可用",
      "paper-not-found": "快速打印已阻止：DS-RX1 驱动中未找到普通 (6x4) 纸张",
      "wrong-printer": "快速打印已阻止：作业目标不是 DS-RX1",
      "wrong-paper": "快速打印已阻止：作业目标不是普通 (6x4) 纸张",
      "wrong-copies": "快速打印已阻止：作业份数不是一份",
      "wrong-image-size": "快速打印已阻止：打印临时图不是 3600x2400 像素"
    };
    return messages[reason] || fallback || "Windows 打印桥拒绝了本次任务";
  }

  function normalizeBridgeResult(result, jobId) {
    if (!result || result.schemaVersion !== JOB_SCHEMA_VERSION || result.jobId !== jobId) {
      return invalidResult("Windows 打印桥返回了无效结果");
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
      message: getBridgeFailureMessage(result.reason, result.message)
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
          return {
            result: invalidResult("Windows 打印桥结果不是有效 JSON"),
            resultFile: resultFile
          };
        }
        return {
          result: normalizeBridgeResult(parsed, jobId),
          resultFile: resultFile
        };
      }
      if (Date.now() >= deadline) {
        break;
      }
      await wait(pollIntervalMs);
    } while (Date.now() < deadline);

    return {
      result: {
        ok: false,
        printed: false,
        blocked: true,
        reason: "bridge-timeout",
        message: "快速打印已阻止：等待 Windows 打印桥返回结果超时，未自动重试"
      },
      resultFile: null
    };
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

      await exportLayoutJpeg(documentRef, imageFile);
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
          expectedHeightPx: EXPECTED_HEIGHT_PX
        },
        uxp.storage.formats
      );

      launchMessage = await uxp.shell.openPath(jobFile.nativePath);
      if (typeof launchMessage === "string" && launchMessage.trim()) {
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
      if (bridgeResponse.result.ok) {
        await safeDelete(bridgeResponse.resultFile);
        await safeDelete(jobFile);
        await safeDelete(imageFile);
      }
      return bridgeResponse.result;
    } catch (error) {
      return {
        ok: false,
        printed: false,
        blocked: true,
        reason: "bridge-error",
        message: "快速打印失败：" + (error && error.message ? error.message : String(error))
      };
    }
  }

  window.IDPhotoPrintService = {
    EXPECTED_PRINTER_NAME: EXPECTED_PRINTER_NAME,
    EXPECTED_PAPER_NAME: EXPECTED_PAPER_NAME,
    JOB_SCHEMA_VERSION: JOB_SCHEMA_VERSION,
    normalizeBridgeResult: normalizeBridgeResult,
    printOneCopy: printOneCopy
  };
})();
