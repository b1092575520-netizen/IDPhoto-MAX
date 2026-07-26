(function () {
  "use strict";

  var NAS_TOKEN_KEY = "idphoto-max-nas-folder-token";
  var NAS_LABEL_KEY = "idphoto-max-nas-folder-label";
  var selectedNasFolder = null;

  function getLocalFileSystem() {
    var uxp;
    if (typeof require !== "function") {
      throw new Error("当前环境无法访问 UXP storage API");
    }
    uxp = require("uxp");
    if (!uxp || !uxp.storage || !uxp.storage.localFileSystem) {
      throw new Error("当前 UXP 环境不支持 localFileSystem");
    }
    return uxp.storage.localFileSystem;
  }

  function readLocalStorage(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function writeLocalStorage(key, value) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, value);
        return true;
      }
    } catch (error) {
      console.warn("[export] failed to save NAS authorization state", error);
    }
    return false;
  }

  function removeLocalStorage(key) {
    try {
      if (window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("[export] failed to clear NAS authorization state", error);
    }
  }

  function describeFolder(folder) {
    return (folder && (folder.nativePath || folder.name)) || "已授权目录";
  }

  function readProfileNasLabel() {
    try {
      return window.IDPhotoSettingsProfile ? window.IDPhotoSettingsProfile.load().nas.label : "";
    } catch (error) {
      return "";
    }
  }

  function writeProfileNasLabel(label) {
    try {
      if (!window.IDPhotoSettingsProfile) {
        return false;
      }
      window.IDPhotoSettingsProfile.update("nas", { label: String(label || "") });
      return true;
    } catch (error) {
      console.warn("[export] failed to save NAS label in settings profile", error);
      return false;
    }
  }

  function getNasAuthorizationLabel() {
    return readProfileNasLabel() || readLocalStorage(NAS_LABEL_KEY) || (selectedNasFolder ? describeFolder(selectedNasFolder) : "");
  }

  function hasNasAuthorization() {
    return Boolean(selectedNasFolder || readLocalStorage(NAS_TOKEN_KEY));
  }

  function clearNasRootFolder() {
    selectedNasFolder = null;
    removeLocalStorage(NAS_TOKEN_KEY);
    removeLocalStorage(NAS_LABEL_KEY);
    writeProfileNasLabel("");
    return {
      ok: true,
      message: "已清除 NAS 目录授权"
    };
  }

  async function chooseNasRootFolder() {
    var fs = getLocalFileSystem();
    var folder;
    var persistent = false;
    var token;

    if (typeof fs.getFolder !== "function") {
      throw new Error("当前 UXP API 不支持选择 NAS 目录");
    }

    folder = await fs.getFolder();
    if (!folder) {
      throw new Error("未选择 NAS 或输出根目录");
    }

    selectedNasFolder = folder;
    removeLocalStorage(NAS_TOKEN_KEY);
    removeLocalStorage(NAS_LABEL_KEY);
    writeProfileNasLabel("");
    if (typeof fs.createPersistentToken === "function") {
      try {
        token = await fs.createPersistentToken(folder);
        persistent = writeLocalStorage(NAS_TOKEN_KEY, token);
        if (persistent) {
          persistent = writeProfileNasLabel(describeFolder(folder));
          if (!persistent) {
            removeLocalStorage(NAS_TOKEN_KEY);
          }
        }
      } catch (tokenSaveError) {
        removeLocalStorage(NAS_TOKEN_KEY);
        removeLocalStorage(NAS_LABEL_KEY);
        writeProfileNasLabel("");
        console.warn("[export] failed to save persistent folder token", tokenSaveError);
      }
    }

    return {
      folder: folder,
      picked: true,
      mode: "nas-picked",
      label: describeFolder(folder),
      persistent: persistent,
      message: (persistent ? "NAS 目录已授权：" : "NAS 目录仅本次会话可用：") + describeFolder(folder)
    };
  }

  async function getOrCreateChildFolder(parent, name) {
    try {
      return await parent.getEntry(name);
    } catch (error) {
      return await parent.createFolder(name);
    }
  }

  async function getDatedOutputFolder(rootFolder) {
    var folders;
    var yearFolder;
    var monthFolder;

    if (!window.IDPhotoPathService || !window.IDPhotoPathService.getDateFolders) {
      throw new Error("pathService 未加载，无法生成日期目录");
    }

    folders = window.IDPhotoPathService.getDateFolders();
    yearFolder = await getOrCreateChildFolder(rootFolder, folders.year);
    monthFolder = await getOrCreateChildFolder(yearFolder, folders.month);
    return await getOrCreateChildFolder(monthFolder, folders.day);
  }

  function addFileNumber(fileName, number) {
    var dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) {
      return fileName + "_" + number;
    }
    return fileName.slice(0, dotIndex) + "_" + number + fileName.slice(dotIndex);
  }

  async function createAvailableFile(folder, requestedName) {
    var candidateName = requestedName;
    var number = 2;

    while (true) {
      try {
        await folder.getEntry(candidateName);
        candidateName = addFileNumber(requestedName, number);
        number += 1;
      } catch (notFoundError) {
        return {
          file: await folder.createFile(candidateName, { overwrite: false }),
          fileName: candidateName
        };
      }
    }
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getAspectGroup(widthPx, heightPx) {
    widthPx = Number(widthPx);
    heightPx = Number(heightPx);
    if (!(widthPx > 0) || !(heightPx > 0)) {
      return null;
    }
    return Math.round((widthPx / heightPx) * 100);
  }

  function getPixelArea(widthPx, heightPx) {
    return Math.round(Number(widthPx) * Number(heightPx));
  }

  function getEncodedExportSize(fileName) {
    var match = String(fileName || "").match(/_(\d{3,5})x(\d{3,5})_/);
    if (!match) {
      return null;
    }
    return {
      widthPx: Number(match[1]),
      heightPx: Number(match[2])
    };
  }

  function getLegacyExportSize(fileName) {
    var templates;
    var templateToken;
    var index;

    if (!window.IDPhotoTemplates || !window.IDPhotoTemplates.getAllTemplates) {
      return null;
    }
    if (!window.IDPhotoPathService || !window.IDPhotoPathService.sanitizeFilePart) {
      return null;
    }

    templates = window.IDPhotoTemplates.getAllTemplates();
    for (index = 0; index < templates.length; index += 1) {
      templateToken = "_" + window.IDPhotoPathService.sanitizeFilePart(templates[index].name) + "_";
      if (String(fileName || "").indexOf(templateToken) >= 0) {
        return {
          widthPx: templates[index].widthPx,
          heightPx: templates[index].heightPx
        };
      }
    }
    return null;
  }

  function getExistingExportSize(fileName) {
    return getEncodedExportSize(fileName) || getLegacyExportSize(fileName);
  }

  async function findSourceGroupExports(folder, sourceName, aspectGroup) {
    var sourceKey;
    var pattern;
    var entries;
    var size;
    var matches = [];
    var index;

    if (!folder || typeof folder.getEntries !== "function") {
      return matches;
    }
    if (!window.IDPhotoPathService || !window.IDPhotoPathService.makeJpgSourceKey) {
      return matches;
    }

    sourceKey = window.IDPhotoPathService.makeJpgSourceKey(sourceName);
    if (!sourceKey) {
      return matches;
    }
    pattern = new RegExp("_" + escapeRegExp(sourceKey) + "(?:_\\d+)?\\.jpg$", "i");
    entries = await folder.getEntries();
    for (index = 0; index < entries.length; index += 1) {
      if (entries[index] && entries[index].name && pattern.test(entries[index].name)) {
        size = getExistingExportSize(entries[index].name);
        if (size && getAspectGroup(size.widthPx, size.heightPx) === aspectGroup) {
          matches.push({
            file: entries[index],
            widthPx: size.widthPx,
            heightPx: size.heightPx,
            area: getPixelArea(size.widthPx, size.heightPx)
          });
        }
      }
    }
    return matches;
  }

  function getLargestExport(candidates) {
    var largest = null;
    (candidates || []).forEach(function (candidate) {
      if (!largest || candidate.area > largest.area) {
        largest = candidate;
      }
    });
    return largest;
  }

  async function deleteCandidateFiles(candidates, keepFile) {
    var deletedCount = 0;
    var index;
    for (index = 0; index < candidates.length; index += 1) {
      if (candidates[index].file === keepFile) {
        continue;
      }
      try {
        await deleteCreatedFile(candidates[index].file);
        deletedCount += 1;
      } catch (cleanupError) {
        console.warn("[export] failed to remove duplicate JPG", cleanupError);
      }
    }
    return deletedCount;
  }

  async function deleteCreatedFile(file) {
    if (file && typeof file.delete === "function") {
      await file.delete();
      return;
    }
    throw new Error("当前 UXP API 不支持删除未完成的 JPG 文件");
  }

  async function getOutputRootFolder(nasArchive) {
    var fs = getLocalFileSystem();
    var token;
    var folder;

    if (!nasArchive) {
      return {
        folder: await fs.getDataFolder(),
        picked: false,
        mode: "plugin-data"
      };
    }

    if (selectedNasFolder) {
      return {
        folder: selectedNasFolder,
        picked: false,
        mode: "nas-session"
      };
    }

    token = readLocalStorage(NAS_TOKEN_KEY);
    if (token && typeof fs.getEntryForPersistentToken === "function") {
      try {
        folder = await fs.getEntryForPersistentToken(token);
        selectedNasFolder = folder;
        writeLocalStorage(NAS_LABEL_KEY, describeFolder(folder));
        return {
          folder: folder,
          picked: false,
          mode: "nas-token"
        };
      } catch (tokenError) {
        clearNasRootFolder();
      }
    }

    return await chooseNasRootFolder();
  }

  async function saveDocumentAsJpg(documentRef, file) {
    await window.IDPhotoPhotoshopExecution.executeAsModal(
      async function () {
        if (documentRef && documentRef.saveAs && typeof documentRef.saveAs.jpg === "function") {
          await documentRef.saveAs.jpg(file, { quality: 12 }, true);
          return;
        }
        throw new Error("当前 Photoshop DOM 不支持 saveAs.jpg");
      },
      "导出单张 JPG"
    );
  }

  async function exportSingleJpg(processedDocument, options) {
    var template = options.template;
    var docInfo = options.docInfo || {};
    var nasArchive = Boolean(options.nasArchive);
    var rootResult;
    var dateFolder;
    var fileName;
    var file;
    var fileResult;
    var aspectGroup;
    var currentArea;
    var existingExports;
    var largestExisting;
    var replacedSmaller = false;
    var removedCount = 0;
    var eligibility;

    if (!processedDocument) {
      throw new Error("没有可导出的处理后单张照片");
    }
    if (!template || !(Number(template.widthPx) > 0) || !(Number(template.heightPx) > 0)) {
      throw new Error("当前模板缺少有效的单张像素尺寸");
    }

    if (window.IDPhotoSourceEligibilityService && window.IDPhotoSourceEligibilityService.checkSource) {
      eligibility = window.IDPhotoSourceEligibilityService.checkSource(docInfo.sourceMetadata || null);
      if (!eligibility.eligible) {
        return {
          ok: true,
          skipped: true,
          sourceNotOwned: true,
          eligibilityReason: eligibility.reason,
          message: eligibility.message
        };
      }
    }

    if (!window.IDPhotoPathService || !window.IDPhotoPathService.makeJpgFileName) {
      throw new Error("pathService 未加载，无法生成 JPG 文件名");
    }

    rootResult = await getOutputRootFolder(nasArchive);
    dateFolder = await getDatedOutputFolder(rootResult.folder);
    aspectGroup = getAspectGroup(template.widthPx, template.heightPx);
    currentArea = getPixelArea(template.widthPx, template.heightPx);
    existingExports = await findSourceGroupExports(dateFolder, docInfo.name, aspectGroup);
    largestExisting = getLargestExport(existingExports);
    if (largestExisting && largestExisting.area >= currentArea) {
      removedCount = await deleteCandidateFiles(existingExports, largestExisting.file);
      return {
        ok: true,
        skipped: true,
        duplicateSource: true,
        sameAspect: true,
        keptLargest: true,
        fileName: largestExisting.file.name,
        removedCount: removedCount,
        mode: rootResult.mode,
        picked: rootResult.picked,
        message: "同一原片近似比例已保留最大 JPG，跳过重复导出：" + largestExisting.file.name
      };
    }
    replacedSmaller = Boolean(largestExisting);
    fileName = window.IDPhotoPathService.makeJpgFileName(template.name, docInfo.name, template.widthPx, template.heightPx);
    fileResult = await createAvailableFile(dateFolder, fileName);
    file = fileResult.file;
    fileName = fileResult.fileName;
    try {
      await saveDocumentAsJpg(processedDocument, file);
    } catch (saveError) {
      try {
        await deleteCreatedFile(file);
      } catch (cleanupError) {
        console.warn("[export] failed to remove incomplete JPG", cleanupError);
      }
      throw saveError;
    }
    if (replacedSmaller) {
      removedCount = await deleteCandidateFiles(existingExports, null);
    }

    return {
      ok: true,
      fileName: fileName,
      aspectGroup: aspectGroup,
      replacedSmaller: replacedSmaller,
      removedCount: removedCount,
      mode: rootResult.mode,
      picked: rootResult.picked,
      message:
        "单张 JPG 已导出：" +
        fileName +
        (replacedSmaller ? " · 已替换同组较小 JPG" : "") +
        (nasArchive ? " · NAS 日期归档" : " · 插件数据目录测试输出") +
        (rootResult.picked ? " · 已选择输出根目录" : "")
    };
  }

  window.IDPhotoExportService = {
    exportSingleJpg: exportSingleJpg,
    chooseNasRootFolder: chooseNasRootFolder,
    clearNasRootFolder: clearNasRootFolder,
    getNasAuthorizationLabel: getNasAuthorizationLabel,
    hasNasAuthorization: hasNasAuthorization
  };
})();
