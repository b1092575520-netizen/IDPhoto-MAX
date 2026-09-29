(function () {
  "use strict";
  var GUARD = ".idphoto-archive.guard";
  function storage() { return require("uxp").storage; }
  function protocol() { return window.IDPhotoDeliveryProtocol; }
  function key(path) { return String(path || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(); }
  async function optional(folder, name) {
    var entries = await folder.getEntries();
    return entries.find(function (entry) { return entry.name === name; }) || null;
  }
  async function atomic(folder, name, value, overwrite) {
    var temporary = name + "." + protocol().id() + ".tmp";
    var file = await folder.createFile(temporary, { overwrite: false });
    try {
      await file.write(JSON.stringify(value), { format: storage().formats.utf8 });
      await file.moveTo(folder, { newName: name, overwrite: overwrite === true });
    } finally {
      var leftover = await optional(folder, temporary);
      if (leftover) await leftover.delete();
    }
  }
  async function withDirectory(folder, callback) {
    // createFile(overwrite:false) is the shared atomic admission point with the
    // background renamer. No lease timeout can steal a slow live operation.
    var lock = null, deadline = Date.now() + 5000;
    while (!lock) {
      try { lock = await folder.createFile(GUARD, { overwrite: false }); }
      catch (error) {
        if (Date.now() >= deadline) throw new Error("归档目录正在保存或同步；照片交接已保留，请稍后主动重试：" + error.message);
        await new Promise(function (resolve) { setTimeout(resolve, 100); });
      }
    }
    try {
      await lock.write(JSON.stringify({ version: 1, owner: "photoshop", token: protocol().id() }), { format: storage().formats.utf8 });
      if (await optional(folder, ".idphoto-archive-sync.json"))
        throw new Error("上次归档命名尚未恢复，请等待后台完成；原照片保留");
      return await callback();
    } finally { await lock.delete(); }
  }
  async function rootIdentity(root) {
    var filename = ".idphoto-archive-root.json", file = await optional(root, filename), value;
    if (!file) {
      value = { version: 1, id: protocol().id(), directory: key(root.nativePath) };
      try { await atomic(root, filename, value, false); }
      catch (error) { if (!await optional(root, filename)) throw error; }
      file = await root.getEntry(filename);
    }
    value = JSON.parse(await file.read({ format: storage().formats.utf8 }));
    if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.id) || value.directory !== key(root.nativePath))
      throw new Error("归档根目录身份不符，照片已保留，不能按取件码改名");
    return value.id;
  }
  async function requestFor(task) {
    var payload = await (await task.folder.getEntry("request.json")).read({ format: storage().formats.utf8 });
    if (protocol().sha256(payload) !== task.fingerprint) throw new Error("原任务清单变化，归档命名待核对");
    return JSON.parse(payload);
  }
  async function verifyRecord(task, folder, photo, saved, entry) {
    var request = await requestFor(task), descriptor = request.files[saved.ordinal];
    if (saved.version !== 1 || saved.taskId !== task.id || saved.manifestFingerprint !== task.fingerprint ||
        key(saved.directory) !== key(folder.nativePath) ||
        !descriptor || descriptor.role !== "photo" || descriptor.sha256 !== saved.uploadChecksum ||
        (task.contextKey && saved.contextKey && task.contextKey !== saved.contextKey) ||
        (task.deliveryId && saved.deliveryId && task.deliveryId !== saved.deliveryId) ||
        (entry && (entry.archiveId !== saved.archiveId || entry.deliveryTaskId !== task.id ||
          entry.identityMarker !== saved.identityMarker || entry.backgroundColor !== saved.backgroundColor)))
      throw new Error("受管归档映射与当前原任务、文件或索引冲突，保留照片待核对");
    var data = await photo.read({ format: storage().formats.binary });
    if (data.byteLength !== saved.localSize || protocol().sha256(data) !== saved.localChecksum)
      throw new Error("受管归档照片内容已变化，保留原文件待核对");
  }
  async function immutable(folder, name, record) {
    var file = await optional(folder, name);
    if (file) {
      if (JSON.stringify(JSON.parse(await file.read({ format: storage().formats.utf8 }))) !== JSON.stringify(record))
        throw new Error("归档不可变映射冲突，保留资料待核对");
    } else await atomic(folder, name, record, false);
  }
  async function prepareOutput(task, root, folder, file) {
    await requestFor(task);
    var plan = { version: 1, archiveId: protocol().id(), taskId: task.id,
      manifestFingerprint: task.fingerprint, directory: folder.nativePath, originalName: file.name };
    // Written before Photoshop saves: only this explicit output can acquire a
    // fresh mapping. If all completion writes fail, refuse to guess on retry.
    await atomic(folder, ".idphoto-output-" + plan.archiveId + ".json", plan, false);
    return plan;
  }
  async function discardFailedOutput(folder, plan) {
    if (!plan) return;
    if (await optional(folder, plan.originalName)) throw new Error("未完成照片仍存在，保留产出计划待核对");
    var file = await optional(folder, ".idphoto-output-" + plan.archiveId + ".json");
    if (file) await file.delete();
  }
  async function bind(task, root, folder, file, indexLocation, entry, template, output) {
    if (!task) return null;
    if (!task.id || !task.fingerprint)
      throw new Error("本地照片缺少明确交付归属，已保留原名");
    if (entry.deliveryTaskId && entry.deliveryTaskId !== task.id) throw new Error("归档属于另一位顾客，不能重新绑定");
    if (entry.archiveId) {
      // Retry registration after a lost handoff write, without changing identity.
      var existing = await optional(folder, ".idphoto-archive-" + entry.archiveId + ".json");
      if (!existing) throw new Error("受管归档映射缺失，保留照片待核对");
      var saved = JSON.parse(await existing.read({ format: storage().formats.utf8 }));
      await verifyRecord(task, folder, file, saved, entry);
      if (key(saved.root) !== key(root.nativePath) ||
          key(saved.privateIndex) !== key(indexLocation.folder.nativePath + "/" + indexLocation.name) ||
          saved.width !== template.widthPx || saved.height !== template.heightPx ||
          saved.rootId !== await rootIdentity(root))
        throw new Error("受管归档位置或实际规格不符，保留照片待核对");
      await immutable(task.folder, "archive-" + entry.archiveId + ".json", saved);
      return entry.archiveId;
    }
    if (!output || output.taskId !== task.id || output.manifestFingerprint !== task.fingerprint ||
        output.directory !== folder.nativePath || output.originalName !== file.name)
      throw new Error("普通旧归档没有本次产出凭据，不能关联新交付");
    var request = await requestFor(task), ordinal = task.archiveOrdinal || 0;
    var descriptor = request.files[ordinal];
    if (!descriptor || descriptor.role !== "photo") throw new Error("归档对应的成片记录缺失");
    var data = await file.read({ format: storage().formats.binary }), id = output.archiveId;
    var record = { version: 1, archiveId: id, taskId: task.id, manifestFingerprint: task.fingerprint,
      contextKey: task.contextKey || "", deliveryId: task.deliveryId || "", ordinal: ordinal,
      uploadChecksum: descriptor.sha256, localChecksum: protocol().sha256(data), localSize: data.byteLength,
      root: root.nativePath, rootId: await rootIdentity(root), directory: folder.nativePath, originalName: file.name,
      privateIndex: indexLocation.folder.nativePath + "/" + indexLocation.name,
      identityMarker: entry.identityMarker, backgroundColor: entry.backgroundColor,
      templateName: template.name, width: template.widthPx, height: template.heightPx };
    // The local record is also the recovery address. Failed handoff registration
    // leaves it and the actual photo intact; a later export can register it again.
    // Either completed record is sufficient to recover the exact output after
    // a single-location I/O failure; neither is inferred from a dedup match.
    var receiptError = null, mapError = null;
    try { await immutable(task.folder, ".archive-output-" + id + ".json", record); }
    catch (error) { receiptError = error; }
    try { await immutable(folder, ".idphoto-archive-" + id + ".json", record); }
    catch (error) { mapError = error; }
    if (receiptError && mapError) throw new Error("照片已保留，但产出回执与映射写入均失败，须核对原文件：" + mapError.message);
    if (mapError) throw mapError;
    entry.archiveId = id; entry.deliveryTaskId = task.id;
    await immutable(task.folder, "archive-" + id + ".json", record);
    return id;
  }
  async function recoverIndex(task, folder, index) {
    // Recover only explicit mappings for this exact task, never infer a code
    // from a legacy filename, photo similarity, timestamp or another customer.
    if (!task) return false;
    var entries = await folder.getEntries(), changed = false;
    // Recover a failed local mapping write from the completed-output receipt.
    for (var receipt of await task.folder.getEntries()) {
      if (!/^\.archive-output-[a-f0-9]{32}\.json$/.test(receipt.name)) continue;
      var completed = JSON.parse(await receipt.read({ format: storage().formats.utf8 }));
      if (key(completed.directory) !== key(folder.nativePath)) continue;
      if (entries.some(function (e) { return e.name === ".idphoto-archive-retired-" + completed.archiveId + ".json"; })) continue;
      var produced = entries.find(function (e) { return e.name === completed.originalName; });
      if (!produced) continue; // Renamed/retired outputs remain governed by their canonical map and indexes.
      await verifyRecord(task, folder, produced, completed);
      await immutable(folder, ".idphoto-archive-" + completed.archiveId + ".json", completed);
    }
    entries = await folder.getEntries();
    for (var planFile of entries) {
      if (!/^\.idphoto-output-[a-f0-9]{32}\.json$/.test(planFile.name)) continue;
      var plan = JSON.parse(await planFile.read({ format: storage().formats.utf8 }));
      if (plan.taskId === task.id && plan.manifestFingerprint === task.fingerprint &&
          entries.some(function (e) { return e.name === plan.originalName; }) &&
          !entries.some(function (e) { return e.name === ".idphoto-archive-" + plan.archiveId + ".json"; }))
        throw new Error("上次产出已保留但完成凭据缺失；停止重复保存，请核对原任务与原文件");
    }
    for (var file of entries) {
      if (!/^\.idphoto-archive-[a-f0-9]{32}\.json$/.test(file.name)) continue;
      var saved = JSON.parse(await file.read({ format: storage().formats.utf8 }));
      if (saved.taskId !== task.id || saved.manifestFingerprint !== task.fingerprint) continue;
      if (saved.directory !== folder.nativePath ||
          file.name !== ".idphoto-archive-" + saved.archiveId + ".json")
        throw new Error("本地归档恢复映射路径不匹配");
      var photo = entries.find(function (e) { return e.name === saved.originalName; });
      if (entries.some(function (e) { return e.name === ".idphoto-archive-retired-" + saved.archiveId + ".json"; })) continue;
      if (!photo) continue; // Already renamed by the background; its indexes govern.
      var value = index[photo.name];
      if (value && value.archiveId) {
        if (value.archiveId !== saved.archiveId) throw new Error("本地归档映射与索引冲突");
        await verifyRecord(task, folder, photo, saved, value);
        await immutable(task.folder, "archive-" + saved.archiveId + ".json", saved);
        continue;
      }
      if (value && value.deliveryTaskId && value.deliveryTaskId !== task.id)
        throw new Error("本地归档索引属于另一任务，保留原文件");
      await verifyRecord(task, folder, photo, saved);
      index[photo.name] = { identityMarker: saved.identityMarker, backgroundColor: saved.backgroundColor,
        archiveId: saved.archiveId, deliveryTaskId: saved.taskId };
      await immutable(task.folder, "archive-" + saved.archiveId + ".json", saved);
      changed = true;
    }
    return changed;
  }
  async function retire(folder, entry) {
    if (!entry || !entry.archiveId) return;
    var name = ".idphoto-archive-retired-" + entry.archiveId + ".json";
    if (!await optional(folder, name)) await atomic(folder, name, { version: 1, archiveId: entry.archiveId,
      reason: "same-source-larger-archive" }, false);
  }
  window.IDPhotoArchiveNamingService = { withDirectory: withDirectory, prepareOutput: prepareOutput,
    discardFailedOutput: discardFailedOutput, bind: bind, retire: retire, recoverIndex: recoverIndex };
})();
