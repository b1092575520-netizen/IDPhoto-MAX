(function () {
  "use strict";

  var NAS_TOKEN_KEY = "idphoto-max-nas-folder-token";
  var NAS_LABEL_KEY = "idphoto-max-nas-folder-label";
  var JPG_INDEX_NAME = ".idphoto-jpg-index.json";
  var MAX_ASPECT_RATIO_FACTOR = 1.05;
  var selectedNasFolder = null;
  var exportQueue = Promise.resolve();

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

  async function readSharedJpgIdentityIndex(folder) {
    var file;
    var parsed;
    var entries = await folder.getEntries();
    file = entries.find(function (entry) { return entry.name === JPG_INDEX_NAME; });
    if (!file) return {};
    try {
      parsed = JSON.parse(await file.read({ format: require("uxp").storage.formats.utf8 }));
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries)) {
        return parsed.entries;
      }
    } catch (error) {
      throw new Error("存档身份索引无法读取：" + error.message);
    }
    throw new Error("存档身份索引格式无效");
  }

  // Private durable records do not require launching the print bridge. The full path
  // is checked on reads so even a cache filename hash collision cannot join customers.
  async function getPrivateIndex(folder) {
    var directory = String(folder.nativePath || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (!directory) throw new Error("无法确认存档目录的完整路径");
    var hash = 2166136261;
    for (var i = 0; i < directory.length; i++) hash = Math.imul(hash ^ directory.charCodeAt(i), 16777619) >>> 0;
    var root = await getLocalFileSystem().getDataFolder();
    var cache;
    try { cache = await root.getEntry("archive-index-cache"); }
    catch (missing) { cache = await root.createFolder("archive-index-cache"); }
    return { folder: cache, name: hash.toString(16) + ".json", directory: directory };
  }

  async function readPrivateIndex(location) {
    var entries = await location.folder.getEntries();
    var file = entries.find(function (entry) { return entry.name === location.name; });
    if (!file) return null;
    var value = JSON.parse(await file.read({ format: require("uxp").storage.formats.utf8 }));
    if (!value || value.version !== 1 || value.directory !== location.directory || !value.entries ||
        typeof value.entries !== "object" || Array.isArray(value.entries)) throw new Error("内部去重记录无效或目录不匹配");
    return value.entries;
  }

  async function readJpgIdentityIndex(folder, strictManaged) {
    var local = await readPrivateIndex(await getPrivateIndex(folder));
    var shared;
    try { shared = await readSharedJpgIdentityIndex(folder); }
    catch (error) { if (!local) throw error; shared = {}; }
    if (strictManaged && local) {
      for (var name of Object.keys(shared)) {
        var a = shared[name], b = local[name];
        if (a && b && (a.archiveId || b.archiveId) &&
            (a.archiveId !== b.archiveId || a.deliveryTaskId !== b.deliveryTaskId ||
              a.identityMarker !== b.identityMarker || a.backgroundColor !== b.backgroundColor))
          throw new Error("共享与私有归档索引归属冲突，保留照片待核对");
      }
    }
    return Object.assign({}, shared, local || {});
  }

  async function writePrivateIndex(folder, index) {
    var location = await getPrivateIndex(folder);
    // Refuse to overwrite a record for a different archive directory.
    await readPrivateIndex(location);
    var pendingName = location.name + "." + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + ".tmp";
    var file = await location.folder.createFile(pendingName, { overwrite: false });
    try {
      await file.write(JSON.stringify({ version: 1, directory: location.directory, entries: index }), { format: require("uxp").storage.formats.utf8 });
      await file.moveTo(location.folder, { newName: location.name, overwrite: true });
    } finally {
      try { await (await location.folder.getEntry(pendingName)).delete(); } catch (missing) { /* committed or absent */ }
    }
  }

  async function writeJpgIdentityIndex(folder, index, indexExecutor) {
    var pendingName = JPG_INDEX_NAME + "." + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + ".tmp";
    var file = await folder.createFile(pendingName, { overwrite: false });
    try {
      await file.write(JSON.stringify({ version: 1, entries: index }), { format: require("uxp").storage.formats.utf8 });
      // UXP cannot overwrite a Hidden file on Windows. The native bridge commits and hides it atomically.
      if (indexExecutor) await indexExecutor(file, "commit-archive-index");
      else await window.IDPhotoPrintService.commitArchiveIndex(file);
    } finally {
      // Address only our staging name; the File object may now refer to the committed index.
      try { await (await folder.getEntry(pendingName)).delete(); } catch (cleanupError) { /* absent after move */ }
    }
  }

  function getIndexedVariant(fileName, index) {
    var entry = index && index[String(fileName || "")];
    var parsed;
    if (!entry || !window.IDPhotoVariantService || typeof window.IDPhotoVariantService.parseIdentityMarker !== "function") {
      return null;
    }
    parsed = window.IDPhotoVariantService.parseIdentityMarker(entry.identityMarker);
    if (!parsed) {
      return null;
    }
    parsed.identityMarker = String(entry.identityMarker).toLowerCase();
    parsed.backgroundColor = /^(red|blue|white|unknown)$/.test(entry.backgroundColor)
      ? entry.backgroundColor
      : "unknown";
    return parsed;
  }

  async function withHiddenIndex(result, folder, indexExecutor) {
    try {
      var file = await folder.getEntry(JPG_INDEX_NAME);
      if (indexExecutor) await indexExecutor(file, "hide-archive-index");
      else await window.IDPhotoPrintService.hideArchiveIndex(file);
    } catch (error) {
      // Visibility is auxiliary: never roll back a photo or a committed identity index.
      result.indexVisibilityWarning = true;
      result.message += " · 索引自动隐藏失败：" + (error && error.message ? error.message : String(error));
      console.warn("[export] archive index could not be hidden", error);
    }
    return result;
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

  function hasSimilarAspect(leftWidth, leftHeight, rightWidth, rightHeight) {
    var left = Number(leftWidth) / Number(leftHeight);
    var right = Number(rightWidth) / Number(rightHeight);
    return Number.isFinite(left) && Number.isFinite(right) && left > 0 && right > 0 &&
      Math.max(left, right) / Math.min(left, right) <= MAX_ASPECT_RATIO_FACTOR + 1e-12;
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

  function getVariantFromFileName(fileName, identityIndex) {
    var name = String(fileName || "");
    var modern = name.match(/_id-((?:u2)|(?:s2[io][a-f0-9]{2,156})|(?:v2[a-f0-9]{129}))_bg-(red|blue|white|unknown)_/i);
    var legacy = name.match(/_p([a-f0-9]{16})_bg-(red|blue|white|unknown)_/i);
    var backgroundOnly = name.match(/_bg-(red|blue|white|unknown)_/i);
    var short = name.match(/_(红|蓝|白|未知)_([a-z0-9]{6})(?:_\d+)?\.jpg$/i);
    var parsed;
    if (modern && window.IDPhotoVariantService && typeof window.IDPhotoVariantService.parseIdentityMarker === "function") {
      parsed = window.IDPhotoVariantService.parseIdentityMarker(modern[1]);
      if (parsed) {
        parsed.identityMarker = modern[1].toLowerCase();
        parsed.backgroundColor = modern[2].toLowerCase();
        return parsed;
      }
    }
    if (legacy) {
      return {
        legacyWeakFingerprint: legacy[1].toLowerCase(),
        backgroundColor: legacy[2].toLowerCase()
      };
    }
    if (short) {
      parsed = getIndexedVariant(name, identityIndex) || {
        shortToken: short[2].toUpperCase(),
        backgroundColor: { "红": "red", "蓝": "blue", "白": "white", "未知": "unknown" }[short[1]] || "unknown"
      };
      parsed.shortToken = short[2].toUpperCase();
      if (!parsed.backgroundColor) {
        parsed.backgroundColor = { "红": "red", "蓝": "blue", "白": "white", "未知": "unknown" }[short[1]] || "unknown";
      }
      return parsed;
    }
    return getIndexedVariant(name, identityIndex) || (backgroundOnly ? { backgroundColor: backgroundOnly[1].toLowerCase() } : null);
  }

  function belongsToBackgroundGroup(existingVariant, currentVariant) {
    if (!currentVariant) {
      return !existingVariant || existingVariant.backgroundColor === "unknown";
    }
    if (currentVariant.backgroundColor === "unknown") {
      return !existingVariant || existingVariant.backgroundColor === "unknown";
    }
    return Boolean(existingVariant && existingVariant.backgroundColor === currentVariant.backgroundColor);
  }

  function makeUnknownVariant(sourceName, stableSourceId) {
    var service = window.IDPhotoVariantService;
    if (!service || typeof service.makeSourceFingerprint !== "function") {
      return null;
    }
    var variant = {
      personFingerprint: service.makeSourceFingerprint(sourceName),
      backgroundColor: "unknown",
      stableSourceId: String(stableSourceId || "")
    };
    variant.identityMarker = typeof service.serializeIdentity === "function" ? service.serializeIdentity(variant) : "";
    variant.stableSourceMarker = /^s2/.test(variant.identityMarker) ? variant.identityMarker : "";
    variant.unverifiableStrongSourceId = variant.identityMarker === "u2";
    return variant;
  }

  function normalizeVariant(variant, sourceName, stableSourceId) {
    var service = window.IDPhotoVariantService;
    if (
      variant &&
      /^[a-f0-9]{16}$/i.test(String(variant.personFingerprint || "")) &&
      /^(red|blue|white|unknown)$/.test(String(variant.backgroundColor || ""))
    ) {
      variant = {
        personFingerprint: String(variant.personFingerprint).toLowerCase(),
        backgroundColor: String(variant.backgroundColor),
        visualSignature: variant.visualSignature || null,
        stableSourceId: String(stableSourceId || "")
      };
      variant.identityMarker = service && typeof service.serializeIdentity === "function" ? service.serializeIdentity(variant) : "";
      variant.stableSourceMarker = /^s2/.test(variant.identityMarker) ? variant.identityMarker : "";
      variant.unverifiableStrongSourceId = variant.identityMarker === "u2";
      return variant;
    }
    return makeUnknownVariant(sourceName, stableSourceId);
  }

  async function findSourceGroupExports(folder, template, variant, identityIndex) {
    var entries;
    var size;
    var existingVariant;
    var identityResult;
    var highConfidenceMatch;
    var matches = [];
    var index;

    if (!folder || typeof folder.getEntries !== "function") {
      return matches;
    }
    entries = await folder.getEntries();
    for (index = 0; index < entries.length; index += 1) {
      if (!(entries[index] && entries[index].isFile && /\.jpg$/i.test(entries[index].name))) {
        continue;
      }
      existingVariant = getVariantFromFileName(entries[index].name, identityIndex);
      identityResult = null;
      if (
        variant && existingVariant &&
        window.IDPhotoVariantService && typeof window.IDPhotoVariantService.compareIdentity === "function"
      ) {
        identityResult = window.IDPhotoVariantService.compareIdentity(variant, existingVariant);
      }
      highConfidenceMatch = Boolean(identityResult && (identityResult.kind === "stable-source" || identityResult.kind === "visual-high"));
      // A source filename or six-character hash is not evidence for deletion.
      if (!highConfidenceMatch) {
        continue;
      }
      size = getExistingExportSize(entries[index].name);
      if (
        size &&
        hasSimilarAspect(size.widthPx, size.heightPx, template.widthPx, template.heightPx) &&
        belongsToBackgroundGroup(existingVariant, variant)
      ) {
        matches.push({
          file: entries[index],
          widthPx: size.widthPx,
          heightPx: size.heightPx,
          area: getPixelArea(size.widthPx, size.heightPx)
        });
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

  async function deleteCandidateFiles(candidates, keepFile, folder, identityIndex) {
    var deletedCount = 0;
    var index;
    for (index = 0; index < candidates.length; index += 1) {
      if (candidates[index].file === keepFile) {
        continue;
      }
      try {
        if (window.IDPhotoArchiveNamingService && folder)
          await window.IDPhotoArchiveNamingService.retire(folder, identityIndex[candidates[index].file.name]);
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

  async function exportSingleJpgDirect(processedDocument, options) {
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
    var variant = null;
    var identityIndex;
    var indexError = null;
    var indexSyncError = null;

    if (!processedDocument) {
      throw new Error("没有可导出的处理后单张照片");
    }
    if (!template || !(Number(template.widthPx) > 0) || !(Number(template.heightPx) > 0)) {
      throw new Error("当前模板缺少有效的单张像素尺寸");
    }

    if (!window.IDPhotoSourceEligibilityService || typeof window.IDPhotoSourceEligibilityService.checkSource !== "function") {
      throw new Error("本店拍摄资格检查未加载，已停止自动保存");
    }
    {
      eligibility = window.IDPhotoSourceEligibilityService.checkSource(docInfo.sourceMetadata || null, docInfo.name || "");
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

    if (window.IDPhotoVariantService && typeof window.IDPhotoVariantService.analyzeDocument === "function") {
      try {
        variant = normalizeVariant(
          Object.prototype.hasOwnProperty.call(docInfo, "sourceVariant")
            ? docInfo.sourceVariant
            : await window.IDPhotoVariantService.analyzeDocument(processedDocument),
          docInfo.name,
          docInfo.stableSourceId
        );
      } catch (analysisError) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(analysisError);
        console.warn("[export] photo variant analysis failed; skipping archive", analysisError);
      }
    }

    if (!variant || variant.backgroundColor === "unknown" || !variant.identityMarker || variant.unverifiableStrongSourceId) {
      return {
        ok: true, skipped: true, identityUnverified: true,
        message: "原片身份或底色无法确认：已跳过存档，排版与冲印不受影响"
      };
    }

    rootResult = await getOutputRootFolder(nasArchive);
    dateFolder = await getDatedOutputFolder(rootResult.folder);
    async function saveInDirectory() {
    try {
      identityIndex = await readJpgIdentityIndex(dateFolder, Boolean(options.deliveryTask));
      if (options.deliveryTask && window.IDPhotoArchiveNamingService &&
          await window.IDPhotoArchiveNamingService.recoverIndex(options.deliveryTask, dateFolder, identityIndex))
        await writePrivateIndex(dateFolder, identityIndex);
    } catch (readError) {
      if (options.deliveryTask) throw readError;
      indexError = readError;
      identityIndex = {};
    }
    aspectGroup = getAspectGroup(template.widthPx, template.heightPx);
    currentArea = getPixelArea(template.widthPx, template.heightPx);
    existingExports = indexError ? [] : await findSourceGroupExports(dateFolder, template, variant, identityIndex);
    // Identical source bytes never authorize joining two explicit customers.
    if (options.deliveryTask) existingExports = existingExports.filter(function (candidate) {
      var entry = identityIndex[candidate.file.name];
      if (entry && entry.deliveryTaskId === options.deliveryTask.id && !entry.archiveId)
        throw new Error("当前任务归档映射缺失，保留原文件待核对");
      return entry && entry.archiveId && entry.deliveryTaskId === options.deliveryTask.id;
    });
    // Validate every owned candidate before either reuse OR smaller-file
    // cleanup. An index assertion alone cannot authorize deleting an old JPG.
    if (options.deliveryTask) {
      if (!window.IDPhotoArchiveNamingService) throw new Error("交付归档服务未加载");
      for (var candidate of existingExports) {
        await window.IDPhotoArchiveNamingService.bind(options.deliveryTask, rootResult.folder, dateFolder,
          candidate.file, await getPrivateIndex(dateFolder), identityIndex[candidate.file.name],
          Object.assign({}, template, {
            name: candidate.file.name.replace(/_\d{3,5}x\d{3,5}_.+$/, ""),
            widthPx: candidate.widthPx, heightPx: candidate.heightPx }));
      }
    }
    largestExisting = getLargestExport(existingExports);
    if (largestExisting && largestExisting.area >= currentArea) {
      // Similarity is not transitive: only remove photos close to the actual keeper.
      existingExports = existingExports.filter(function (entry) {
        return hasSimilarAspect(entry.widthPx, entry.heightPx, largestExisting.widthPx, largestExisting.heightPx);
      });
      if (options.deliveryTask && window.IDPhotoArchiveNamingService) {
        await writePrivateIndex(dateFolder, identityIndex);
        await writeJpgIdentityIndex(dateFolder, identityIndex);
      }
      removedCount = await deleteCandidateFiles(existingExports, largestExisting.file, dateFolder, identityIndex);
      return await withHiddenIndex({
        ok: true,
        skipped: true,
        duplicateSource: true,
        sameAspect: true,
        keptLargest: true,
        fileName: largestExisting.file.name,
        removedCount: removedCount,
        cleanupIncomplete: removedCount < existingExports.length - 1,
        mode: rootResult.mode,
        picked: rootResult.picked,
        message: "同一原片同底色近似比例已保留最大 JPG，跳过重复导出：" + largestExisting.file.name +
          (removedCount < existingExports.length - 1 ? " · 较小 JPG 清理失败，请检查目录权限" : "")
      }, dateFolder, options.archiveIndexExecutor);
    }
    replacedSmaller = Boolean(largestExisting);
    fileName = window.IDPhotoPathService.makeJpgFileName(template.name, docInfo.name, template.widthPx, template.heightPx, variant);
    fileResult = await createAvailableFile(dateFolder, fileName);
    file = fileResult.file;
    fileName = fileResult.fileName;
    var outputReceipt = null;
    try {
      if (options.deliveryTask) {
        if (!window.IDPhotoArchiveNamingService) throw new Error("交付归档服务未加载");
        outputReceipt = await window.IDPhotoArchiveNamingService.prepareOutput(
          options.deliveryTask, rootResult.folder, dateFolder, file);
      }
      await saveDocumentAsJpg(processedDocument, file);
    } catch (saveError) {
      try {
        await deleteCreatedFile(file);
        if (outputReceipt)
          await window.IDPhotoArchiveNamingService.discardFailedOutput(dateFolder, outputReceipt);
      } catch (cleanupError) {
        console.warn("[export] failed to remove incomplete JPG", cleanupError);
      }
      throw saveError;
    }
    // A completed photo is primary data. Auxiliary index failures must never delete it.
    if (!indexError) {
      identityIndex[fileName] = { identityMarker: variant.identityMarker, backgroundColor: variant.backgroundColor };
      try {
        try {
          if (options.deliveryTask && window.IDPhotoArchiveNamingService)
            await window.IDPhotoArchiveNamingService.bind(options.deliveryTask, rootResult.folder, dateFolder,
              file, await getPrivateIndex(dateFolder), identityIndex[fileName], template, outputReceipt);
        } finally { await writePrivateIndex(dateFolder, identityIndex); }
      } catch (writeError) {
        indexError = writeError;
      }
      if (!indexError) {
        try { await writeJpgIdentityIndex(dateFolder, identityIndex, options.archiveIndexExecutor); }
        catch (syncError) { indexSyncError = syncError; console.warn("[export] private index saved; shared index sync failed", syncError); }
      }
    }
    if (indexError) {
      console.warn("[export] JPG saved; identity index unavailable", indexError);
      return {
        ok: true,
        fileName: fileName,
        indexUnavailable: true,
        replacedSmaller: false,
        removedCount: 0,
        mode: rootResult.mode,
        picked: rootResult.picked,
        message: "单张 JPG 已保存：" + fileName + " · 去重索引失败，已保留照片并暂停清理：" + indexError.message
      };
    }
    if (replacedSmaller) {
      removedCount = await deleteCandidateFiles(existingExports, null, dateFolder, identityIndex);
    }

    return {
      ok: true,
      fileName: fileName,
      aspectGroup: aspectGroup,
      backgroundColor: variant ? variant.backgroundColor : "unknown",
      personFingerprint: variant ? variant.personFingerprint : "",
      indexSyncWarning: Boolean(indexSyncError),
      replacedSmaller: replacedSmaller,
      removedCount: removedCount,
      cleanupIncomplete: removedCount < existingExports.length,
      mode: rootResult.mode,
      picked: rootResult.picked,
      message:
        "单张 JPG 已导出：" +
        fileName +
        (replacedSmaller ? (removedCount < existingExports.length ? " · 较小 JPG 清理失败，请检查目录权限" : " · 已替换同组较小 JPG") : "") +
        (nasArchive ? " · NAS 日期归档" : " · 插件数据目录测试输出") +
        (rootResult.picked ? " · 已选择输出根目录" : "") +
        (indexSyncError ? " · 本机去重记录已保存，目录索引同步失败：" + (indexSyncError.message || String(indexSyncError)) : "")
    };
    }
    return window.IDPhotoArchiveNamingService ?
      await window.IDPhotoArchiveNamingService.withDirectory(dateFolder, saveInDirectory) : await saveInDirectory();
  }

  function exportSingleJpg(processedDocument, options) {
    var result = exportQueue.then(function () { return exportSingleJpgDirect(processedDocument, options); });
    exportQueue = result.catch(function () {});
    return result;
  }

  window.IDPhotoExportService = {
    exportSingleJpg: exportSingleJpg,
    chooseNasRootFolder: chooseNasRootFolder,
    clearNasRootFolder: clearNasRootFolder,
    getNasAuthorizationLabel: getNasAuthorizationLabel,
    hasNasAuthorization: hasNasAuthorization
  };
})();
