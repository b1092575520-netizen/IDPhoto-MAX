(function () {
  "use strict";
  var TOKEN = "idphoto-delivery-root-v1";
  var PENDING = "idphoto-delivery-pending-v1";
  var CONNECTION_PROTOCOL = "pickup-handoff-compat-1";
  // The measured test-cloud confirmation was 3.003s. Allow one missed
  // filesystem event (10s rescan) and one 45s HTTP request, with bounded margin.
  // This is an attempt budget, not a promise that the cloud will respond.
  var CODE_WAIT_MS = 60000;
  var latestTask = null;
  var creatingTask = false, retryingTask = false, activeWait = null;
  var progress = function () {};
  var waitingChanged = function () {};
  function notify(message) { progress(message); }
  function errorText(error) { return error && error.message ? error.message : String(error); }
  function addDiagnostic(error, label, secondary) {
    error.message = errorText(error) + "；" + label + "：" + errorText(secondary);
    return error;
  }
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
  async function writeAtomic(folder, name, value, overwrite) {
    var pending = name + "." + protocol().id() + ".tmp", file = await folder.createFile(pending, { overwrite: false });
    await file.write(value, { format: format(false) });
    await file.moveTo(folder, { newName: name, overwrite: overwrite !== false });
  }
  async function optionalEntry(folder, name) {
    try { return await folder.getEntry(name); } catch (_) { return null; }
  }
  async function pending() {
    var token = window.localStorage.getItem(PENDING);
    if (!token) return null;
    var folder = await fs().getEntryForPersistentToken(token);
    if (!folder) throw new Error("未完成交付的原目录不可用，请恢复目录；未新建任务");
    var context = JSON.parse(await (await folder.getEntry("context.json")).read({ format: format(false) }));
    if (context.version !== 1 || !/^[a-f0-9]{32}$/.test(context.id || "") || folder.name !== context.id)
      throw new Error("未完成任务的身份记录待核对，未新建交付");
    var completed = await optionalEntry(folder, "complete.json");
    if (completed) {
      var value = JSON.parse(await completed.read({ format: format(false) }));
      var request = await (await folder.getEntry("request.json")).read({ format: format(false) });
      if (value.version !== 1 || value.taskId !== context.id || !value.processingComplete ||
          value.manifestFingerprint !== protocol().sha256(request)) throw new Error("原任务完成记录不匹配，请核对，未新建交付");
      window.localStorage.setItem(PENDING, "");
      return null;
    }
    return { id: context.id, name: context.docInfo && context.docInfo.name || "原照片",
      mode: context.mode, outputOptions: context.outputOptions || {}, folder: folder, token: token };
  }
  async function clearPending(task) {
    var token = window.localStorage.getItem(PENDING);
    if (token && pathKey((await fs().getEntryForPersistentToken(token)).nativePath) === pathKey(task.folder.nativePath))
      window.localStorage.setItem(PENDING, "");
  }
  async function deferPending(expectedId) {
    if (creatingTask || retryingTask || activeWait) throw new Error("当前交付仍在处理中，请先等待操作结束");
    var item = await pending();
    if (!item || item.id !== expectedId) throw new Error("未完成任务已改变，请重新核对");
    var previous = {}, file = await optionalEntry(item.folder, "plugin-status.json");
    if (file) previous = JSON.parse(await file.read({ format: format(false) }));
    await status({ id: item.id, folder: item.folder, status: previous }, {
      deferredByOperator: true, message: "店员明确开始另一位顾客；此任务保留未完成，不代表云端取消" });
    window.localStorage.setItem(PENDING, "");
  }
  function outputSnapshot(options) {
    if (!options) return null;
    var saved = {};
    ["exportJpg", "nasArchive", "tryExportSingle", "skipExport", "quickPrint", "closeAfterPrint", "skipPrint", "debugMode"].forEach(function (key) {
      saved[key] = Boolean(options[key]);
    });
    saved.cropStrategy = options.cropStrategy || "auto";
    saved.rowGap = Number(options.rowGap); saved.colGap = Number(options.colGap);
    return saved;
  }
  function pathKey(value) { return String(value || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase(); }
  async function connection(folder, expectedConsumer) {
    folder = folder || await root();
    var requestId = protocol().id();
    notify("正在核对插件与后台的本次连接…");
    await writeAtomic(folder, "connection-request.json", JSON.stringify({ version: 1, requestId: requestId,
      sourceRoot: folder.nativePath, protocol: CONNECTION_PROTOCOL }));
    var deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      var response = null;
      try { response = JSON.parse(await (await folder.getEntry("connection-response.json")).read({ format: format(false) })); }
      catch (_) { /* Missing/incomplete responses are not readiness evidence. */ }
      if (response && response.version === 1 && response.requestId === requestId &&
          pathKey(response.sourceRoot) === pathKey(folder.nativePath)) {
        if (response.protocol !== CONNECTION_PROTOCOL || response.state === "incompatible")
          throw new Error("后台版本不兼容，请使用本轮配套后台；尚未创建交付");
        if (response.state === "isolated") throw new Error("后台队列处于隔离保护，请按恢复记录处理；未创建交付");
        if (response.state === "stopping") throw new Error("后台正在停止，请等待当前请求收束后再启动；未创建交付");
        if (response.state === "stopped") throw new Error("后台尚未启动，请在照片交付管理中启动后台");
        if (response.ready === true && response.state === "running" && response.sourceIdentity && response.consumerId) {
          if (expectedConsumer && response.consumerId !== expectedConsumer) throw new Error("当前交接消费者与原任务不同，请恢复原队列后重试");
          notify("交接已连通；云端尚未核对");
          return response;
        }
      }
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
    throw new Error("交接尚未连通：请打开配套照片交付管理并连接当前插件。尚不能确认是后台未启动还是目录不一致。");
  }
  async function status(task, values) {
    task.status = Object.assign({}, task.status, values, { taskId: task.id, at: new Date().toISOString() });
    await writeAtomic(task.folder, "plugin-status.json", JSON.stringify(task.status));
  }
  async function begin(docInfo, mode, template, settings, intent, outputOptions) {
    if (creatingTask || retryingTask) throw new Error("当前交付正在准备，请勿重复执行");
    creatingTask = true;
    try {
    var unfinished = await pending();
    if (unfinished) throw new Error("有尚未完成的原任务，请使用“继续原任务”重试；当前若是另一位顾客，请先明确保留旧任务。未新建交付。");
    var eligibility = window.IDPhotoSourceEligibilityService.checkSource(docInfo.sourceMetadata, docInfo.name);
    var historical = !eligibility.eligible && window.IDPhotoSourceEligibilityService.historicalIntentMatches &&
      window.IDPhotoSourceEligibilityService.historicalIntentMatches(intent, docInfo);
    if (!eligibility.eligible && !historical) throw new Error("此照片仅排版；如需补交，请明确确认本次本店旧片：" + eligibility.message);
    var sourceRoot = await root(), connected = await connection(sourceRoot);
    var id = protocol().id(), output = protocol().id(), folders = window.IDPhotoPathService.getDateFolders();
    var folder = await child(await child(await child(sourceRoot, folders.year), folders.month), folders.day);
    folder = await folder.createFolder(id);
    var task = { id: id, outputId: output, folder: folder, docInfo: JSON.parse(JSON.stringify(docInfo)), mode: mode,
      template: JSON.parse(JSON.stringify(template)), settings: JSON.parse(JSON.stringify(settings)), historical: Boolean(historical),
      consumerId: connected.consumerId, sourceIdentity: connected.sourceIdentity, sourceRoot: sourceRoot.nativePath,
      code: "", fingerprint: "", status: {} };
    task.sourceRootToken = await fs().createPersistentToken(sourceRoot);
    task.outputOptions = outputSnapshot(outputOptions);
    task.dateText = historical ? window.IDPhotoSourceEligibilityService.captureDateText(docInfo.sourceMetadata) : window.IDPhotoDateService.formatDisplayDate();
    var context = JSON.stringify({ version: 1, id: id, outputId: output, docInfo: task.docInfo, mode: mode,
      template: task.template, settings: task.settings, historical: task.historical, dateText: task.dateText,
      consumerId: task.consumerId, sourceIdentity: task.sourceIdentity, sourceRoot: task.sourceRoot,
      sourceRootToken: task.sourceRootToken, outputOptions: task.outputOptions });
    task.contextFingerprint = protocol().sha256(context);
    await writeAtomic(folder, "context.json", context);
    var taskToken = await fs().createPersistentToken(folder);
    window.localStorage.setItem(PENDING, taskToken);
    latestTask = task;
    window.localStorage.setItem("idphoto-delivery-last-v1", taskToken);
    await status(task, { processing: "started", info: "pending" });
    return task;
    } finally { creatingTask = false; }
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
  function requestPayload(task, photo) {
    var request = { version: 1, taskId: task.id, outputId: task.outputId, sourceDocumentId: String(task.docInfo.id), mode: task.mode,
      title: String(task.docInfo.name || "电子成片").slice(0, 120), eligible: true, testOnly: true,
      contextFingerprint: task.contextFingerprint, files: [photo] };
    if (task.historical) request.sourceConfirmation = { kind: "historical-shop", sourceDocumentId: String(task.docInfo.id),
      confirmed: true, noExistingDelivery: true, captureDate: task.dateText };
    return JSON.stringify(request);
  }
  async function prepare(task, documentRef) {
    var photo = await saveJpeg(task, documentRef, "photo.jpg", "photo");
    // Do not silently shrink a high-resolution result to satisfy cloud limits.
    if (photo.sizeBytes > 8388608 || photo.width * photo.height > 20000000) {
      await status(task, { processing: "retained-over-limit", error: "高清文件超过当前 8 MiB / 20MP 上限，已保留，需人工处理" });
      throw new Error(task.status.error);
    }
    await writeAtomic(task.folder, "photo-prepared.json", JSON.stringify({ version: 1, taskId: task.id,
      outputId: task.outputId, contextFingerprint: task.contextFingerprint, photo: photo }), false);
    var payload = requestPayload(task, photo); task.fingerprint = protocol().sha256(payload);
    await writeAtomic(task.folder, "request.json", payload, false);
    await status(task, { processing: "awaiting-code", manifestFingerprint: task.fingerprint });
    // Network confirmation never holds a Photoshop modal lock. An unconfirmed
    // task stays incomplete; a late receipt cannot resume output or publish it.
    try {
      task.code = await confirmCode(task);
      protocol().requirePickupCode(task.code);
      await status(task, { processing: "prepared", codeState: "confirmed" });
      return task.code;
    } catch (error) {
      task.code = "";
      var blocked = protocol().pickupCodeError(error);
      try { await status(task, { processing: "blocked-code", codeState: "unconfirmed", error: errorText(error) }); }
      catch (statusError) { addDiagnostic(blocked, "取码失败状态未能写入", statusError); }
      throw blocked;
    }
  }
  async function readCode(task) {
    var receipt;
    try {
      receipt = JSON.parse(await (await task.folder.getEntry("code-response.json")).read({ format: format(false) }));
    }
    catch (e) { return ""; }
    var code = protocol().confirmedCode(receipt, task);
    if (code) { task.contextKey = receipt.contextKey; task.deliveryId = receipt.deliveryId; return code; }
    // Only diagnostics bound to this attempt and immutable request can describe
    // its failure. Foreign/stale receipts cannot supply even an error message.
    if (receipt && receipt.version === 2 && receipt.requestId === task.confirmationId &&
        receipt.taskId === task.id && receipt.manifestFingerprint === task.fingerprint && receipt.accepted === true) {
      if ((task.contextKey && receipt.contextKey !== task.contextKey) || (task.deliveryId && receipt.deliveryId !== task.deliveryId)) {
        task.confirmationFailure = "回执与原任务的云端连接或交付不一致，请恢复原连接核对";
      } else if (["cancelled", "withdrawn", "frozen", "split"].includes(receipt.status)) {
        task.confirmationFailure = "原交付已取消、撤回或停止共享，不能继续输出";
      } else if (receipt.confirmed === false && receipt.errorCode) {
        var messages = {
          UNAUTHENTICATED: "云端认证失败，请在后台核对店员连接设置",
          FORBIDDEN: "云端拒绝当前操作，请核对原交付与权限",
          NOT_FOUND_OR_FORBIDDEN: "云端尚未确认原交付存在或可访问，不能新建替代交付",
          NETWORK: "后台已连通，但暂时无法连接云端",
          TIMEOUT: "云端请求超时，结果尚不确定；保留原任务后重试",
          CONTEXT_MISMATCH: "云端连接与原任务不一致，请恢复原连接",
          LOCAL_CONFIRMATION: "后台本地核对失败，请展开交接诊断",
          STATE_UNCONFIRMED: "云端状态或待决管理操作尚未确认，请在后台核对"
        };
        task.confirmationFailure = messages[receipt.errorCode] || "本次云端核对未通过，请查看后台任务原因";
      }
    }
    return "";
  }
  async function confirmCode(task) {
    if (activeWait) throw new Error("已有取码请求正在等待，请勿重复重试");
    notify("正在等待后台核对云端并获取取件码，最多 60 秒；可停止等待并保留原任务");
    task.code = ""; task.confirmationId = protocol().id(); task.confirmationFailure = "";
    var attempt = { cancelled: false, requestId: task.confirmationId };
    activeWait = attempt;
    waitingChanged(true);
    try {
    await writeAtomic(task.folder, "code-request.json", JSON.stringify({ version: 2, taskId: task.id, manifestFingerprint: task.fingerprint,
      requestId: task.confirmationId, contextKey: task.contextKey || "", deliveryId: task.deliveryId || "" }));
    var deadline = Date.now() + CODE_WAIT_MS, code = "";
    while (Date.now() < deadline) {
      if (attempt.cancelled) throw protocol().pickupCodeError("已停止本机等待；原任务保留，不代表云端取消");
      code = await readCode(task);
      if (attempt.cancelled) throw protocol().pickupCodeError("已停止本机等待；原任务保留，不代表云端取消");
      if (Date.now() >= deadline) { code = ""; break; }
      if (code) break;
      if (task.confirmationFailure) throw protocol().pickupCodeError(task.confirmationFailure + "，取件码待核对");
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
    if (attempt.cancelled) throw protocol().pickupCodeError("已停止本机等待；原任务保留，不代表云端取消");
    if (!code) throw protocol().pickupCodeError("本次取码等待超时，尚未取得有效确认；独立副本与原任务保留，请使用“继续原任务”受控重试，取件码待核对");
    if (code) await writeAtomic(task.folder, "code-binding.json", JSON.stringify({ version: 2, taskId: task.id,
      manifestFingerprint: task.fingerprint, contextKey: task.contextKey, deliveryId: task.deliveryId }));
    if (code) notify("云端已核对，本次已取得有效取件码");
    return code;
    } finally { if (activeWait === attempt) { activeWait = null; waitingChanged(false); } }
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
  async function startOutput(task) {
    protocol().requirePickupCode(task.code);
    if (!task.fingerprint) throw new Error("原成片清单尚未确认，不能开始输出");
    if (await optionalEntry(task.folder, "output-started.json"))
      throw new Error("原任务已开始过成品输出，请人工核对原成品与打印状态；不会重复执行");
    await writeAtomic(task.folder, "output-started.json", JSON.stringify({ version: 1, taskId: task.id,
      manifestFingerprint: task.fingerprint, requestId: task.confirmationId, at: new Date().toISOString() }), false);
  }
  async function writeCompletion(task, artifacts) {
    await writeAtomic(task.folder, "complete.json", JSON.stringify({ version: 1, taskId: task.id,
      manifestFingerprint: task.fingerprint, processingComplete: true, artifacts: artifacts }));
    task.completionWritten = true;
    try { await clearPending(task); }
    catch (error) { task.pendingReleaseError = "完成信号已保存，待处理入口未能清除：" + errorText(error); }
  }
  async function complete(task, targetDocument, infoBar) {
    protocol().requirePickupCode(task.code);
    if (!task.fingerprint) throw new Error("高清成片尚未可靠交接，未生成发布完成信号。");
    var artifacts = [];
    if (task.mode === "print") artifacts.push(await saveJpeg(task, targetDocument, "layout.jpg", "layout"));
    try { artifacts.push(await cropInfo(task, targetDocument, infoBar)); await status(task, { info: "saved" }); }
    catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); }
    await writeCompletion(task, artifacts);
    await status(task, { processing: "complete", message: "处理完成，等待后台确认发布", outputDirectory: task.folder.nativePath });
    return task.status;
  }
  function localInfoBar(template) {
    var bar = JSON.parse(JSON.stringify(template.infoBar)), x = bar.x, y = bar.y;
    bar.x = 0; bar.y = 0; bar.avatar.x -= x; bar.avatar.y -= y;
    bar.texts.forEach(function (item) { item.x -= x; item.y -= y; }); return bar;
  }
  async function standaloneInfo(task, photoDocument, code) {
    protocol().requirePickupCode(code);
    var bar = localInfoBar(task.template), canvas;
    try {
      await window.IDPhotoPhotoshopExecution.executeAsModal(async function () {
        var app = window.IDPhotoPhotoshopExecution.getPhotoshop().app;
        var existing = Array.from(app.documents).map(function (d) { return d.id; });
        var options = { width: bar.width, height: bar.height, resolution: 600, name: "信息条_" + task.id, mode: "RGBColorMode", fill: "white" };
        await app.documents.add(options);
        canvas = window.IDPhotoPhotoshopExecution.resolveCreatedDocument(existing, options);
      }, "创建独立信息条");
      await window.IDPhotoInfoBarRenderer.renderInfoBar(canvas, bar, task.settings, { dateText: task.dateText, pickupCodeMode: true, pickupCode: code, template: task.template, sourceDocument: photoDocument });
      return { document: canvas, infoBar: bar };
    } catch (e) { if (canvas) await window.IDPhotoDocumentService.closeWithoutSaving(canvas); throw e; }
  }
  async function electronic(sourceDocument, docInfo, settings, intent) {
    // Current processed pixels are the explicit product. No template recrop or
    // six-inch page is part of the electronic-only path.
    var template = window.IDPhotoTemplates.getTemplateById("one-inch");
    var task, photo, info, failure = null;
    try {
      try { task = await begin(docInfo, "electronic", template, settings, intent); }
      catch (beginError) { throw protocol().pickupCodeError(beginError); }
      var shape = { name: "电子成片", widthPx: docInfo.widthPx, heightPx: docInfo.heightPx };
      photo = await window.IDPhotoCropService.prepareSinglePhoto(sourceDocument, docInfo, shape, { ok: true }, { preservePixels: true });
      try { await prepare(task, photo.document); }
      catch (prepareError) { throw protocol().pickupCodeError(prepareError); }
      await startOutput(task);
      try { info = await standaloneInfo(task, photo.document, task.code); }
      catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); }
      if (info) await complete(task, info.document, info.infoBar);
      else {
        await writeCompletion(task, []);
        await status(task, { processing: "complete", message: "成片已交接；信息条生成失败，可单独重试" });
      }
      return task;
    } catch (error) {
      failure = error && typeof error === "object" ? error : new Error(errorText(error));
      if (task && task.completionWritten) failure.completed = true;
      if (task) {
        try { await status(task, { error: errorText(failure) }); }
        catch (statusError) { addDiagnostic(failure, "错误记录未能写入", statusError); }
      }
      throw failure;
    } finally {
      var cleanupError = null;
      // Try each owned copy even if the first close fails. Secondary failures
      // must not replace the pickup gate error that drives the required alert.
      for (var copy of [info && info.document, photo && photo.document]) {
        if (!copy) continue;
        try { await window.IDPhotoDocumentService.closeWithoutSaving(copy); }
        catch (closeError) {
          if (failure) addDiagnostic(failure, "临时副本未能关闭", closeError);
          else if (!cleanupError) cleanupError = closeError;
        }
      }
      if (cleanupError) throw cleanupError;
    }
  }
  async function restoreTask(folder) {
    var payload = await (await folder.getEntry("request.json")).read({ format: format(false) });
    var request = JSON.parse(payload);
    if (request.informationOnly && (!/^[a-f0-9]{64}$/.test(request.referenceFileId || "") || !Number.isInteger(request.referenceRevision) || request.referenceRevision < 1)) throw new Error("信息条缺少原文件版本绑定，请在后台重新导出任务。");
    var contextFile;
    try { contextFile = await folder.getEntry("context.json"); } catch (_) { /* Explicit backend information-only tasks acquire rendering context on first use. */ }
    if (!contextFile) {
      if (request.version !== 2 || request.informationOnly !== true || !/^[a-f0-9]{32}$/.test(request.taskId || "") || !/^[a-f0-9]{32}$/.test(request.outputId || "") || !/^[a-f0-9]{64}$/.test(request.referenceDeliveryId || "") || !/^[a-f0-9]{64}$/.test(request.referenceContextKey || "") || !Array.isArray(request.files) || request.files.length !== 1) throw new Error("原任务上下文缺失，不能推断照片归属。");
      var referenceBinding = JSON.parse(await (await folder.getEntry("code-binding.json")).read({ format: format(false) }));
      if (referenceBinding.contextKey !== request.referenceContextKey || referenceBinding.deliveryId !== request.referenceDeliveryId || referenceBinding.manifestFingerprint !== protocol().sha256(payload)) throw new Error("信息条引用与原连接不匹配。");
      await writeAtomic(folder, "context.json", JSON.stringify({ version: 1, id: request.taskId, outputId: request.outputId, mode: "electronic",
        docInfo: { id: request.sourceDocumentId, name: request.title }, template: window.IDPhotoTemplates.getTemplateById("one-inch"),
        settings: window.IDPhotoSettingsStore.load(), dateText: "" }));
      contextFile = await folder.getEntry("context.json");
    }
    var contextPayload = await contextFile.read({ format: format(false) });
    var saved = JSON.parse(contextPayload);
    if (saved.version !== 1 || saved.id !== request.taskId || saved.outputId !== request.outputId) throw new Error("原任务上下文不匹配，不能补码。");
    if (request.contextFingerprint && request.contextFingerprint !== protocol().sha256(contextPayload))
      throw new Error("原任务模板、设置或来源快照已改变，请核对，不能重试输出");
    var previousStatus = {};
    try { previousStatus = JSON.parse(await (await folder.getEntry("plugin-status.json")).read({ format: format(false) })); } catch (e) { /* Context and request remain the authority for identity. */ }
    var task = Object.assign(saved, { folder: folder, fingerprint: protocol().sha256(payload), status: previousStatus,
      contextFingerprint: request.contextFingerprint || "" });
    var binding;
    try { binding = await folder.getEntry("code-binding.json"); } catch (e) { /* Legacy tasks require a fresh backend confirmation. */ }
    if (binding) {
      var value = JSON.parse(await binding.read({ format: format(false) }));
      if (value.version !== 2 || value.taskId !== task.id || value.manifestFingerprint !== task.fingerprint || !value.contextKey || !value.deliveryId) throw new Error("原连接绑定损坏，待核对后补图。");
      task.contextKey = value.contextKey; task.deliveryId = value.deliveryId;
    }
    return task;
  }
  async function retryPending(expectedId) {
    if (creatingTask || retryingTask || activeWait) throw new Error("当前交付尚未结束，请勿重复重试");
    retryingTask = true;
    var task, temporaryFile, photo, info, failure = null;
    try {
      var item = await pending();
      if (!item || item.id !== expectedId) throw new Error("原任务已改变或已有完成信号，请重新核对；未自动重印");
      if (!await optionalEntry(item.folder, "request.json")) {
        var preparedFile = await optionalEntry(item.folder, "photo-prepared.json");
        if (!preparedFile) throw new Error("文件准备未完成，缺少可靠的独立成片记录；原文件保留，请人工核对，未新建交付");
        var prepared = JSON.parse(await preparedFile.read({ format: format(false) }));
        var savedContext = await (await item.folder.getEntry("context.json")).read({ format: format(false) });
        var saved = JSON.parse(savedContext);
        if (prepared.version !== 1 || prepared.taskId !== item.id || prepared.taskId !== saved.id ||
            prepared.outputId !== saved.outputId || prepared.contextFingerprint !== protocol().sha256(savedContext) ||
            !prepared.photo || prepared.photo.path !== "photo.jpg" || prepared.photo.role !== "photo" ||
            !["print", "electronic"].includes(saved.mode)) throw new Error("独立成片准备记录已改变，停止恢复");
        var preparedBytes = await (await item.folder.getEntry("photo.jpg")).read({ format: format(true) });
        if (prepared.photo.sizeBytes !== preparedBytes.byteLength || protocol().sha256(preparedBytes) !== prepared.photo.sha256 ||
            prepared.photo.sizeBytes > 8388608 || prepared.photo.width * prepared.photo.height > 20000000)
          throw new Error("原任务独立成片已变化或超出上限，停止恢复");
        saved.contextFingerprint = prepared.contextFingerprint;
        await writeAtomic(item.folder, "request.json", requestPayload(saved, prepared.photo), false);
      }
      task = await restoreTask(item.folder); latestTask = task;
      if (!task.contextFingerprint || !task.sourceRootToken || !task.consumerId || !task.sourceIdentity)
        throw new Error("原任务缺少可靠的快照或连接绑定，请人工核对；未自动重建交付");
      if (await optionalEntry(task.folder, "output-started.json") || await optionalEntry(task.folder, "layout.jpg") ||
          await optionalEntry(task.folder, "info.jpg"))
        throw new Error("原任务已有成品输出痕迹，请人工核对，避免重复输出或打印");
      var request = JSON.parse(await (await task.folder.getEntry("request.json")).read({ format: format(false) }));
      if (request.version !== 1 || request.mode !== task.mode || request.sourceDocumentId !== String(task.docInfo.id) ||
          !Array.isArray(request.files) || request.files.length !== 1 || request.files[0].role !== "photo" || request.files[0].path !== "photo.jpg")
        throw new Error("原任务不是可继续的单张交付，请在后台核对原记录");
      if (!["started", "awaiting-code", "blocked-code", "prepared", "retrying-code"].includes(task.status.processing))
        throw new Error("原任务尚未形成可确认的成片副本，请核对文件准备结果，未新建交付");
      var descriptor = request.files[0], file = await task.folder.getEntry(descriptor.path), bytes = await file.read({ format: format(true) });
      if (bytes.byteLength !== descriptor.sizeBytes || protocol().sha256(bytes) !== descriptor.sha256)
        throw new Error("原任务独立成片已变化，保留文件并停止重试");
      var connected = await connection(await fs().getEntryForPersistentToken(task.sourceRootToken), task.consumerId);
      if (connected.sourceIdentity !== task.sourceIdentity) throw new Error("原交接目录身份已变化，请恢复原目录");
      await status(task, { processing: "retrying-code", codeState: "unconfirmed" });
      task.code = await confirmCode(task); protocol().requirePickupCode(task.code);
      await status(task, { processing: "prepared", codeState: "confirmed" });
      // Open an owned byte-for-byte copy, never an already-open/edited original.
      var temporaryRoot = await child(await fs().getDataFolder(), "delivery-retry-temporary");
      temporaryFile = await temporaryRoot.createFile("retry-" + protocol().id() + ".jpg", { overwrite: false });
      await temporaryFile.write(bytes, { format: format(true) });
      await window.IDPhotoPhotoshopExecution.executeAsModal(async function () {
        var app = window.IDPhotoPhotoshopExecution.getPhotoshop().app;
        var existing = Array.from(app.documents).map(function (document) { return document.id; });
        var opened = await app.open(temporaryFile);
        if (!opened || existing.includes(opened.id)) throw new Error("无法确认原任务副本已独立打开，保留已有文档");
        photo = opened;
      }, "打开原任务的校验副本");
      if (pixels(photo.width) !== descriptor.width || pixels(photo.height) !== descriptor.height)
        throw new Error("原任务图片解码尺寸不符，停止输出");
      if (task.mode === "print") {
        if (!task.template || !task.template.name || !task.outputOptions) throw new Error("原排版选项快照不完整，请人工核对");
        var result = await window.IDPhotoLayoutWorkflow.create({ onStatus: notify }).run(Object.assign({}, task.outputOptions, {
          templateNames: [task.template.name], sourceDocument: photo,
          docInfo: Object.assign({}, task.docInfo, { id: photo.id, widthPx: descriptor.width, heightPx: descriptor.height }),
          delivery: true, resumeDeliveryTask: task
        }));
        if (!result.ok) throw result.failures[0].error;
        task.retryResult = result;
      } else {
        await startOutput(task);
        try { info = await standaloneInfo(task, photo, task.code); }
        catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); }
        if (info) await complete(task, info.document, info.infoBar);
        else {
          await writeCompletion(task, []);
          await status(task, { processing: "complete", message: "原成片已交接；信息条待单独重导" });
        }
      }
      return task;
    } catch (error) {
      failure = error && typeof error === "object" ? error : new Error(errorText(error));
      if (task && task.completionWritten) failure.completed = true;
      throw failure;
    } finally {
      var cleanupError = null, photoClosed = !photo;
      for (var copy of [info && info.document, photo]) {
        if (!copy) continue;
        try { await window.IDPhotoDocumentService.closeWithoutSaving(copy); if (copy === photo) photoClosed = true; }
        catch (error) { if (failure) addDiagnostic(failure, "重试临时副本未能关闭", error); else cleanupError = cleanupError || error; }
      }
      if (temporaryFile && photoClosed) {
        try { await temporaryFile.delete(); }
        catch (error) { if (failure) addDiagnostic(failure, "临时文件未能清理", error); else cleanupError = cleanupError || error; }
      }
      retryingTask = false;
      if (cleanupError && !failure) { cleanupError.completed = Boolean(task && task.completionWritten); throw cleanupError; }
    }
  }
  async function regenerate(folder) {
    if (!folder) {
      var token = window.localStorage.getItem("idphoto-delivery-last-v1");
      if (!token) throw new Error("没有可补码的原任务，请选择交接任务目录。");
      folder = await fs().getEntryForPersistentToken(token);
    }
    var task = await restoreTask(folder), code = await confirmCode(task), photo, info;
    if (!code) throw new Error("本次取件码待核对：后台未确认有效码，或交付已取消/撤回；请核对原连接与管理结果。");
    var request = JSON.parse(await (await folder.getEntry("request.json")).read({ format: format(false) }));
    if (!Array.isArray(request.files) || !request.files.length || !/^[A-Za-z0-9_-]{1,80}\.jpg$/.test(request.files[0].path)) throw new Error("原任务成片路径无效，拒绝补码。");
    var file = await folder.getEntry(request.files[0].path), bytes = await file.read({ format: format(true) });
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
  async function multi(sourceDocument, docInfo, settings, specifications, chosenTarget) {
    var rules = window.IDPhotoDeliverySpecifications;
    var specs = rules.normalize(specifications, { width: pixels(sourceDocument.width), height: pixels(sourceDocument.height) });
    var target = chosenTarget ? rules.target(chosenTarget) : null;
    var task = await begin(docInfo, "electronic", window.IDPhotoTemplates.getTemplateById("one-inch"), settings);
    var execution = window.IDPhotoPhotoshopExecution, copy = null, originalId = sourceDocument.id;
    try {
      // Retain a full quality independent copy before attempting constrained encodes.
      await saveJpeg(task, sourceDocument, "source-preserved.jpg", "原尺寸保留");
      var files = [];
      for (var index = 0; index < specs.length; index++) {
        var spec = specs[index], file = await task.folder.createFile("variant-" + (index + 1) + ".jpg", { overwrite: false }), encoded = null, chosenQuality = 0;
        try {
          await execution.executeAsModal(async function () {
            var before = Array.from(execution.getPhotoshop().app.documents).map(function (d) { return d.id; });
            await execution.activateDocument(sourceDocument);
            var duplicate = await sourceDocument.duplicate("交付规格_" + task.id + "_" + index);
            if (!duplicate || duplicate.id === originalId || before.indexOf(duplicate.id) !== -1) throw new Error("未取得独立规格副本，保留原文档。");
            copy = duplicate;
            await execution.activateDocument(copy);
            if (pixels(copy.width) !== spec.width || pixels(copy.height) !== spec.height) await copy.resizeImage(spec.width, spec.height, Number(sourceDocument.resolution) || 300);
          }, "创建独立规格照片");
          for (var quality = 12; quality >= spec.minQuality; quality--) {
            await execution.executeAsModal(async function () {
              await execution.activateDocument(copy);
              await copy.saveAs.jpg(file, { quality: quality }, true);
            }, "按确认品质范围编码 JPG");
            var bytes = await file.read({ format: format(true) });
            if (rules.verify(bytes, spec)) { encoded = bytes; chosenQuality = quality; break; }
          }
          if (!encoded) throw new Error(spec.filename + "：在确认像素、大小和最低品质内无法生成；原尺寸副本已保留，未提交本批。");
          var constraints = { width: spec.width, height: spec.height, maxBytes: spec.maxBytes };
          if (spec.minBytes) constraints.minBytes = spec.minBytes;
          files.push({ path: file.name, role: "photo", filename: spec.filename, purpose: spec.purpose, background: spec.background,
            width: spec.width, height: spec.height, sizeBytes: encoded.byteLength, sha256: protocol().sha256(encoded), constraints: constraints, encodedQuality: chosenQuality });
        } finally { if (copy) { await window.IDPhotoDocumentService.closeWithoutSaving(copy); copy = null; } }
      }
      var request = { version: 2, taskId: task.id, outputId: task.outputId, sourceDocumentId: String(docInfo.id), mode: "electronic",
        title: String(docInfo.name || "多规格照片").slice(0, 120), eligible: true, testOnly: true, files: files };
      if (target) { request.targetDeliveryId = target.deliveryId; request.targetContextKey = target.contextKey; request.targetGroupVersion = target.groupVersion; request.newMember = true; }
      var payload = JSON.stringify(request); task.fingerprint = protocol().sha256(payload);
      await writeAtomic(task.folder, "request.json", payload);
      await writeCompletion(task, []);
      await status(task, { processing: "draft", info: "pending-confirmation", message: "多规格草稿已交接，请在后台核对并点击完成交付；之后可补出同款信息条。", outputDirectory: task.folder.nativePath });
      return task;
    } catch (error) { await status(task, { processing: "failed", error: errorText(error), message: "原件与独立副本保留，失败的整批不会交付。" }); throw error; }
    finally { await execution.activateDocument(sourceDocument); }
  }
  window.IDPhotoDeliveryService = { begin: begin, prepare: prepare, complete: complete, electronic: electronic, multi: multi, regenerate: regenerate,
    pending: pending, retryPending: retryPending, deferPending: deferPending, startOutput: startOutput,
    stopWaiting: function () { if (!activeWait) return false; activeWait.cancelled = true; return true; },
    configure: configure, root: root, connection: connection, onProgress: function (handler) { progress = typeof handler === "function" ? handler : function () {}; },
    onWaitingChanged: function (handler) { waitingChanged = typeof handler === "function" ? handler : function () {}; },
    status: status, readCode: readCode, latest: function () { return latestTask; } };
})();
