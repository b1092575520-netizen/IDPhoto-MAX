(function () {
  "use strict";
  var TOKEN = "idphoto-delivery-root-v1";
  var PENDING = "idphoto-delivery-pending-v1";
  var CURRENT = "idphoto-delivery-current-v1";
  var CURRENT_MIGRATION = "idphoto-delivery-current-migrated-v1";
  var CONNECTION_PROTOCOL = "pickup-handoff-compat-1";
  // The measured test-cloud confirmation was 3.003s. Allow one missed
  // filesystem event (10s rescan) and one 45s HTTP request, with bounded margin.
  // This is an attempt budget, not a promise that the cloud will respond.
  var CODE_WAIT_MS = 60000;
  // 10-17: one coded save waited three times for the same code (33 s of 56 s). A code
  // confirmed within two minutes, with no companion change since, is not asked again.
  var CODE_FRESH_MS = 120000;
  // A recovered print reuses the code its recovery confirmed for this long.
  var RECOVERED_CODE_REUSE_MS = 10 * 60 * 1000;
  // The delivery manager looks at a finished delivery's code request at least once a minute.
  var REPRINT_CODE_WAIT_MS = 90000;
  // Archive and customer photos (user 2026-10-17): 10 looks the same and is about half the size.
  var SAVE_JPEG_QUALITY = 10;
  var latestTask = null;
  var creatingTask = false, retryingTask = false, activeWait = null;
  var preparingTask = null;
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
    if (window.localStorage.getItem(CURRENT) === item.token) window.localStorage.setItem(CURRENT, "");
  }
  async function current() {
    if (window.localStorage.getItem(CURRENT_MIGRATION) !== "1") {
      var previous = window.localStorage.getItem(PENDING) || window.localStorage.getItem("idphoto-delivery-last-v1");
      if (previous && !window.localStorage.getItem(CURRENT)) window.localStorage.setItem(CURRENT, previous);
      window.localStorage.setItem(CURRENT_MIGRATION, "1");
    }
    var token = window.localStorage.getItem(CURRENT);
    if (!token) return null;
    var folder = await fs().getEntryForPersistentToken(token);
    if (!folder) throw new Error("当前顾客的原任务目录不可用，请恢复目录或明确开始下一位");
    var context = JSON.parse(await (await folder.getEntry("context.json")).read({ format: format(false) }));
    if (context.version !== 1 || context.id !== folder.name || !/^[a-f0-9]{32}$/.test(context.id))
      throw new Error("当前顾客绑定损坏，保留资料，请核对原任务");
    var requestFile = await optionalEntry(folder, "request.json");
    var batch = requestFile ? JSON.parse(await requestFile.read({ format: format(false) })).version === 2 : false;
    return { id: context.id, name: context.docInfo && context.docInfo.name || "原照片", mode: context.mode, batch: batch,
      token: token, folder: folder, completed: Boolean(await optionalEntry(folder, "complete.json")) };
  }
  async function nextCustomer(expectedId) {
    if (creatingTask || retryingTask || activeWait) throw new Error("当前交付尚未结束，请先停止等待或完成操作");
    var item = await current();
    if (!item || item.id !== expectedId) throw new Error("当前顾客已改变，请重新核对");
    var unfinished = await pending();
    if (unfinished && unfinished.id === expectedId) await deferPending(expectedId);
    window.localStorage.setItem(CURRENT, "");
    // The original folder, binding and output journals remain intact.
  }
  async function chooseCurrent() {
    if (creatingTask || retryingTask || activeWait) throw new Error("当前交付尚未结束");
    if (await current() || await pending()) throw new Error("请先明确开始下一位，再选择其他原任务");
    var folder = await fs().getFolder(); if (!folder) return null;
    var task = await restoreTask(folder);
    if (folder.name !== task.id || !task.contextFingerprint || !task.sourceRootToken)
      throw new Error("所选目录不是可恢复的原交付任务");
    await originalPhoto(task);
    window.localStorage.setItem(CURRENT, await fs().createPersistentToken(folder));
    return await current();
  }
  async function originalPhoto(task) {
    var request = JSON.parse(await (await task.folder.getEntry("request.json")).read({ format: format(false) }));
    if (![1, 3].includes(request.version) || request.mode !== task.mode || request.sourceDocumentId !== String(task.docInfo.id) ||
        !Array.isArray(request.files) || request.files.length !== 1 || request.files[0].role !== "photo" || request.files[0].path !== "photo.jpg")
      throw new Error("原任务不是可继续的单张交付；多规格和修订请在后台核对原记录");
    var descriptor = request.files[0], file = await task.folder.getEntry(descriptor.path);
    var bytes = await file.read({ format: format(true) });
    if (bytes.byteLength !== descriptor.sizeBytes || protocol().sha256(bytes) !== descriptor.sha256)
      throw new Error("原任务独立成片已变化，保留文件并停止输出");
    return { descriptor: descriptor, bytes: bytes };
  }
  async function currentPreview(expectedId) {
    var item = await current();
    if (!item || item.id !== expectedId) throw new Error("当前顾客已改变，请重新核对");
    var task = await restoreTask(item.folder), original;
    if (item.batch) {
      var request = JSON.parse(await (await task.folder.getEntry("request.json")).read({ format: format(false) }));
      var first = request.files && request.files[0];
      if (!first || first.role !== "photo" || !/^variant-\d+\.jpg$/.test(first.path)) throw new Error("多规格原照片记录无效");
      var data = await (await task.folder.getEntry(first.path)).read({ format: format(true) });
      if (data.byteLength !== first.sizeBytes || protocol().sha256(data) !== first.sha256) throw new Error("多规格原照片已变化");
      original = { bytes: data };
    } else original = await originalPhoto(task);
    var bytes = new Uint8Array(original.bytes);
    if (bytes.length > 8388608) throw new Error("原成片过大，请在后台核对");
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", chunks = [], part = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var value = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      part += alphabet[value >>> 18] + alphabet[(value >>> 12) & 63] +
        (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : "=") + (i + 2 < bytes.length ? alphabet[value & 63] : "=");
      if (part.length >= 16384) { chunks.push(part); part = ""; }
    }
    return "data:image/jpeg;base64," + chunks.join("") + part;
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
    var unavailable = new Error("交接尚未连通：请打开配套照片交付管理并连接当前插件。尚不能确认是后台未启动还是目录不一致。");
    unavailable.code = "CONNECTION_PENDING"; unavailable.retryable = true; throw unavailable;
  }
  async function status(task, values) {
    task.status = Object.assign({}, task.status, values, { taskId: task.id, at: new Date().toISOString() });
    await writeAtomic(task.folder, "plugin-status.json", JSON.stringify(task.status));
  }
  async function begin(docInfo, mode, template, settings, intent, outputOptions) {
    if (creatingTask || retryingTask) throw new Error("当前交付正在准备，请勿重复执行");
    creatingTask = true;
    try {
    var automation = window.IDPhotoDeliveryAutomationService;
    if (!automation) {
      var unfinished = await pending();
      if (unfinished) throw new Error("有尚未完成的原任务，请使用“继续原任务”重试；当前若是另一位顾客，请先明确保留旧任务。未新建交付。");
      if (await current()) throw new Error("当前顾客已有交付，请核对原照片后使用“重拼/补印”；另一位顾客请先点“开始下一位”。照片修订请走后台原交付修订流程，未新建交付。");
    }
    var eligibility = window.IDPhotoSourceEligibilityService.checkSource(docInfo.sourceMetadata, docInfo.name);
    var historical = !eligibility.eligible && window.IDPhotoSourceEligibilityService.historicalIntentMatches &&
      window.IDPhotoSourceEligibilityService.historicalIntentMatches(intent, docInfo);
    if (!eligibility.eligible && !historical) throw new Error("此照片仅排版；如需补交，请明确确认本次本店旧片：" + eligibility.message);
    var automaticPlan = automation ? automation.plan(docInfo, mode, template, historical) : null;
    if (automaticPlan && automaticPlan.kind === "plain") throw new Error(automaticPlan.text);
    if (automaticPlan && automaticPlan.existing) {
      var existingError = new Error("同一原片已有未完成任务，保留原字节继续处理；完成后可再次排版替换");
      existingError.code = "AUTO_TASK_PENDING";
      throw existingError;
    }
    var sourceRoot = await root(), connected = automation ? { consumerId: "", sourceIdentity: "" } : await connection(sourceRoot);
    var id = protocol().id(), output = protocol().id(), folders = window.IDPhotoPathService.getDateFolders();
    var folder = await child(await child(await child(sourceRoot, folders.year), folders.month), folders.day);
    folder = await folder.createFolder(id);
    var task = { id: id, outputId: output, folder: folder, docInfo: JSON.parse(JSON.stringify(docInfo)), mode: mode,
      template: JSON.parse(JSON.stringify(template)), settings: JSON.parse(JSON.stringify(settings)), historical: Boolean(historical),
      consumerId: connected.consumerId, sourceIdentity: connected.sourceIdentity, sourceRoot: sourceRoot.nativePath,
      code: "", fingerprint: "", status: {} };
    if (automaticPlan) task.automation = automaticPlan;
    task.sourceRootToken = await fs().createPersistentToken(sourceRoot);
    task.outputOptions = outputSnapshot(outputOptions);
    task.dateText = historical ? window.IDPhotoSourceEligibilityService.captureDateText(docInfo.sourceMetadata) : window.IDPhotoDateService.formatDisplayDate();
    var context = JSON.stringify({ version: 1, id: id, outputId: output, docInfo: task.docInfo, mode: mode,
      template: task.template, settings: task.settings, historical: task.historical, dateText: task.dateText,
      consumerId: task.consumerId, sourceIdentity: task.sourceIdentity, sourceRoot: task.sourceRoot,
      sourceRootToken: task.sourceRootToken, outputOptions: task.outputOptions, automation: task.automation || null });
    task.contextFingerprint = protocol().sha256(context);
    await writeAtomic(folder, "context.json", context);
    var taskToken = await fs().createPersistentToken(folder);
    if (automation) {
      automation.created(task, taskToken);
      if (automation.store().group().on) automation.store().touchGroup();
    }
    window.localStorage.setItem(PENDING, taskToken);
    window.localStorage.setItem(CURRENT, taskToken);
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
      await documentRef.saveAs.jpg(file, { quality: SAVE_JPEG_QUALITY }, true);
    }, "保存独立" + role + "副本");
    var bytes = await file.read({ format: format(true) });
    return { path: name, role: role, sha256: protocol().sha256(bytes), sizeBytes: bytes.byteLength, width: width, height: height };
  }
  async function archivePhoto(task, template) {
    // Never resave or reinterpret an in-flight task. Only exact dimensions may
    // reuse its immutable JPEG; legacy high-resolution tasks use normal export.
    var payload = await (await task.folder.getEntry("request.json")).read({ format: format(false) });
    if (protocol().sha256(payload) !== task.fingerprint) throw new Error("原交付清单变化，停止归档");
    var request = JSON.parse(payload);
    var descriptor = request.files[task.archiveOrdinal || 0];
    if (!descriptor || descriptor.role !== "photo") throw new Error("原任务规格照片缺失");
    var file = await task.folder.getEntry(descriptor.path), bytes = await file.read({ format: format(true) });
    if (bytes.byteLength !== descriptor.sizeBytes || protocol().sha256(bytes) !== descriptor.sha256)
      throw new Error("原交付照片变化，停止归档");
    return descriptor.width === template.widthPx && descriptor.height === template.heightPx ? bytes : null;
  }
  function requestPayload(task, photo) {
    var request = { version: 1, taskId: task.id, outputId: task.outputId, sourceDocumentId: String(task.docInfo.id), mode: task.mode,
      title: String(task.docInfo.name || "电子成片").slice(0, 120), eligible: true, testOnly: true,
      contextFingerprint: task.contextFingerprint, files: [photo] };
    if (task.historical) request.sourceConfirmation = { kind: "historical-shop", sourceDocumentId: String(task.docInfo.id),
      confirmed: true, noExistingDelivery: true, captureDate: task.dateText };
    return JSON.stringify(request);
  }
  async function preparedPayload(task, photo) {
    if (!task.automation) return requestPayload(task, photo);
    var request = await window.IDPhotoDeliveryAutomationService.resolve(task, photo);
    await writeAtomic(task.folder, "automation-connection.json", JSON.stringify({ version: 1, taskId: task.id,
      contextFingerprint: task.contextFingerprint, consumerId: task.consumerId, sourceIdentity: task.sourceIdentity }));
    return JSON.stringify(request);
  }
  // Photoshop work: the saved-size JPEG. The code request after it needs no modal
  // scope, so the layout can build its sheet while the delivery manager answers.
  async function savePhoto(task, documentRef) {
    var photo = await saveJpeg(task, documentRef, "photo.jpg", "photo");
    // New layout tasks hand off the selected specification JPEG; old tasks retain their original bytes.
    if (photo.sizeBytes > 8388608 || photo.width * photo.height > 20000000) {
      await status(task, { processing: "retained-over-limit", error: "成片超过当前 8 MiB / 20MP 上限，已保留，需人工处理" });
      throw new Error(task.status.error);
    }
    await writeAtomic(task.folder, "photo-prepared.json", JSON.stringify({ version: 1, taskId: task.id,
      outputId: task.outputId, contextFingerprint: task.contextFingerprint, photo: photo }), false);
    return photo;
  }
  async function prepare(task, documentRef) {
    return await requestCode(task, await savePhoto(task, documentRef));
  }
  async function requestCode(task, photo) {
    preparingTask = task;
    try {
    var payload = await preparedPayload(task, photo); task.fingerprint = protocol().sha256(payload);
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
    } finally { if (preparingTask === task) preparingTask = null; }
  }
  // The delivery manager rejects a manifest once and for all in receipt.json; asking
  // again with the same manifest can never succeed, so stop instead of waiting.
  async function readRejection(task) {
    try {
      var receipt = JSON.parse(await (await task.folder.getEntry("receipt.json")).read({ format: format(false) }));
      if (receipt && receipt.taskId === task.id && task.fingerprint && receipt.manifestFingerprint === task.fingerprint &&
          receipt.accepted === false && receipt.status === "rejected")
        return String(receipt.error || "原因不明").slice(0, 300);
    } catch (missing) { /* no receipt yet */ }
    return "";
  }
  async function readCode(task) {
    var receipt;
    try {
      receipt = JSON.parse(await (await task.folder.getEntry("code-response.json")).read({ format: format(false) }));
    }
    catch (e) {
      var rejectedEarly = await readRejection(task);
      if (rejectedEarly) { task.confirmationFailure = "交付管理拒收了这单：" + rejectedEarly; task.confirmationRejected = true; }
      return "";
    }
    var code = protocol().confirmedCode(receipt, task);
    if (code) {
      task.contextKey = receipt.contextKey; task.deliveryId = receipt.deliveryId; task.code = code;
      if (task.automation) window.IDPhotoDeliveryAutomationService.confirmed(task);
      task.codeConfirmedAt = Date.now(); task.codeGroupStamp = groupStamp();
      return code;
    }
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
    if (!task.confirmationFailure) {
      var rejected = await readRejection(task);
      if (rejected) { task.confirmationFailure = "交付管理拒收了这单：" + rejected; task.confirmationRejected = true; }
    }
    return "";
  }
  // Companion (同行) choices and merges are the plugin-side events that can move a
  // customer to another delivery code.
  function groupStamp() {
    var automation = window.IDPhotoDeliveryAutomationService;
    if (!automation || !automation.store) return "";
    var group = automation.store().group(), merge = automation.store().mergeIntent();
    return JSON.stringify([group.on, group.sessionId, group.code, group.members.slice().sort(), merge && merge.operationId || ""]);
  }
  function freshCode(task, expectedCode) {
    return Boolean(task.code === expectedCode && protocol().isPickupCode(expectedCode) && task.codeConfirmedAt &&
      Date.now() - task.codeConfirmedAt >= 0 && Date.now() - task.codeConfirmedAt < CODE_FRESH_MS && task.codeGroupStamp === groupStamp());
  }
  async function confirmCode(task, waitMs) {
    if (activeWait) throw new Error("已有取码请求正在等待，请勿重复重试");
    waitMs = waitMs || CODE_WAIT_MS;
    notify("正在等待后台核对云端并获取取件码，最多 " + Math.round(waitMs / 1000) + " 秒；可停止等待并保留原任务");
    task.code = ""; task.confirmationId = protocol().id(); task.confirmationFailure = ""; task.confirmationRejected = false;
    var attempt = { cancelled: false, requestId: task.confirmationId, taskId: task.id, automation: Boolean(task.automation) };
    activeWait = attempt;
    waitingChanged(true);
    try {
    await writeAtomic(task.folder, "code-request.json", JSON.stringify({ version: 2, taskId: task.id, manifestFingerprint: task.fingerprint,
      requestId: task.confirmationId, contextKey: task.contextKey || "", deliveryId: task.deliveryId || "" }));
    var deadline = Date.now() + waitMs, code = "";
    while (Date.now() < deadline) {
      if (attempt.cancelled) throw protocol().pickupCodeError("已停止本机等待；原任务保留，不代表云端取消");
      code = await readCode(task);
      if (attempt.cancelled) throw protocol().pickupCodeError("已停止本机等待；原任务保留，不代表云端取消");
      if (Date.now() >= deadline) { code = ""; break; }
      if (code) break;
      if (task.confirmationFailure) {
        var confirmationError = protocol().pickupCodeError(task.confirmationFailure + "，取件码待核对");
        if (task.confirmationRejected) confirmationError.retryable = false;
        throw confirmationError;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
    if (attempt.cancelled) throw protocol().pickupCodeError("已停止本机等待；原任务保留，不代表云端取消");
    if (!code) throw protocol().pickupCodeError("取码超时：交付管理 " + Math.round(waitMs / 1000) + " 秒内没给取件码");
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
    var marker = task.outputAttemptId ? "output-started-" + task.outputAttemptId + ".json" : "output-started.json";
    if (await optionalEntry(task.folder, marker))
      throw new Error("原任务已开始过成品输出，请人工核对原成品与打印状态；不会重复执行");
    await writeAtomic(task.folder, marker, JSON.stringify({ version: 1, taskId: task.id, outputAttemptId: task.outputAttemptId || "",
      manifestFingerprint: task.fingerprint, requestId: task.confirmationId, at: new Date().toISOString() }), false);
  }
  async function writeCompletion(task, artifacts) {
    var payload = JSON.stringify({ version: 1, taskId: task.id,
      manifestFingerprint: task.fingerprint, processingComplete: true, artifacts: artifacts });
    if (task.outputAttemptId) await writeAtomic(task.folder, "output-complete-" + task.outputAttemptId + ".json", payload, false);
    if (!task.outputAttemptId || !await optionalEntry(task.folder, "complete.json"))
      await writeAtomic(task.folder, "complete.json", payload, false);
    task.completionWritten = true;
    if (task.automation) {
      try { window.IDPhotoDeliveryAutomationService.completed(task); }
      catch (error) { task.pendingReleaseError = "完成信号已保存，自动任务索引待核对：" + errorText(error); }
    }
    try { await clearPending(task); }
    catch (error) { task.pendingReleaseError = "完成信号已保存，待处理入口未能清除：" + errorText(error); }
  }
  async function complete(task, targetDocument, infoBar) {
    protocol().requirePickupCode(task.code);
    if (!task.fingerprint) throw new Error("高清成片尚未可靠交接，未生成发布完成信号。");
    var artifacts = [];
    var suffix = task.outputAttemptId ? "-" + task.outputAttemptId : "";
    if (task.mode === "print") artifacts.push(await saveJpeg(task, targetDocument, "layout" + suffix + ".jpg", "layout"));
    try { artifacts.push(await cropInfo(task, targetDocument, infoBar, "info" + suffix + ".jpg")); await status(task, { info: "saved" }); }
    catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); }
    await writeCompletion(task, artifacts);
    await status(task, { processing: "complete", message: "处理完成，等待后台确认发布", outputDirectory: task.folder.nativePath });
    return task.status;
  }
  async function verifyOutput(task, expectedCode) {
    if (freshCode(task, expectedCode)) return expectedCode;
    var code = await confirmCode(task);
    if (code !== expectedCode) throw protocol().pickupCodeError("排版期间取件码已变化，已停止本次成品输出；请核对后主动重拼原任务");
    task.code = code;
    return code;
  }
  function localInfoBar(template) {
    var bar = JSON.parse(JSON.stringify(template.infoBar)), x = bar.x, y = bar.y;
    bar.x = 0; bar.y = 0;
    if (bar.avatar) { bar.avatar.x -= x; bar.avatar.y -= y; }
    if (Array.isArray(bar.texts)) bar.texts.forEach(function (item) { item.x -= x; item.y -= y; });
    return bar;
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
    if (window.IDPhotoTemplates.forDelivery) template = window.IDPhotoTemplates.forDelivery(template, true);
    if (window.IDPhotoDeliveryAutomationService && window.IDPhotoVariantService)
      docInfo = Object.assign({}, docInfo, { sourceVariant: await window.IDPhotoVariantService.analyzeDocument(sourceDocument) });
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
      await verifyOutput(task, task.code);
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
        if (task.automation && !task.completionWritten) window.IDPhotoDeliveryAutomationService.failure(task, failure);
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
  async function restoreTask(folder, informationInput) {
    var payload = await (await folder.getEntry("request.json")).read({ format: format(false) });
    var request = JSON.parse(payload);
    if (request.informationOnly && (!/^[a-f0-9]{64}$/.test(request.referenceFileId || "") || !Number.isInteger(request.referenceRevision) || request.referenceRevision < 1)) throw new Error("信息条缺少原文件版本绑定，请在后台重新导出任务。");
    var contextFile;
    try { contextFile = await folder.getEntry("context.json"); } catch (_) { /* Explicit backend information-only tasks acquire rendering context on first use. */ }
    if (!contextFile) {
      if (request.version !== 2 || request.informationOnly !== true || !/^[a-f0-9]{32}$/.test(request.taskId || "") || !/^[a-f0-9]{32}$/.test(request.outputId || "") || !/^[a-f0-9]{64}$/.test(request.referenceDeliveryId || "") || !/^[a-f0-9]{64}$/.test(request.referenceContextKey || "") || !Array.isArray(request.files) || request.files.length !== 1) throw new Error("原任务上下文缺失，不能推断照片归属。");
      var referenceBinding = JSON.parse(await (await folder.getEntry("code-binding.json")).read({ format: format(false) }));
      if (referenceBinding.contextKey !== request.referenceContextKey || referenceBinding.deliveryId !== request.referenceDeliveryId || referenceBinding.manifestFingerprint !== protocol().sha256(payload)) throw new Error("信息条引用与原连接不匹配。");
      var referenceTemplate = window.IDPhotoTemplates.getTemplateById("one-inch");
      if (window.IDPhotoTemplates.forDelivery) referenceTemplate = window.IDPhotoTemplates.forDelivery(referenceTemplate, true);
      await writeAtomic(folder, "context.json", JSON.stringify({ version: 1, id: request.taskId, outputId: request.outputId, mode: "electronic",
        docInfo: { id: request.sourceDocumentId, name: request.title }, template: referenceTemplate,
        settings: window.IDPhotoSettingsStore.load(), dateText: informationInput && /^\d{4}\.\d{1,2}\.\d{1,2}$/.test(informationInput.dateText || "") ? informationInput.dateText : "" }));
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
    if (task.automation) {
      var automaticConnection = JSON.parse(await (await folder.getEntry("automation-connection.json")).read({ format: format(false) }));
      if (automaticConnection.version !== 1 || automaticConnection.taskId !== task.id || automaticConnection.contextFingerprint !== task.contextFingerprint)
        throw new Error("自动交付原连接绑定已改变");
      task.consumerId = automaticConnection.consumerId; task.sourceIdentity = automaticConnection.sourceIdentity;
    }
    var binding;
    try { binding = await folder.getEntry("code-binding.json"); } catch (e) { /* Legacy tasks require a fresh backend confirmation. */ }
    if (binding) {
      var value = JSON.parse(await binding.read({ format: format(false) }));
      if (value.version !== 2 || value.taskId !== task.id || value.manifestFingerprint !== task.fingerprint || !value.contextKey || !value.deliveryId) throw new Error("原连接绑定损坏，待核对后补图。");
      task.contextKey = value.contextKey; task.deliveryId = value.deliveryId;
    }
    return task;
  }
  async function retryPending(expectedId, reprint, recovery) {
    if (creatingTask || retryingTask || activeWait) throw new Error("当前交付尚未结束，请勿重复重试");
    retryingTask = true;
    var task, temporaryFile, photo, info, failure = null;
    try {
      var indexed = recovery && window.IDPhotoDeliveryAutomationService.store().tasks().find(function (record) { return record.id === expectedId; });
      var item = indexed ? { id: indexed.id, folder: await fs().getEntryForPersistentToken(indexed.token) } : reprint ? await current() : await pending();
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
        saved.folder = item.folder;
        await writeAtomic(item.folder, "request.json", await preparedPayload(saved, prepared.photo), false);
      }
      task = await restoreTask(item.folder); latestTask = task;
      if (!task.contextFingerprint || !task.sourceRootToken || !task.consumerId || !task.sourceIdentity)
        throw new Error("原任务缺少可靠的快照或连接绑定，请人工核对；未自动重建交付");
      if (!reprint && (await optionalEntry(task.folder, "output-started.json") || await optionalEntry(task.folder, "layout.jpg") ||
          await optionalEntry(task.folder, "info.jpg")))
        throw new Error("原任务已有成品输出痕迹，请人工核对，避免重复输出或打印");
      var request = JSON.parse(await (await task.folder.getEntry("request.json")).read({ format: format(false) }));
      if (![1, 3].includes(request.version) || request.mode !== task.mode || request.sourceDocumentId !== String(task.docInfo.id) ||
          !Array.isArray(request.files) || request.files.length !== 1 || request.files[0].role !== "photo" || request.files[0].path !== "photo.jpg")
        throw new Error("原任务不是可继续的单张交付，请在后台核对原记录");
      if (!reprint && !["started", "awaiting-code", "blocked-code", "prepared", "retrying-code"].includes(task.status.processing))
        throw new Error("原任务尚未形成可确认的成片副本，请核对文件准备结果，未新建交付");
      var descriptor = request.files[0], file = await task.folder.getEntry(descriptor.path), bytes = await file.read({ format: format(true) });
      if (bytes.byteLength !== descriptor.sizeBytes || protocol().sha256(bytes) !== descriptor.sha256)
        throw new Error("原任务独立成片已变化，保留文件并停止重试");
      var connected = await connection(await fs().getEntryForPersistentToken(task.sourceRootToken), task.consumerId);
      if (connected.sourceIdentity !== task.sourceIdentity) throw new Error("原交接目录身份已变化，请恢复原目录");
      await status(task, { processing: "retrying-code", codeState: "unconfirmed" });
      if (recovery && recovery.confirmedTask && recovery.confirmedTask.id === task.id && recovery.confirmedTask.fingerprint === task.fingerprint)
        task = Object.assign(task, { code: recovery.confirmedTask.code, confirmationId: recovery.confirmedTask.confirmationId,
          codeConfirmedAt: recovery.confirmedTask.codeConfirmedAt, codeGroupStamp: recovery.confirmedTask.codeGroupStamp });
      else task.code = await confirmCode(task, recovery && recovery.codeWaitMs);
      protocol().requirePickupCode(task.code);
      if (reprint) task.outputAttemptId = protocol().id();
      if (window.IDPhotoTemplates.forDelivery && task.template && task.template.id) {
        var currentTemplate = window.IDPhotoTemplates.getTemplateById(task.template.id);
        if (!currentTemplate) throw new Error("原模板已不存在，请人工核对");
        task.template = window.IDPhotoTemplates.forDelivery(currentTemplate, true);
      }
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
        var recoveredOptions = recovery && !recovery.manualPrint ? { quickPrint: false, skipPrint: true, closeAfterPrint: false } : {};
        var result = await window.IDPhotoLayoutWorkflow.create({ onStatus: notify }).run(Object.assign({}, task.outputOptions, recoveredOptions, {
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
        await verifyOutput(task, task.code);
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
      if (task && task.automation && !task.completionWritten) window.IDPhotoDeliveryAutomationService.failure(task, failure);
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
  async function reprintCurrent(expectedId, confirmedOriginal) {
    if (confirmedOriginal !== true) throw new Error("请核对原照片并确认补印；不会采用当前活动照片替换原成片");
    return await retryPending(expectedId, true);
  }
  async function previewTask(expectedId, token) {
    var folder = await fs().getEntryForPersistentToken(token), task = await restoreTask(folder);
    if (task.id !== expectedId) throw new Error("所选原任务身份已变化");
    var photo = await originalPhoto(task), bytes = new Uint8Array(photo.bytes), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", chunks = [], part = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var value = bytes[i] << 16 | (bytes[i + 1] || 0) << 8 | (bytes[i + 2] || 0);
      part += alphabet[value >>> 18] + alphabet[value >>> 12 & 63] + (i + 1 < bytes.length ? alphabet[value >>> 6 & 63] : "=") + (i + 2 < bytes.length ? alphabet[value & 63] : "=");
      if (part.length >= 16384) { chunks.push(part); part = ""; }
    }
    return "data:image/jpeg;base64," + chunks.join("") + part;
  }
  var primedTask = null;
  async function primeRecovery() {
    if (creatingTask || retryingTask || activeWait) return null;
    var automation = window.IDPhotoDeliveryAutomationService;
    var item = automation.store().pendingTasks().sort(function (a, b) { return a.updatedAt - b.updatedAt; })[0];
    if (!item) return null;
    var folder, task;
    try {
      try { folder = await fs().getEntryForPersistentToken(item.token); }
      catch (_) { var missing = new Error("原任务目录不可用，保留记录，请恢复原目录后人工核对"); missing.retryable = false; throw missing; }
      if (!folder) { var invalid = new Error("原任务目录不可用，保留记录，请恢复原目录后人工核对"); invalid.retryable = false; throw invalid; }
      if (!await optionalEntry(folder, "request.json")) {
        var contextPayload = await (await folder.getEntry("context.json")).read({ format: format(false) });
        var saved = JSON.parse(contextPayload);
        var prepared = JSON.parse(await (await folder.getEntry("photo-prepared.json")).read({ format: format(false) }));
        if (saved.id !== item.id || prepared.taskId !== item.id || prepared.outputId !== saved.outputId ||
            prepared.contextFingerprint !== protocol().sha256(contextPayload) || !prepared.photo || prepared.photo.path !== "photo.jpg")
          throw new Error("原任务准备记录已变化，停止自动恢复");
        var bytes = await (await folder.getEntry("photo.jpg")).read({ format: format(true) });
        if (bytes.byteLength !== prepared.photo.sizeBytes || protocol().sha256(bytes) !== prepared.photo.sha256)
          throw new Error("原任务成片已变化，停止自动恢复");
        saved.folder = folder; saved.contextFingerprint = prepared.contextFingerprint;
        await writeAtomic(folder, "request.json", await preparedPayload(saved, prepared.photo), false);
      }
      task = await restoreTask(folder);
      if (await optionalEntry(folder, "complete.json")) {
        var completion = JSON.parse(await (await folder.getEntry("complete.json")).read({ format: format(false) }));
        if (!completion.processingComplete || completion.taskId !== item.id || completion.manifestFingerprint !== task.fingerprint)
          throw new Error("原任务完成信号不匹配，停止自动恢复");
        automation.completed(task); return null;
      }
      if (await optionalEntry(folder, "output-started.json")) throw new Error("原任务已有输出痕迹，请人工核对，避免重复打印");
      await originalPhoto(task);
      var rejected = await readRejection(task);
      if (rejected) {
        // Rejected for good: park it instead of asking again every few minutes.
        automation.store().markTask(task.id, { state: "blocked", error: "交付管理拒收了这单：" + rejected });
        return null;
      }
      var codeRequest = await optionalEntry(folder, "code-request.json"), existing;
      if (codeRequest) existing = JSON.parse(await codeRequest.read({ format: format(false) }));
      var automaticWaitFile = await optionalEntry(folder, "automatic-code-wait.json"), automaticWait;
      if (automaticWaitFile) automaticWait = JSON.parse(await automaticWaitFile.read({ format: format(false) }));
      if (!existing || existing.taskId !== task.id || existing.manifestFingerprint !== task.fingerprint ||
          !automaticWait || automaticWait.requestId !== existing.requestId || !Number.isFinite(automaticWait.at) ||
          Date.now() < automaticWait.at || Date.now() - automaticWait.at >= CODE_WAIT_MS) {
        task.confirmationId = protocol().id();
        await writeAtomic(folder, "code-request.json", JSON.stringify({ version: 2, taskId: task.id, manifestFingerprint: task.fingerprint,
          requestId: task.confirmationId, contextKey: task.contextKey || "", deliveryId: task.deliveryId || "" }));
        await writeAtomic(folder, "automatic-code-wait.json", JSON.stringify({ version: 1, taskId: task.id, requestId: task.confirmationId, at: Date.now() }));
      } else task.confirmationId = existing.requestId;
      task.code = await readCode(task);
      if (!task.code) {
        if (task.confirmationFailure) {
          var response = JSON.parse(await (await folder.getEntry("code-response.json")).read({ format: format(false) }));
          if (["NETWORK", "TIMEOUT"].includes(response.errorCode)) {
            await writeAtomic(folder, "code-request.json", JSON.stringify({ version: 2, taskId: task.id, manifestFingerprint: task.fingerprint,
              requestId: protocol().id(), contextKey: task.contextKey || "", deliveryId: task.deliveryId || "" }));
          } else throw new Error(task.confirmationFailure);
        }
        automation.store().markTask(task.id, { state: "retryable" }); return null;
      }
      primedTask = task;
      return task.id;
    } catch (error) {
      automation.failure(task || { id: item.id, automation: true }, error);
      return { id: item.id, text: errorText(error), canPrint: false };
    }
  }
  async function recoverNext(expectedId) {
    if (creatingTask || retryingTask || activeWait || !primedTask || primedTask.id !== expectedId) return null;
    var taskToResume = primedTask; primedTask = null;
    var automation = window.IDPhotoDeliveryAutomationService, item = automation.store().tasks().find(function (record) { return record.id === expectedId; });
    if (!item || !["pending", "retryable"].includes(item.state)) return null;
    var sourceDocument = window.IDPhotoDocumentService.getActiveDocument && window.IDPhotoDocumentService.getActiveDocument();
    try {
      var task = await retryPending(item.id, false, { confirmedTask: taskToResume });
      // A size printed at once with the shared code (multi-size layout) is never offered again.
      var early = await readEarlyPrint(task);
      var printAvailable = !early && task.mode === "print" && Boolean(task.outputOptions && task.outputOptions.quickPrint);
      var notice = early && early.code !== task.code ?
        "纸上印的取件码 " + early.code + " 已不能用，现在是 " + task.code + "，请重排这个尺寸" : "";
      await writeAtomic(task.folder, "automatic-recovery.json", JSON.stringify({ version: 1, taskId: task.id,
        manifestFingerprint: task.fingerprint, code: task.code, printAvailable: printAvailable, earlyPrinted: Boolean(early),
        notice: notice, confirmedAt: task.codeConfirmedAt || Date.now(), groupStamp: task.codeGroupStamp || groupStamp() }));
      if (early) return notice ? { id: task.id, code: task.code, canPrint: false, text: notice } : null;
      return { id: task.id, code: task.code, canPrint: printAvailable, text: task.code + " 已补好，可以打印" };
    } catch (error) {
      var record = automation.store().tasks().find(function (value) { return value.id === item.id; });
      if (record && ["pending", "retryable"].includes(record.state)) automation.failure({ id: item.id, automation: true }, error);
      return { id: item.id, canPrint: false, text: errorText(error) };
    } finally {
      if (sourceDocument) await window.IDPhotoPhotoshopExecution.activateDocument(sourceDocument);
    }
  }
  async function readEarlyPrint(task) {
    var file = await optionalEntry(task.folder, "early-print.json");
    if (!file) return null;
    var value = JSON.parse(await file.read({ format: format(false) }));
    return value && value.version === 1 && value.taskId === task.id && protocol().isPickupCode(value.code) ? value : null;
  }
  // Multi-size layout: this size was printed at once with the customer's shared code
  // while the first photo was still uploading; the background only adds the photo.
  async function markEarlyPrint(task, code) {
    protocol().requirePickupCode(code);
    await writeAtomic(task.folder, "early-print.json", JSON.stringify({ version: 1, taskId: task.id, code: code,
      at: new Date().toISOString() }), false);
  }
  function recoveryPrintText(error) { return ("没打印：" + errorText(error)).slice(0, 900); }
  function recordPrintNoticeIssue(record, error) {
    var text = recoveryPrintText(error), diagnostic = "printNoticeBlocked: " + text;
    if (record.error !== diagnostic) window.IDPhotoDeliveryAutomationService.store().markTask(record.id, { error: diagnostic });
    return { id: record.id, canPrint: false, text: text };
  }
  async function recoveredNotice() {
    var records = window.IDPhotoDeliveryAutomationService.store().tasks().filter(function (item) { return item.state === "completed" && item.mode === "print"; });
    var issue = null;
    for (var record of records) {
      try {
        var folder = await fs().getEntryForPersistentToken(record.token), file = await optionalEntry(folder, "automatic-recovery.json");
        if (!file) continue;
        var value = JSON.parse(await file.read({ format: format(false) }));
        var task = await restoreTask(folder);
        if (value.version !== 1 || value.taskId !== record.id || value.manifestFingerprint !== task.fingerprint || !protocol().isPickupCode(value.code))
          throw new Error("恢复打印记录身份不匹配");
        if (value.printStarted && value.printState !== "submitted" && !value.printError)
          throw new Error("原恢复打印已开始但结果未确认，请人工核对，避免重复出纸");
        if (value.printAvailable) return { id: record.id, code: value.code, canPrint: true, text: value.code + " 已补好，可以打印" };
        if (value.printError) {
          var printIssue = recordPrintNoticeIssue(record, new Error(value.printError));
          issue = issue || printIssue;
        }
      } catch (error) {
        var recordIssue = recordPrintNoticeIssue(record, error);
        issue = issue || recordIssue;
      }
    }
    return issue;
  }
  var printingRecovered = false;
  async function printRecovered(id) {
    if (printingRecovered) throw new Error("恢复打印正在处理中，请勿重复点击");
    printingRecovered = true;
    var folder, value, consumed = false;
    try {
    var item = window.IDPhotoDeliveryAutomationService.store().tasks().find(function (record) { return record.id === id; });
    if (!item || item.state !== "completed") throw new Error("恢复任务尚未完成，不能打印");
    folder = await fs().getEntryForPersistentToken(item.token); value = JSON.parse(await (await folder.getEntry("automatic-recovery.json")).read({ format: format(false) }));
    var task = await restoreTask(folder);
    if (value.version !== 1 || value.taskId !== id || value.manifestFingerprint !== task.fingerprint || !protocol().isPickupCode(value.code))
      throw new Error("恢复打印记录身份不匹配");
    if (!value.printAvailable || value.printStarted) throw new Error("此恢复打印已开始，请人工核对打印状态，避免重复出纸");
    var reuse = Number.isFinite(value.confirmedAt) && Date.now() - value.confirmedAt >= 0 &&
      Date.now() - value.confirmedAt < RECOVERED_CODE_REUSE_MS && value.groupStamp === groupStamp() &&
      !window.IDPhotoDeliveryAutomationService.store().mergeIntent();
    value = Object.assign({}, value, { printAvailable: false, printStarted: new Date().toISOString(), printState: "started" });
    await writeAtomic(folder, "automatic-recovery.json", JSON.stringify(value)); consumed = true;
    // The recovery confirmed this code minutes ago; asking a finished delivery again can take a full minute.
    var recovery = reuse ? { manualPrint: true, confirmedTask: { id: id, fingerprint: task.fingerprint, code: value.code,
      confirmationId: task.confirmationId || "", codeConfirmedAt: Date.now(), codeGroupStamp: groupStamp() } } :
      { manualPrint: true, codeWaitMs: REPRINT_CODE_WAIT_MS };
    var result = await retryPending(id, true, recovery), outcome = result && result.retryResult;
    if (!outcome || !Array.isArray(outcome.printFailures) || !Array.isArray(outcome.printedResults) ||
        outcome.printFailures.length || outcome.printedResults.length !== 1) {
      var failed = outcome && outcome.printFailures && outcome.printFailures[0];
      var details = failed && failed.result && failed.result.printResult;
      throw new Error(details && details.message || "恢复打印未确认提交，请人工核对打印状态；不会自动重试打印");
    }
    await writeAtomic(folder, "automatic-recovery.json", JSON.stringify(Object.assign({}, value, { printState: "submitted", printError: "" })));
    return result;
    } catch (error) {
      if (consumed) {
        try { await writeAtomic(folder, "automatic-recovery.json", JSON.stringify(Object.assign({}, value, {
          printAvailable: false, printState: "unconfirmed", printError: errorText(error).slice(0, 900) }))); }
        catch (recordError) { addDiagnostic(error, "打印结果记录未能写入", recordError); }
        try { recordPrintNoticeIssue(item, error); }
        catch (indexError) { addDiagnostic(error, "打印诊断未能保存", indexError); }
      }
      throw error;
    } finally { printingRecovered = false; }
  }
  async function regenerate(folder, informationInput) {
    if (!folder) {
      var token = window.localStorage.getItem("idphoto-delivery-last-v1");
      if (!token) throw new Error("没有可补码的原任务，请选择交接任务目录。");
      folder = await fs().getEntryForPersistentToken(token);
    }
    var task = await restoreTask(folder, informationInput), code = await confirmCode(task), photo, info;
    if (informationInput && (task.id !== informationInput.taskId || task.fingerprint !== informationInput.manifestFingerprint ||
        task.contextKey !== informationInput.contextKey || task.deliveryId !== informationInput.deliveryId || code !== informationInput.code))
      throw new Error("后台信息条任务的取件码或绑定已变化，请返回交付管理重新生成");
    if (window.IDPhotoTemplates.forDelivery && task.template && task.template.id)
      task.template = window.IDPhotoTemplates.forDelivery(window.IDPhotoTemplates.getTemplateById(task.template.id), true);
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
      if (informationInput && await confirmCode(task) !== code)
        throw new Error("导出期间取件码或交付状态已变化，本次图片不提供查看或保存，请重新生成");
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
      if (informationInput) {
        await writeAtomic(folder, "information-result.json", JSON.stringify({
          version: 1, taskId: task.id, manifestFingerprint: task.fingerprint,
          contextKey: task.contextKey, deliveryId: task.deliveryId, code: code,
          signature: informationInput.signature, fileId: request.referenceFileId,
          revision: request.referenceRevision, artifact: artifact
        }));
      }
      await status(task, { info: "saved", infoError: "", regenerated: filename, codeState: "confirmed", message: "原任务信息条已重导，成片交付状态请以后台为准" });
      return folder.nativePath + "\\" + filename;
    } catch (error) { await status(task, { info: "failed", infoError: errorText(error) }); throw error; }
    finally { if (info) await window.IDPhotoDocumentService.closeWithoutSaving(info.document); if (photo) await window.IDPhotoDocumentService.closeWithoutSaving(photo); }
  }
  async function receiveInformationTasks() {
    if (creatingTask || retryingTask || activeWait) throw new Error("当前交付尚未结束，请稍后领取信息条任务");
    retryingTask = true;
    try {
      var source = await root(), inbox = await optionalEntry(source, "information-requests");
      if (!inbox) return { completed: 0, failures: [] };
      await connection(source);
      var entries = (await inbox.getEntries()).filter(function (entry) {
        return !entry.isFolder && /^[a-f0-9]{32}\.json$/.test(entry.name);
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      var completed = 0, failures = [];
      // Explicit operator action, bounded work; never a Photoshop timer or
      // ordinary printing entry. The existing generator remains authoritative.
      for (var entry of entries.slice(0, 20)) {
        var folder = null, input = null;
        try {
          input = JSON.parse(await entry.read({ format: format(false) }));
          if (input.version !== 1 || entry.name !== input.taskId + ".json" ||
              !/^[a-f0-9]{32}$/.test(input.taskId || "") ||
              !/^\d{4}\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}$/.test(input.relativePath || "") ||
              input.relativePath.split("/")[3] !== input.taskId ||
              !/^[a-f0-9]{64}$/.test(input.contextKey || "") || !/^[a-f0-9]{64}$/.test(input.deliveryId || "") ||
              !/^[a-f0-9]{64}$/.test(input.signature || "") || !/^[a-f0-9]{64}$/.test(input.manifestFingerprint || ""))
            throw new Error("后台信息条任务入口无效，已保留资料");
          protocol().requirePickupCode(input.code);
          folder = source;
          for (var part of input.relativePath.split("/")) folder = await folder.getEntry(part);
          var payload = await (await folder.getEntry("request.json")).read({ format: format(false) });
          var request = JSON.parse(payload);
          if (protocol().sha256(payload) !== input.manifestFingerprint || request.informationOnly !== true ||
              request.taskId !== input.taskId || request.referenceDeliveryId !== input.deliveryId ||
              request.referenceContextKey !== input.contextKey)
            throw new Error("后台信息条原任务归属不符，未生成");
          var resultFile = await optionalEntry(folder, "information-result.json"), result = null, reusable = false;
          if (resultFile) result = JSON.parse(await resultFile.read({ format: format(false) }));
          if (result && result.version === 1 && result.taskId === input.taskId &&
              result.manifestFingerprint === input.manifestFingerprint && result.signature === input.signature &&
              result.code === input.code && result.contextKey === input.contextKey && result.deliveryId === input.deliveryId &&
              result.fileId === request.referenceFileId && result.revision === request.referenceRevision &&
              result.artifact && /^info-[a-f0-9]{32}\.jpg$/.test(result.artifact.path || "")) {
            try {
              var saved = await (await folder.getEntry(result.artifact.path)).read({ format: format(true) });
              reusable = saved.byteLength === result.artifact.sizeBytes && protocol().sha256(saved) === result.artifact.sha256;
            } catch (_) { /* Explicit regeneration can repair a missing artifact. */ }
          }
          if (!reusable) await regenerate(folder, input);
          await entry.delete();
          completed++;
        } catch (error) {
          failures.push(errorText(error));
          if (folder && input && folder.name === input.taskId) {
            try {
              await writeAtomic(folder, "information-error.json", JSON.stringify({ version: 1, taskId: input.taskId,
                manifestFingerprint: input.manifestFingerprint, message: errorText(error) }));
            } catch (_) { /* Keep the request available for an explicit retry. */ }
          }
        }
      }
      return { completed: completed, failures: failures, remaining: Math.max(0, entries.length - 20) };
    } finally { retryingTask = false; }
  }
  async function archiveBatch(task, request) {
    if (!task.outputOptions || !task.outputOptions.exportJpg) return [];
    var execution = window.IDPhotoPhotoshopExecution, results = [];
    if (!window.IDPhotoExportService) throw new Error("本地归档服务未加载");
    // Existing largest-per-source/color/aspect policy remains authoritative.
    // This does not create an all-version archive or alter immutable handoff JPGs.
    for (var index = 0; index < request.files.length; index++) {
      var descriptor = request.files[index], photo = null, temporary = null;
      if (descriptor.role !== "photo" || !/^variant-\d+\.jpg$/.test(descriptor.path)) throw new Error("多规格归档来源无效");
      var bytes = await (await task.folder.getEntry(descriptor.path)).read({ format: format(true) });
      if (bytes.byteLength !== descriptor.sizeBytes || protocol().sha256(bytes) !== descriptor.sha256)
        throw new Error("多规格交接照片变化，停止归档");
      var temporaryRoot = await child(await fs().getDataFolder(), "delivery-retry-temporary");
      try {
        temporary = await temporaryRoot.createFile("archive-" + protocol().id() + ".jpg", { overwrite: false });
        await temporary.write(bytes, { format: format(true) });
        await execution.executeAsModal(async function () {
          var app = execution.getPhotoshop().app, before = Array.from(app.documents).map(function (d) { return d.id; });
          await app.open(temporary);
          var created = Array.from(app.documents).filter(function (d) { return !before.includes(d.id); });
          if (created.length !== 1) throw new Error("无法独立打开归档副本，原文档保留");
          photo = created[0];
        }, "核对本批本地归档副本");
        if (pixels(photo.width) !== descriptor.width || pixels(photo.height) !== descriptor.height)
          throw new Error("归档副本像素不符合原批次");
        var result = await window.IDPhotoExportService.exportSingleJpg(photo, {
          template: { name: descriptor.purpose || descriptor.filename.replace(/\.jpe?g$/i, ""),
            widthPx: descriptor.width, heightPx: descriptor.height },
          docInfo: task.docInfo, nasArchive: Boolean(task.outputOptions.nasArchive),
          deliveryTask: Object.assign({}, task, { archiveOrdinal: index })
        });
        results.push(result);
        if (result.indexUnavailable) throw new Error(result.message);
      } finally {
        try { if (photo) await window.IDPhotoDocumentService.closeWithoutSaving(photo); }
        finally { if (temporary) await temporary.delete(); }
      }
    }
    return results;
  }
  async function retryCurrentArchives(expectedId) {
    if (creatingTask || retryingTask || activeWait) throw new Error("当前交付尚未结束");
    retryingTask = true;
    try {
      var item = await current();
      if (!item || item.id !== expectedId || !item.batch) throw new Error("请核对当前多规格原任务");
      var task = await restoreTask(item.folder);
      if (!task.contextFingerprint) throw new Error("原批次缺少归档设置快照，不能猜测历史归属");
      var request = JSON.parse(await (await task.folder.getEntry("request.json")).read({ format: format(false) }));
      var results = await archiveBatch(task, request);
      await status(task, { archive: "saved", archiveError: "", message: "本地归档已核对；对应文件发布后由后台同步名称" });
      return results;
    } finally { retryingTask = false; }
  }
  async function multi(sourceDocument, docInfo, settings, specifications, chosenTarget, outputOptions) {
    var rules = window.IDPhotoDeliverySpecifications;
    var specs = rules.normalize(specifications, { width: pixels(sourceDocument.width), height: pixels(sourceDocument.height) });
    var target = chosenTarget ? rules.target(chosenTarget) : null;
    if (outputOptions && outputOptions.exportJpg && window.IDPhotoVariantService) {
      docInfo = Object.assign({}, docInfo, { sourceVariant: await window.IDPhotoVariantService.analyzeDocument(sourceDocument) });
    }
    var task = await begin(docInfo, "electronic", window.IDPhotoTemplates.getTemplateById("one-inch"), settings, null, outputOptions);
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
        title: String(docInfo.name || "多规格照片").slice(0, 120), eligible: true, testOnly: true, files: files,
        contextFingerprint: task.contextFingerprint };
      if (target) { request.targetDeliveryId = target.deliveryId; request.targetContextKey = target.contextKey; request.targetGroupVersion = target.groupVersion; request.newMember = true; }
      var payload = JSON.stringify(request); task.fingerprint = protocol().sha256(payload);
      await writeAtomic(task.folder, "request.json", payload);
      var archiveError = "";
      try { await archiveBatch(task, request); }
      catch (error) { archiveError = errorText(error); }
      await writeCompletion(task, []);
      await status(task, { processing: "draft", info: "pending-confirmation", archive: archiveError ? "pending" : "saved",
        archiveError: archiveError, message: "多规格草稿已交接，请在后台核对并点击完成交付；之后可补出同款信息条。" +
          (archiveError ? "本地归档待重试：" + archiveError : ""), outputDirectory: task.folder.nativePath });
      return task;
    } catch (error) { await status(task, { processing: "failed", error: errorText(error), message: "原件与独立副本保留，失败的整批不会交付。" }); throw error; }
    finally { await execution.activateDocument(sourceDocument); }
  }
  window.IDPhotoDeliveryService = { begin: begin, prepare: prepare, savePhoto: savePhoto, requestCode: requestCode,
    markEarlyPrint: markEarlyPrint, archivePhoto: archivePhoto, complete: complete, electronic: electronic, multi: multi, regenerate: regenerate,
    receiveInformationTasks: receiveInformationTasks,
    pending: pending, retryPending: function (id) { return retryPending(id, false); }, deferPending: deferPending, startOutput: startOutput,
    current: current, currentPreview: currentPreview, nextCustomer: nextCustomer, chooseCurrent: chooseCurrent,
    reprintCurrent: reprintCurrent, verifyOutput: verifyOutput, retryCurrentArchives: retryCurrentArchives,
    previewTask: previewTask, primeRecovery: primeRecovery, recoverNext: recoverNext, recoveredNotice: recoveredNotice,
    printRecovered: printRecovered,
    stopWaiting: function () {
      if (!activeWait) {
        var stopped = Boolean(window.IDPhotoDeliveryAutomationService && window.IDPhotoDeliveryAutomationService.stopWaiting());
        if (preparingTask && preparingTask.automation) {
          window.IDPhotoDeliveryAutomationService.store().markTask(preparingTask.id, { state: "stopped", error: "店员停止等待，原任务保留" });
          stopped = true;
        }
        return stopped;
      }
      activeWait.cancelled = true;
      if (activeWait.automation) window.IDPhotoDeliveryAutomationService.store().markTask(activeWait.taskId, { state: "stopped", error: "店员停止等待，原任务保留" });
      return true;
    },
    configure: configure, root: root, connection: connection, onProgress: function (handler) { progress = typeof handler === "function" ? handler : function () {}; },
    onWaitingChanged: function (handler) { waitingChanged = typeof handler === "function" ? handler : function () {}; },
    status: status, readCode: readCode, latest: function () { return latestTask; } };
})();
