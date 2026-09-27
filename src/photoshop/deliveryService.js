(function () {
  "use strict";
  var TOKEN = "idphoto-delivery-root-v1";
  var latestTask = null;
  function errorText(error) { return error && error.message ? error.message : String(error); }
  function fs() { return require("uxp").storage.localFileSystem; }
  function format(binary) { return binary ? require("uxp").storage.formats.binary : require("uxp").storage.formats.utf8; }
  function protocol() { return window.IDPhotoDeliveryProtocol; }
  async function child(parent, name) { try { return await parent.getEntry(name); } catch (e) { return await parent.createFolder(name); } }
  async function root() {
    var token = window.localStorage.getItem(TOKEN);
    if (token) return await fs().getEntryForPersistentToken(token);
    return await child(await fs().getDataFolder(), "delivery-handoffs-v1");
  }
  async function configure() {
    var folder = await fs().getFolder(); if (!folder) return null;
    // Keep the independent delivery copy local even when NAS archiving fails.
    if (/^(\\\\|\/\/)/.test(folder.nativePath || "")) throw new Error("交接副本请选择本机目录，NAS 仍使用原归档设置。");
    window.localStorage.setItem(TOKEN, await fs().createPersistentToken(folder));
    return folder.nativePath;
  }
  async function writeAtomic(folder, name, value) {
    var pending = name + "." + protocol().id() + ".tmp", file = await folder.createFile(pending, { overwrite: false });
    await file.write(value, { format: format(false) });
    await file.moveTo(folder, { newName: name, overwrite: true });
  }
  async function status(task, values) {
    task.status = Object.assign({}, task.status, values, { taskId: task.id, at: new Date().toISOString() });
    await writeAtomic(task.folder, "plugin-status.json", JSON.stringify(task.status));
  }
  async function begin(docInfo, mode, template, settings) {
    var eligibility = window.IDPhotoSourceEligibilityService.checkSource(docInfo.sourceMetadata, docInfo.name);
    if (!eligibility.eligible) throw new Error("此照片不符合自动交付资格，请使用后台明确人工补交：" + eligibility.message);
    var id = protocol().id(), output = protocol().id(), folders = window.IDPhotoPathService.getDateFolders();
    var folder = await child(await child(await child(await root(), folders.year), folders.month), folders.day);
    folder = await folder.createFolder(id);
    var task = { id: id, outputId: output, folder: folder, docInfo: JSON.parse(JSON.stringify(docInfo)), mode: mode,
      template: JSON.parse(JSON.stringify(template)), settings: JSON.parse(JSON.stringify(settings)), code: "", fingerprint: "", status: {} };
    task.dateText = window.IDPhotoDateService.formatDisplayDate();
    await writeAtomic(folder, "context.json", JSON.stringify({ version: 1, id: id, outputId: output, docInfo: task.docInfo, mode: mode, template: task.template, settings: task.settings, dateText: task.dateText }));
    await status(task, { processing: "started", info: "pending" }); latestTask = task;
    window.localStorage.setItem("idphoto-delivery-last-v1", await fs().createPersistentToken(folder));
    return task;
  }
  function pixels(value) { return Math.round(Number(value && value.value != null ? value.value : value)); }
  async function saveJpeg(task, documentRef, name, role) {
    var file = await task.folder.createFile(name, { overwrite: false });
    var width = pixels(documentRef.width), height = pixels(documentRef.height);
    await window.IDPhotoPhotoshopExecution.executeAsModal(async function () {
      await window.IDPhotoPhotoshopExecution.activateDocument(documentRef);
      await documentRef.saveAs.jpg(file, { quality: 12 }, true);
    }, "保存独立" + role + "副本");
    var bytes = await file.read({ format: format(true) });
    return { path: name, role: role, sha256: protocol().sha256(bytes), sizeBytes: bytes.byteLength, width: width, height: height };
  }
  async function prepare(task, documentRef) {
    var photo = await saveJpeg(task, documentRef, "photo.jpg", "photo");
    // Do not silently shrink a high-resolution result to satisfy cloud limits.
    if (photo.sizeBytes > 8388608 || photo.width * photo.height > 20000000) {
      await status(task, { processing: "retained-over-limit", error: "高清文件超过当前 8 MiB / 20MP 上限，已保留，需人工处理" });
      throw new Error(task.status.error);
    }
    var request = { version: 1, taskId: task.id, outputId: task.outputId, sourceDocumentId: String(task.docInfo.id), mode: task.mode,
      title: String(task.docInfo.name || "电子成片").slice(0, 120), eligible: true, testOnly: true, files: [photo] };
    var payload = JSON.stringify(request); task.fingerprint = protocol().sha256(payload);
    await writeAtomic(task.folder, "request.json", payload);
    await status(task, { processing: "awaiting-code", manifestFingerprint: task.fingerprint });
    // No Photoshop modal lock is held during this bounded wait. Receipt timeout
    // cannot change the ID, publish, or prevent a valid print.
    task.code = await confirmCode(task);
    await status(task, { processing: "prepared", codeState: task.code ? "confirmed" : "pending" });
    return task.code;
  }
  async function readCode(task) {
    try {
      var receipt = JSON.parse(await (await task.folder.getEntry("code-response.json")).read({ format: format(false) }));
      var code = protocol().confirmedCode(receipt, task);
      if (code) { task.contextKey = receipt.contextKey; task.deliveryId = receipt.deliveryId; }
      return code;
    }
    catch (e) { return ""; }
  }
  async function confirmCode(task) {
    task.code = ""; task.confirmationId = protocol().id();
    await writeAtomic(task.folder, "code-request.json", JSON.stringify({ version: 2, taskId: task.id, manifestFingerprint: task.fingerprint,
      requestId: task.confirmationId, contextKey: task.contextKey || "", deliveryId: task.deliveryId || "" }));
    var deadline = Date.now() + 4000, code = "";
    while (Date.now() < deadline) {
      code = await readCode(task); if (code) break;
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
    if (code) await writeAtomic(task.folder, "code-binding.json", JSON.stringify({ version: 2, taskId: task.id,
      manifestFingerprint: task.fingerprint, contextKey: task.contextKey, deliveryId: task.deliveryId }));
    return code;
  }
  async function cropInfo(task, targetDocument, infoBar, filename) {
    var copy;
    try {
      await window.IDPhotoPhotoshopExecution.executeAsModal(async function () {
        copy = await targetDocument.duplicate("信息条_" + task.id);
        if (!copy || copy === targetDocument || copy.id === targetDocument.id) { copy = null; throw new Error("信息条副本未独立创建，未裁切原文档"); }
        await window.IDPhotoPhotoshopExecution.activateDocument(copy);
        await copy.crop({ left: infoBar.x, top: infoBar.y, right: infoBar.x + infoBar.width, bottom: infoBar.y + infoBar.height });
      }, "导出完整可剪信息条");
      return await saveJpeg(task, copy, filename || "info.jpg", "info");
    } finally { if (copy) await window.IDPhotoDocumentService.closeWithoutSaving(copy); }
  }
  async function complete(task, targetDocument, infoBar) {
    var artifacts = [];
    if (task.mode === "print") artifacts.push(await saveJpeg(task, targetDocument, "layout.jpg", "layout"));
    try { artifacts.push(await cropInfo(task, targetDocument, infoBar)); await status(task, { info: "saved" }); }
    catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); }
    if (!task.fingerprint) throw new Error("高清成片尚未可靠交接，未生成发布完成信号。");
    await writeAtomic(task.folder, "complete.json", JSON.stringify({ version: 1, taskId: task.id, manifestFingerprint: task.fingerprint, processingComplete: true, artifacts: artifacts }));
    await status(task, { processing: "complete", message: "处理完成，等待后台确认发布", outputDirectory: task.folder.nativePath });
    return task.status;
  }
  function localInfoBar(template) {
    var bar = JSON.parse(JSON.stringify(template.infoBar)), x = bar.x, y = bar.y;
    bar.x = 0; bar.y = 0; bar.avatar.x -= x; bar.avatar.y -= y;
    bar.texts.forEach(function (item) { item.x -= x; item.y -= y; }); return bar;
  }
  async function standaloneInfo(task, photoDocument, code) {
    var bar = localInfoBar(task.template), canvas;
    try {
      await window.IDPhotoPhotoshopExecution.executeAsModal(async function () {
        var app = window.IDPhotoPhotoshopExecution.getPhotoshop().app;
        var existing = Array.from(app.documents).map(function (d) { return d.id; });
        var options = { width: bar.width, height: bar.height, resolution: 600, name: "信息条_" + task.id, mode: "RGBColorMode", fill: "white" };
        await app.documents.add(options);
        canvas = window.IDPhotoPhotoshopExecution.resolveCreatedDocument(existing, options);
      }, "创建独立信息条");
      await window.IDPhotoInfoBarRenderer.renderInfoBar(canvas, bar, task.settings, { dateText: task.dateText, pickupCode: code, template: task.template, sourceDocument: photoDocument });
      return { document: canvas, infoBar: bar };
    } catch (e) { if (canvas) await window.IDPhotoDocumentService.closeWithoutSaving(canvas); throw e; }
  }
  async function electronic(sourceDocument, docInfo, settings) {
    // Current processed pixels are the explicit product. No template recrop or
    // six-inch page is part of the electronic-only path.
    var template = window.IDPhotoTemplates.getTemplateById("one-inch");
    var task = await begin(docInfo, "electronic", template, settings), photo, info;
    try {
      var shape = { name: "电子成片", widthPx: docInfo.widthPx, heightPx: docInfo.heightPx };
      photo = await window.IDPhotoCropService.prepareSinglePhoto(sourceDocument, docInfo, shape, { ok: true }, { preservePixels: true });
      await prepare(task, photo.document);
      try { info = await standaloneInfo(task, photo.document, task.code); }
      catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); }
      if (info) await complete(task, info.document, info.infoBar);
      else {
        await writeAtomic(task.folder, "complete.json", JSON.stringify({ version: 1, taskId: task.id, manifestFingerprint: task.fingerprint, processingComplete: true, artifacts: [] }));
        await status(task, { processing: "complete", message: "成片已交接；信息条生成失败，可单独重试" });
      }
      return task;
    } catch (error) { await status(task, { error: errorText(error) }); throw error; }
    finally { if (info) await window.IDPhotoDocumentService.closeWithoutSaving(info.document); if (photo) await window.IDPhotoDocumentService.closeWithoutSaving(photo.document); }
  }
  async function restoreTask(folder) {
    var saved = JSON.parse(await (await folder.getEntry("context.json")).read({ format: format(false) }));
    var payload = await (await folder.getEntry("request.json")).read({ format: format(false) });
    var request = JSON.parse(payload);
    if (saved.version !== 1 || saved.id !== request.taskId || saved.outputId !== request.outputId) throw new Error("原任务上下文不匹配，不能补码。");
    var previousStatus = {};
    try { previousStatus = JSON.parse(await (await folder.getEntry("plugin-status.json")).read({ format: format(false) })); } catch (e) { /* Context and request remain the authority for identity. */ }
    var task = Object.assign(saved, { folder: folder, fingerprint: protocol().sha256(payload), status: previousStatus });
    var binding;
    try { binding = await folder.getEntry("code-binding.json"); } catch (e) { /* Legacy tasks require a fresh backend confirmation. */ }
    if (binding) {
      var value = JSON.parse(await binding.read({ format: format(false) }));
      if (value.version !== 2 || value.taskId !== task.id || value.manifestFingerprint !== task.fingerprint || !value.contextKey || !value.deliveryId) throw new Error("原连接绑定损坏，待核对后补图。");
      task.contextKey = value.contextKey; task.deliveryId = value.deliveryId;
    }
    return task;
  }
  async function regenerate(folder) {
    if (!folder) {
      var token = window.localStorage.getItem("idphoto-delivery-last-v1");
      if (!token) throw new Error("没有可补码的原任务，请选择交接任务目录。");
      folder = await fs().getEntryForPersistentToken(token);
    }
    var task = await restoreTask(folder), code = await confirmCode(task), photo, info;
    if (!code) throw new Error("本次取件码待核对：后台未确认有效码，或交付已取消/撤回；请核对原连接与管理结果。");
    var file = await folder.getEntry("photo.jpg"), bytes = await file.read({ format: format(true) });
    var request = JSON.parse(await (await folder.getEntry("request.json")).read({ format: format(false) }));
    if (protocol().sha256(bytes) !== request.files[0].sha256) throw new Error("原任务成片已变化，拒绝补码。");
    try {
      await window.IDPhotoPhotoshopExecution.executeAsModal(async function () {
        var app = window.IDPhotoPhotoshopExecution.getPhotoshop().app;
        var existing = Array.from(app.documents).map(function (d) { return d.id; });
        var opened = await app.open(file);
        if (existing.indexOf(opened.id) !== -1) {
          var duplicate = await opened.duplicate("补码_" + task.id);
          if (duplicate.id === opened.id || existing.indexOf(duplicate.id) !== -1) throw new Error("补码副本身份无效，保留已有文档");
          photo = duplicate;
        } else photo = opened;
      }, "打开原任务独立副本");
      info = await standaloneInfo(task, photo, code);
      // Recheck after rendering: management during Photoshop work must not leave
      // a newly exported image carrying a superseded code.
      if (await confirmCode(task) !== code) throw new Error("生成期间取件码或管理状态变化，未导出旧码；请待核对后重试原任务。");
      var filename = "info-" + protocol().id() + ".jpg";
      var artifact = await cropInfo(task, info.document, info.infoBar, filename);
      var supplements = { version: 1, taskId: task.id, manifestFingerprint: task.fingerprint, artifacts: [] };
      var previous;
      try { previous = await folder.getEntry("supplements.json"); } catch (e) { /* First regeneration. */ }
      if (previous) {
        supplements = JSON.parse(await previous.read({ format: format(false) }));
        if (supplements.version !== 1 || supplements.taskId !== task.id || supplements.manifestFingerprint !== task.fingerprint || !Array.isArray(supplements.artifacts)) throw new Error("原任务附属图片清单不匹配，已保留本次图片，请人工核对。");
      }
      if (supplements.artifacts.length >= 16) throw new Error("本任务已有 16 张补码图片，已保留本次图片，请人工归档；未改变原交付。");
      supplements.artifacts.push(artifact);
      await writeAtomic(folder, "supplements.json", JSON.stringify(supplements));
      await status(task, { info: "saved", infoError: "", regenerated: filename, codeState: "confirmed", message: "原任务信息条已重导，成片交付状态请以后台为准" });
      return folder.nativePath + "\\" + filename;
    } catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); throw error; }
    finally { if (info) await window.IDPhotoDocumentService.closeWithoutSaving(info.document); if (photo) await window.IDPhotoDocumentService.closeWithoutSaving(photo); }
  }
  window.IDPhotoDeliveryService = { begin: begin, prepare: prepare, complete: complete, electronic: electronic, regenerate: regenerate,
    configure: configure, root: root, status: status, readCode: readCode, latest: function () { return latestTask; } };
})();
