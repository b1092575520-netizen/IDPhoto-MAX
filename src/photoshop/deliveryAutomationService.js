(function () {
  "use strict";
  var stateStore;
  var activeBridge = null;
  var PROTOCOL = "pickup-automation-1";
  var CANCELLED_TEXT = "店员取消了这单";
  var ENDED_TEXT = "交付管理里这单已取消或撤回";
  // Same test as IDPhotoPhotoshopExecution.isCancellation; Esc arrives as "user cancelled".
  function cancelled(error) {
    return Boolean(error && (error.cancelled === true || error.number === -128 || error.code === -128 ||
      /user cancel/i.test(String(error.message || error))));
  }
  function store() {
    if (!stateStore) stateStore = window.IDPhotoDeliveryAutomationStore.create({ storage: window.localStorage });
    return stateStore;
  }
  function protocol() { return window.IDPhotoDeliveryProtocol; }
  function fs() { return require("uxp").storage.localFileSystem; }
  function format() { return require("uxp").storage.formats.utf8; }
  async function child(folder, name) {
    try { return await folder.getEntry(name); } catch (_) { return await folder.createFolder(name); }
  }
  async function atomic(folder, name, value, overwrite) {
    var file = await folder.createFile(name + "." + protocol().id() + ".tmp", { overwrite: false });
    await file.write(value, { format: format() });
    await file.moveTo(folder, { newName: name, overwrite: Boolean(overwrite) });
  }
  function sourceKey(info) {
    var identity = window.IDPhotoDeliveryIdentity, current = identity.getSourceIdentity(info);
    if (!current || !identity.matchesSourceIdentity) return current;
    var matches = Array.from(new Set(store().tasks().map(function (item) { return item.sourceKey; })))
      .filter(function (key) { return identity.matchesSourceIdentity(key, info); });
    if (matches.length > 1) throw new Error("原片身份对应多份历史记录，请在交付管理中核对");
    return matches[0] || current;
  }
  // 1寸 and 标准2寸 deliver the same saved photo, so they are one specification.
  function savedSize(template) {
    var size = window.IDPhotoTemplates && window.IDPhotoTemplates.getSaveSize && window.IDPhotoTemplates.getSaveSize(template);
    return size || { widthPx: template.widthPx, heightPx: template.heightPx };
  }
  function specKey(info, mode, template) {
    var size = mode === "electronic" ? { widthPx: info.widthPx, heightPx: info.heightPx } : savedSize(template);
    return window.IDPhotoDeliveryIdentity.makeVariantKey({
      widthPx: size.widthPx,
      heightPx: size.heightPx,
      backgroundColor: info.sourceVariant && info.sourceVariant.backgroundColor || "unknown"
    });
  }
  function plan(info, mode, template, historical) {
    var source = sourceKey(info);
    if (!source && !historical) return { kind: "plain", text: "原片身份不明 · 信息条留白" };
    var spec = specKey(info, mode, template);
    if (!spec) throw new Error("照片规格或底色无法核对，请确认后再交付");
    if (!source) source = "historical:" + protocol().id();
    var previous = store().source(source), group = store().group();
    var tasks = store().tasks().filter(function (item) { return item.sourceKey === source; });
    var lastBySpec = {};
    tasks.forEach(function (item) { lastBySpec[item.specKey] = item; });
    // An order the staff cancelled (Esc, or in the delivery manager) never blocks laying the same photo out again.
    var existing = tasks.filter(function (item) { return item.specKey === spec && ["pending", "retryable", "stopped", "blocked"].includes(item.state) &&
      !(item.state === "stopped" && [CANCELLED_TEXT, ENDED_TEXT].includes(item.error)); });
    return { kind: group.on ? "group" : previous ? "same" : "new", sourceKey: source, specKey: spec,
      code: group.on ? group.code : previous && previous.code || "", previousTaskIds: Object.keys(lastBySpec).map(function (key) { return lastBySpec[key].id; }),
      groupTaskIds: group.on ? group.members.slice() : [], groupSessionId: group.on ? group.sessionId : "",
      existing: existing.length ? existing[existing.length - 1] : null };
  }
  async function bridge(action, fields, sourceRoot, connected, operationId) {
    if (connected.automationProtocol !== PROTOCOL) throw new Error("后台尚不支持自动交付，请使用本轮配套后台；原任务保留");
    var requests = await child(sourceRoot, "automation-requests"), responses = await child(sourceRoot, "automation-responses");
    var id = operationId || protocol().id(), requestId = protocol().id();
    var input = Object.assign({ version: 1, protocol: PROTOCOL, action: action, operationId: id, requestId: requestId,
      connectionRequestId: connected.requestId, sourceIdentity: connected.sourceIdentity, consumerId: connected.consumerId, contextKey: "" }, fields);
    var payload, file;
    try { file = await requests.getEntry(id + ".json"); } catch (_) { /* A stable mutation is written once. */ }
    if (file) {
      payload = await file.read({ format: format() });
      var saved = JSON.parse(payload);
      if (saved.action !== action || saved.sourceIdentity !== connected.sourceIdentity || saved.consumerId !== connected.consumerId)
        throw new Error("原同行操作连接已变化，保留记录，请在后台核对");
      input = Object.assign({}, saved, { requestId: requestId, connectionRequestId: connected.requestId });
      payload = JSON.stringify(input); await atomic(requests, id + ".json", payload, true);
    } else { payload = JSON.stringify(input); await atomic(requests, id + ".json", payload); }
    var fingerprint = protocol().sha256(payload), deadline = Date.now() + 60000;
    var attempt = { stopped: false }; activeBridge = attempt;
    try {
    while (Date.now() < deadline) {
      if (attempt.stopped) { var stopped = new Error("已停止等待，原任务与同行操作保留待核对"); stopped.code = "AUTO_STOPPED"; throw stopped; }
      var output;
      try { output = JSON.parse(await (await responses.getEntry(id + ".json")).read({ format: format() })); } catch (_) { output = null; }
      if (output && output.version === 1 && output.protocol === PROTOCOL && output.operationId === id &&
          output.requestId === input.requestId && output.sourceIdentity === input.sourceIdentity && output.consumerId === input.consumerId &&
          output.fingerprint === fingerprint) {
        if (!output.ok) {
          var error = new Error(output.error && output.error.message || "自动交付核对失败，请查看后台");
          error.code = output.error && output.error.code; error.retryable = output.error && output.error.retryable;
          throw error;
        }
        return output.data;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
    var timeout = new Error("后台核对超时，原任务保留，连接恢复后继续"); timeout.retryable = true; throw timeout;
    } finally { if (activeBridge === attempt) activeBridge = null; }
  }
  async function query(ids, sourceRoot, connected) {
    var tasks = store().tasks();
    return (await bridge("queryTasks", { taskIds: ids,
      bindings: ids.map(function (id) { var task = tasks.find(function (item) { return item.id === id; }); return { taskId: id, code: task && task.bindingCode || "" }; }).filter(function (binding) { return protocol().isPickupCode(binding.code); })
    }, sourceRoot, connected)).items;
  }
  function valid(item) {
    return item && item.known && !item.blocked && item.originalCodeActive !== false && ["ready", "preparing"].includes(item.status);
  }
  function requireItem(item) {
    if (!item || !item.known) throw new Error("原交付尚未核对，请等待原任务，不会重复建单");
    if (["cancelled", "withdrawn"].includes(item.status) && !item.errorCode) return null;
    if (item.blocked) { var error = new Error(item.error || "原交付存在冲突，请在后台核对"); error.retryable = Boolean(item.retryable); throw error; }
    if (!valid(item)) return null;
    return item;
  }
  async function resolve(task, photo) {
    var merging = store().mergeIntent();
    if (merging) {
      var records = store().tasks();
      var affectedSource = merging.taskIds.some(function (id) { var original = records.find(function (item) { return item.id === id; }); return original && original.sourceKey === task.automation.sourceKey; });
      if (affectedSource || task.automation.groupTaskIds.length ||
          task.automation.groupSessionId && task.automation.groupSessionId === merging.sessionId) {
        var pendingMerge = new Error("同行合并尚未核对，原任务保留，请先核对合并结果");
        pendingMerge.retryable = true; throw pendingMerge;
      }
    }
    var service = window.IDPhotoDeliveryService, root = await fs().getEntryForPersistentToken(task.sourceRootToken);
    var connected = await service.connection(root, task.consumerId || undefined);
    if (connected.automationProtocol !== PROTOCOL) throw new Error("后台尚不支持自动交付，请使用本轮配套后台；原任务保留");
    if (task.sourceIdentity && task.sourceIdentity !== connected.sourceIdentity) throw new Error("原交接目录身份已变化，停止自动恢复");
    task.consumerId = connected.consumerId; task.sourceIdentity = connected.sourceIdentity;
    var plan = task.automation, ids = Array.from(new Set(plan.previousTaskIds.concat(plan.groupTaskIds)));
    if (ids.length > 32) throw new Error("原片规格记录超出核对范围，请在后台人工处理");
    var items = ids.length ? await query(ids, root, connected) : [];
    var same = plan.previousTaskIds.map(function (id) { return items.find(function (item) { return item.taskId === id; }); });
    var original = null;
    for (var i = same.length - 1; i >= 0; i--) { original = requireItem(same[i]); if (original) break; }
    var group = plan.groupTaskIds.map(function (id) { return items.find(function (item) { return item.taskId === id; }); });
    var target = original;
    if (group.length) {
      target = requireItem(group[0]);
      if (!target) throw new Error("同行交付已失效，请关闭同行并在后台核对");
      for (var member of group) {
        var confirmedMember = requireItem(member);
        if (!confirmedMember) throw new Error("同行交付已失效，请关闭同行并在后台核对");
        if (confirmedMember.deliveryId !== target.deliveryId) {
          var waitingGroup = new Error("所选同行尚未合并完成，原任务保留待核对");
          waitingGroup.retryable = true; throw waitingGroup;
        }
      }
      if (original && original.deliveryId !== target.deliveryId) throw new Error("此原片已属于其他交付，请先通过同行列表明确合并");
    }
    var descriptor = Object.assign({}, photo, { filename: "photo-" + protocol().sha256(plan.specKey).slice(0, 12) + ".jpg",
      purpose: task.mode === "electronic" ? "电子照片" : task.template.name,
      background: task.docInfo.sourceVariant && task.docInfo.sourceVariant.backgroundColor || "unknown" });
    var request = { version: 3, autoDelivery: true, taskId: task.id, outputId: task.outputId, sourceDocumentId: String(task.docInfo.id),
      mode: task.mode, title: String(task.docInfo.name || "电子成片").slice(0, 120), eligible: true, testOnly: true,
      contextFingerprint: task.contextFingerprint, files: [descriptor] };
    if (target) {
      if (target.status !== "ready") { var waiting = new Error("原交付仍在准备，原任务完成后自动继续"); waiting.retryable = true; waiting.code = "AUTO_TARGET_PREPARING"; throw waiting; }
      request.targetDeliveryId = target.deliveryId; request.targetContextKey = target.contextKey; request.targetGroupVersion = target.groupVersion;
      request.newMember = !original;
      if (original) {
        if (!original.originalMemberId) throw new Error("原片成员归属无法核实，停止自动追加");
        descriptor.memberId = original.originalMemberId;
        var records = store().tasks().filter(function (item) { return item.sourceKey === plan.sourceKey && item.specKey === plan.specKey; });
        var previous = records.filter(function (item) { return item.id !== task.id; }).pop();
        var version = previous && items.find(function (item) { return item.taskId === previous.id; });
        if (previous && !version) throw new Error("原规格记录尚未核对，停止自动替换");
        if (version && valid(version)) {
          if (!version.taskFiles || version.taskFiles.length !== 1) throw new Error("原规格照片归属无法唯一确认，停止替换");
          descriptor.replaceFileId = version.taskFiles[0].id;
          descriptor.filename = version.taskFiles[0].filename;
        }
      }
      task.contextKey = target.contextKey; task.deliveryId = target.deliveryId;
    }
    if (task.historical) request.sourceConfirmation = { kind: "historical-shop", sourceDocumentId: String(task.docInfo.id), confirmed: true, noExistingDelivery: true, captureDate: task.dateText };
    return request;
  }
  function created(task, token) {
    store().registerTask({ id: task.id, token: token, sourceKey: task.automation.sourceKey, specKey: task.automation.specKey,
      mode: task.mode, name: task.docInfo.name });
    var group = store().group();
    if (group.on && group.sessionId === task.automation.groupSessionId) {
      var records = store().tasks();
      var members = group.members.filter(function (id) { var item = records.find(function (entry) { return entry.id === id; }); return !item || item.sourceKey !== task.automation.sourceKey; });
      store().setGroup({ on: true, sessionId: group.sessionId, requireActive: true, members: members.concat(task.id) });
    }
  }
  function confirmed(task) {
    if (!task.automation) return;
    var target = { deliveryId: task.deliveryId, contextKey: task.contextKey, status: "preparing" };
    store().markTask(task.id, { code: task.code, target: target });
    store().rememberSource(task.automation.sourceKey, { taskId: task.id, token: store().tasks().find(function (item) { return item.id === task.id; }).token, code: task.code, target: target });
    var group = store().group();
    if (group.on && group.sessionId === task.automation.groupSessionId) {
      var records = store().tasks();
      var members = group.members.filter(function (id) { var item = records.find(function (entry) { return entry.id === id; }); return !item || item.sourceKey !== task.automation.sourceKey; });
      store().setGroup({ on: true, sessionId: group.sessionId, requireActive: true, code: task.code, target: target, members: members.concat(task.id) });
    }
  }
  function completed(task) {
    if (task.automation) store().markTask(task.id, task.code ? { state: "completed", code: task.code } : { state: "completed" });
  }
  function failure(task, error) {
    if (!task || !task.automation) return;
    var current = store().tasks().find(function (item) { return item.id === task.id; });
    // A completed task (e.g. a failed recovery print) keeps its state; the caller
    // reports the real error instead of a store "cannot restart" refusal.
    if (current && (current.state === "stopped" || current.state === "completed")) return;
    // Esc (10-18): the staff cancelled this order, so it is parked instead of redone in the background.
    if (cancelled(error)) { store().markTask(task.id, { state: "stopped", error: CANCELLED_TEXT }); return; }
    if (error.code === "DELIVERY_ENDED" || error.causeCode === "DELIVERY_ENDED") { store().markTask(task.id, { state: "stopped", error: ENDED_TEXT }); return; }
    if (error.code === "AUTO_STOPPED" || error.causeCode === "AUTO_STOPPED") { store().markTask(task.id, { state: "stopped", error: error.message }); return; }
    var hard = error.retryable === false || error.retryable !== true && /变化|改变|冲突|损坏|不匹配|不一致|已失效|成员归属|唯一确认|输出痕迹/.test(error.message || "");
    store().markTask(task.id, { state: hard ? "blocked" : "retryable", error: error.message || String(error) });
  }
  async function refreshCompleted() {
    var tasks = store().tasks().filter(function (item) { return item.state === "completed"; }).slice(-32);
    if (!tasks.length) return;
    var root = await window.IDPhotoDeliveryService.root(), connected = await window.IDPhotoDeliveryService.connection(root);
    var items = await query(tasks.map(function (item) { return item.id; }), root, connected);
    items.forEach(function (item) {
      store().markTask(item.taskId, { target: item, code: protocol().isPickupCode(item.code) ? item.code : "" });
    });
  }
  async function recent() {
    await refreshCompleted();
    var tasks = store().recentCompleted(), results = [];
    for (var item of tasks) {
      var thumbnail = await window.IDPhotoDeliveryService.previewTask(item.id, item.token);
      results.push({ id: item.id, name: item.name, time: new Date(item.completedAt).toLocaleTimeString(), code: item.code, thumbnail: thumbnail });
    }
    return results;
  }
  async function openGroup(ids) {
    ids = (ids || []).slice();
    function membersWithCurrent(currentIds) {
      var records = store().tasks(), members = [];
      ids.concat(currentIds).forEach(function (id) {
        var record = records.find(function (item) { return item.id === id; });
        members = members.filter(function (memberId) {
          var saved = records.find(function (item) { return item.id === memberId; });
          return memberId !== id && !(record && saved && record.sourceKey && record.sourceKey === saved.sourceKey);
        });
        members.push(id);
      });
      return members;
    }
    var intent = store().mergeIntent();
    if (intent && JSON.stringify(intent.taskIds.slice().sort()) !== JSON.stringify(ids.slice().sort()))
      throw new Error("原同行合并尚未核对，不能开始另一组合并");
    var activation = store().group(), sessionId = intent ? intent.sessionId || "" : activation.on ? activation.sessionId : protocol().id();
    if (!intent && !activation.on)
      activation = store().setGroup({ on: true, sessionId: sessionId, members: ids, code: "", target: null });
    else if (!intent && ids.length)
      activation = store().setGroup({ on: true, sessionId: sessionId, members: membersWithCurrent(activation.members), requireActive: true });
    if (!ids.length) return activation;
    var root = await window.IDPhotoDeliveryService.root(), connected = await window.IDPhotoDeliveryService.connection(root);
    if (intent) {
      if ((await fs().getEntryForPersistentToken(intent.sourceRootToken)).nativePath !== root.nativePath)
        throw new Error("原同行合并来源已变化，请恢复原连接");
      var existingResult = await bridge("mergeGroup", { taskIds: ids, contextKey: intent.contextKey, confirmSharing: true, expected: intent.expected }, root, connected, intent.operationId);
      if (existingResult.status !== "complete") { var unsettled = new Error(existingResult.error || "同行合并仍待核对"); unsettled.retryable = existingResult.status === "pending"; throw unsettled; }
    }
    var items = await query(ids, root, connected);
    items.forEach(function (item) { if (!valid(item) || item.status !== "ready") throw new Error("所选顾客状态已变化，请重新核对同行"); });
    var selected = store().tasks().filter(function (item) { return ids.includes(item.id); }).sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (selected.length !== ids.length) throw new Error("所选同行记录已改变");
    var target = items.find(function (item) { return item.taskId === selected[0].id; });
    var distinct = Array.from(new Set(items.map(function (item) { return item.deliveryId; })));
    if (distinct.length > 1) {
      var operationId = intent ? intent.operationId : protocol().id();
      if (!intent) {
        intent = { operationId: operationId, sessionId: sessionId, taskIds: ids, sourceRootToken: await fs().createPersistentToken(root), contextKey: target.contextKey,
          expected: items.map(function (item) { return { id: item.deliveryId, version: item.groupVersion, code: item.code }; }) };
        store().setMergeIntent(intent);
      }
      var result = await bridge("mergeGroup", { taskIds: ids, contextKey: intent.contextKey, confirmSharing: true, expected: intent.expected }, root, connected, operationId);
      if (result.status !== "complete") {
        var waiting = new Error(result.error || "同行合并正在核对，原操作保留"); waiting.retryable = result.status === "pending"; throw waiting;
      }
      items = await query(ids, root, connected); target = items.find(function (item) { return item.taskId === selected[0].id; });
      if (!valid(target) || items.some(function (item) { return !valid(item) || item.deliveryId !== target.deliveryId; }))
        throw new Error("同行合并结果尚未确认，请在后台核对原操作");
    }
    if (intent) store().setMergeIntent(null);
    var current = store().group();
    if (!sessionId || !current.on || current.sessionId !== sessionId) return current;
    return store().setGroup({ on: true, sessionId: sessionId, members: membersWithCurrent(current.members), code: target.code, target: target, requireActive: true });
  }
  window.IDPhotoDeliveryAutomationService = { plan: plan, resolve: resolve, created: created, confirmed: confirmed, completed: completed,
    failure: failure, store: store, recent: recent, openGroup: openGroup, refreshCompleted: refreshCompleted, bridge: bridge,
    stopWaiting: function () { if (!activeBridge) return false; activeBridge.stopped = true; return true; } };
})();
