(function () {
  "use strict";
  var KEY = "idphoto-delivery-automation-v1";
  var IDLE_MS = 20 * 60 * 1000, RECENT_MS = 30 * 60 * 1000;
  var MAX_SOURCES = 4096, MAX_TASKS = 8192, MAX_INDEX_BYTES = 4 * 1024 * 1024;
  var STATES = ["pending", "retryable", "completed", "blocked", "stopped"];

  function fail(message) { throw new Error(message); }
  function text(value, limit, optional) {
    if (optional && (value === undefined || value === null || value === "")) return "";
    if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f]/.test(value))
      fail("Invalid delivery automation text");
    return value;
  }
  function timestamp(value) {
    if (!Number.isSafeInteger(value) || value < 0) fail("Invalid delivery automation time");
    return value;
  }
  function taskId(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail("Invalid delivery automation task ID");
    return value;
  }
  function code(value) {
    if (value === "") return "";
    if (typeof value !== "string" || !/^(?=.*[A-Z])(?=.*[2-9])[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(value))
      fail("Invalid delivery automation pickup code");
    return value;
  }
  function jsonValue(value, depth) {
    if (depth > 12) fail("Delivery automation target is too deep");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object") fail("Invalid delivery automation target");
    if (!Array.isArray(value) && Object.prototype.toString.call(value) !== "[object Object]")
      fail("Invalid delivery automation target");
    Object.keys(value).forEach(function (key) { jsonValue(value[key], depth + 1); });
  }
  function target(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid delivery automation target");
    jsonValue(value, 0);
    if (JSON.stringify(value).length > 16384) fail("Delivery automation target is too large");
    return value;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function emptyGroup() {
    return { on: false, sessionId: "", code: "", target: null, members: [], openedAt: 0,
      lastLayoutAt: 0, expired: false, expiredAt: 0 };
  }
  function empty() { return { version: 1, sources: [], tasks: [], group: emptyGroup(), mergeIntent: null }; }
  function validateMergeIntent(value) {
    if (value === null) return;
    target(value); taskId(value.operationId); text(value.sourceRootToken, 8192); text(value.contextKey, 512);
    if (value.sessionId !== undefined) taskId(value.sessionId);
    if (!Array.isArray(value.taskIds) || value.taskIds.length < 1 || value.taskIds.length > 8)
      fail("Invalid delivery automation merge intent");
    value.taskIds.forEach(taskId); unique(value.taskIds, "merge intent task");
  }
  function unique(values, label) {
    var seen = Object.create(null);
    values.forEach(function (value) {
      if (seen[value]) fail("Duplicate delivery automation " + label);
      seen[value] = true;
    });
  }
  function validate(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.tasks))
      fail("Delivery automation index is damaged; original records were retained");
    if (value.sources.length > MAX_SOURCES || value.tasks.length > MAX_TASKS)
      fail("Delivery automation index capacity reached; original records were retained");
    value.sources.forEach(function (item) {
      if (!item) fail("Invalid delivery automation source");
      text(item.sourceKey, 512); text(item.token, 8192); taskId(item.taskId);
      code(item.code); target(item.target); timestamp(item.updatedAt);
    });
    unique(value.sources.map(function (item) { return item.sourceKey; }), "source");
    var active = [];
    value.tasks.forEach(function (item) {
      if (!item) fail("Invalid delivery automation task");
      taskId(item.id); text(item.token, 8192);
      text(item.sourceKey, 512, true); text(item.specKey, 512, true);
      text(item.name, 512, true); text(item.mode, 32, true); text(item.error, 1024, true);
      if (STATES.indexOf(item.state) < 0) fail("Invalid delivery automation task state");
      if (typeof item.legacy !== "boolean" || (!item.legacy && (!item.sourceKey || !item.specKey)))
        fail("Delivery automation task has no reliable source identity");
      code(item.code); code(item.bindingCode); target(item.target);
      timestamp(item.createdAt); timestamp(item.updatedAt); timestamp(item.completedAt);
      if (!item.legacy && (item.state === "pending" || item.state === "retryable"))
        active.push(JSON.stringify([item.sourceKey, item.specKey]));
    });
    unique(value.tasks.map(function (item) { return item.id; }), "task");
    unique(active, "active source/specification");
    value.sources.forEach(function (item) {
      var task = value.tasks.find(function (entry) { return entry.id === item.taskId; });
      if (!task || task.sourceKey !== item.sourceKey || task.token !== item.token)
        fail("Delivery automation source/task binding is damaged");
    });
    var group = value.group;
    if (!group || typeof group.on !== "boolean" || typeof group.expired !== "boolean" || !Array.isArray(group.members))
      fail("Invalid delivery automation group state");
    code(group.code); target(group.target); timestamp(group.openedAt);
    timestamp(group.lastLayoutAt); timestamp(group.expiredAt);
    if (typeof group.sessionId !== "string") fail("Invalid delivery automation group session");
    if (group.on) taskId(group.sessionId);
    else if (group.sessionId !== "") fail("Inactive delivery automation group has an active session");
    if (group.members.length > 8) fail("Delivery automation group capacity reached");
    group.members.forEach(function (member) { text(member, 512); });
    unique(group.members, "group member");
    if (group.on && (group.expired || group.lastLayoutAt < group.openedAt))
      fail("Invalid delivery automation group clock");
    validateMergeIntent(value.mergeIntent);
    return value;
  }
  function create(options) {
    options = options || {};
    var storage = options.storage || window.localStorage, now = options.now || Date.now;
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function")
      fail("Delivery automation storage is unavailable");
    var state;
    function read() {
      var raw = storage.getItem(KEY), candidate;
      if (raw === null || raw === undefined) candidate = empty();
      else {
        if (typeof raw !== "string" || !raw || raw.length > MAX_INDEX_BYTES)
          fail("Delivery automation index is damaged; original records were retained");
        try { candidate = JSON.parse(raw); }
        catch (_) { fail("Delivery automation index is damaged; original records were retained"); }
      }
      if (candidate && candidate.version === 1 && !Object.prototype.hasOwnProperty.call(candidate, "mergeIntent"))
        candidate.mergeIntent = null;
      if (candidate && candidate.version === 1 && Array.isArray(candidate.tasks)) {
        candidate.tasks.forEach(function (item) {
          if (item && !Object.prototype.hasOwnProperty.call(item, "bindingCode")) item.bindingCode = item.code;
        });
      }
      if (candidate && candidate.version === 1 && candidate.group && !Object.prototype.hasOwnProperty.call(candidate.group, "sessionId")) {
        var previous = candidate.group;
        candidate.group.sessionId = "";
        if (previous.on) {
          var probe = clone(candidate); probe.group.on = false;
          validate(probe);
          candidate.group = Object.assign(emptyGroup(), { openedAt: previous.openedAt,
            lastLayoutAt: previous.lastLayoutAt, expired: true, expiredAt: time() });
          validate(candidate);
          storage.setItem(KEY, JSON.stringify(candidate));
        }
      }
      state = validate(candidate);
      return state;
    }
    function time() { return timestamp(now()); }
    function mutate(change) {
      // Each operation rereads the atomic storage value so another panel's updates survive.
      var next = clone(read()), result = change(next);
      validate(next);
      var raw = JSON.stringify(next);
      if (raw.length > MAX_INDEX_BYTES) fail("Delivery automation index capacity reached; original records were retained");
      storage.setItem(KEY, raw);
      state = next;
      return result === undefined ? undefined : clone(result);
    }
    function taskIn(value, id) {
      taskId(id);
      var item = value.tasks.find(function (entry) { return entry.id === id; });
      if (!item) fail("Original delivery automation task was not found");
      return item;
    }
    function source(sourceKey) {
      text(sourceKey, 512);
      var value = read(), saved = value.sources.find(function (item) { return item.sourceKey === sourceKey; });
      if (!saved) return null;
      var result = clone(saved), latest = Object.create(null);
      value.tasks.filter(function (item) { return item.sourceKey === sourceKey; }).forEach(function (item) {
        if (!latest[item.specKey] || latest[item.specKey].updatedAt <= item.updatedAt) latest[item.specKey] = item;
      });
      result.specs = Object.keys(latest).map(function (key) {
        var item = latest[key];
        return { specKey: key, taskId: item.id, token: item.token, state: item.state,
          code: item.code, target: clone(item.target) };
      });
      return result;
    }
    function registerTask(input) {
      input = input || {};
      taskId(input.id); text(input.token, 8192);
      var legacy = input.legacy === true;
      text(input.sourceKey, 512, legacy); text(input.specKey, 512, legacy);
      return mutate(function (value) {
        var existing = value.tasks.find(function (item) { return item.id === input.id; });
        if (existing) {
          if (existing.token !== input.token || existing.sourceKey !== (input.sourceKey || "") ||
              existing.specKey !== (input.specKey || "") || existing.legacy !== legacy)
            fail("Delivery automation task identity conflict");
          return existing;
        }
        var reusable = !legacy && value.tasks.find(function (item) {
          return !item.legacy && item.sourceKey === input.sourceKey && item.specKey === input.specKey &&
            (item.state === "pending" || item.state === "retryable");
        });
        if (reusable) return reusable;
        var at = time(), task = { id: input.id, token: input.token, sourceKey: input.sourceKey || "",
          specKey: input.specKey || "", name: text(input.name, 512, true), mode: text(input.mode, 32, true),
          state: legacy ? "blocked" : "pending", legacy: legacy, code: "", bindingCode: "", target: null,
          error: "", createdAt: at, updatedAt: at, completedAt: 0 };
        value.tasks.push(task);
        return task;
      });
    }
    function markTask(id, patch) {
      patch = patch || {};
      Object.keys(patch).forEach(function (key) {
        if (["state", "code", "target", "error"].indexOf(key) < 0) fail("Delivery automation task identity cannot change");
      });
      if (Object.prototype.hasOwnProperty.call(patch, "target")) target(patch.target);
      return mutate(function (value) {
        var task = taskIn(value, id), at = time();
        if (task.state === "completed" && patch.state && patch.state !== "completed")
          fail("Completed delivery automation task cannot restart");
        if (task.legacy && (patch.state === "pending" || patch.state === "retryable"))
          fail("Legacy delivery automation task requires manual recovery");
        Object.keys(patch).forEach(function (key) { task[key] = clone(patch[key]); });
        if (!task.bindingCode && task.code) task.bindingCode = task.code;
        if (task.state === "completed" && !task.completedAt) task.completedAt = at;
        task.updatedAt = at;
        return task;
      });
    }
    function rememberSource(sourceKey, input) {
      text(sourceKey, 512); input = input || {};
      if (input.target !== undefined) target(input.target);
      return mutate(function (value) {
        var task = taskIn(value, input.taskId);
        if (task.legacy || task.sourceKey !== sourceKey || task.token !== input.token)
          fail("Delivery automation source/task binding conflict");
        var saved = { sourceKey: sourceKey, taskId: task.id, token: task.token,
          code: code(input.code || ""), target: target(input.target === undefined ? null : clone(input.target)), updatedAt: time() };
        var index = value.sources.findIndex(function (item) { return item.sourceKey === sourceKey; });
        if (index < 0) value.sources.push(saved); else value.sources[index] = saved;
        return saved;
      });
    }
    function forgetSource(sourceKey) {
      text(sourceKey, 512);
      return mutate(function (value) {
        value.sources = value.sources.filter(function (item) { return item.sourceKey !== sourceKey; });
      });
    }
    function tasks() { return clone(read().tasks); }
    function pendingTasks() {
      return tasks().filter(function (item) { return !item.legacy && (item.state === "pending" || item.state === "retryable"); });
    }
    function recentCompleted() {
      var at = time(), list = tasks().filter(function (item) {
        return !item.legacy && item.state === "completed" && item.completedAt <= at && at - item.completedAt <= RECENT_MS &&
          item.target && item.target.status === "ready" && !item.target.blocked && item.target.originalCodeActive !== false && item.target.deliveryId && item.code;
      }).sort(function (left, right) { return left.completedAt - right.completedAt || left.id.localeCompare(right.id); });
      var seen = Object.create(null);
      return list.filter(function (item) {
        if (seen[item.target.deliveryId]) return false;
        seen[item.target.deliveryId] = true;
        return true;
      });
    }
    function group() {
      var current = read().group, at = time();
      if (current.on && (at < current.lastLayoutAt || at < current.openedAt || at - current.lastLayoutAt >= IDLE_MS))
        return mutate(function (value) {
          value.group = Object.assign(emptyGroup(), { openedAt: value.group.openedAt,
            lastLayoutAt: value.group.lastLayoutAt, expired: true, expiredAt: at });
          return value.group;
        });
      return clone(current);
    }
    function setGroup(input) {
      input = input || {};
      if (typeof input.on !== "boolean") fail("Delivery automation group choice is required");
      Object.keys(input).forEach(function (key) {
        if (["on", "sessionId", "code", "target", "members", "requireActive"].indexOf(key) < 0) fail("Delivery automation group clock cannot change");
      });
      if (input.requireActive !== undefined && typeof input.requireActive !== "boolean") fail("Invalid delivery automation active-session guard");
      if (input.target !== undefined) target(input.target);
      if (input.on) taskId(input.sessionId);
      group();
      return mutate(function (value) {
        if (!input.on) { value.group = emptyGroup(); return value.group; }
        if (input.requireActive && (!value.group.on || value.group.sessionId !== input.sessionId)) return value.group;
        if (!value.group.on) {
          var at = time();
          value.group = Object.assign(emptyGroup(), { on: true, sessionId: input.sessionId, openedAt: at, lastLayoutAt: at });
        }
        if (value.group.sessionId !== input.sessionId) fail("Delivery automation group session has changed");
        ["code", "target", "members"].forEach(function (key) {
          if (input[key] !== undefined) value.group[key] = clone(input[key]);
        });
        return value.group;
      });
    }
    function touchGroup() {
      if (!group().on) return group();
      return mutate(function (value) { value.group.lastLayoutAt = time(); return value.group; });
    }
    function mergeIntent() { return clone(read().mergeIntent); }
    function setMergeIntent(input) {
      validateMergeIntent(input);
      return mutate(function (value) {
        if (input && value.mergeIntent && JSON.stringify(value.mergeIntent) !== JSON.stringify(input))
          fail("Unresolved delivery automation merge intent cannot change");
        value.mergeIntent = clone(input);
        return value.mergeIntent;
      });
    }
    read();
    return { source: source, registerTask: registerTask, markTask: markTask, tasks: tasks,
      pendingTasks: pendingTasks, rememberSource: rememberSource, forgetSource: forgetSource,
      recentCompleted: recentCompleted, group: group, setGroup: setGroup, touchGroup: touchGroup,
      mergeIntent: mergeIntent, setMergeIntent: setMergeIntent };
  }
  window.IDPhotoDeliveryAutomationStore = { KEY: KEY, create: create, IDLE_MS: IDLE_MS, RECENT_MS: RECENT_MS };
})();
