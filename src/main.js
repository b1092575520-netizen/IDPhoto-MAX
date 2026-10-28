(function () {
  "use strict";

  // Record the discovered installation, since Adobe may find multiple folders with the same plugin id.
  (async function logRuntimeIdentity() {
    try {
      if (typeof require !== "function") return;
      var fs = require("uxp").storage.localFileSystem;
      if (!fs || typeof fs.getPluginFolder !== "function") return;
      var folder = await fs.getPluginFolder();
      var manifest = JSON.parse(await (await folder.getEntry("manifest.json")).read());
      console.log("[runtime] IDPhoto MAX " + manifest.version + " path=" + folder.nativePath);
    } catch (error) {
      console.warn("[runtime] Could not read plugin installation identity", error);
    }
  })();

  var state = {
    selectedTemplate: null,
    selectedTemplates: [],
    selectedTemplateIds: [],
    lastTemplateRangeAnchor: null,
    lastClickedTemplateId: null,
    rowGap: 10,
    colGap: 10,
    exportJpg: true,
    nasArchive: true,
    quickPrint: false,
    pickupCodeMode: false,
    closeAfterPrint: false,
    activeDocumentInfo: null,
    isRunning: false,
    activePhotoshopOperation: null,
    pendingTemplateSelection: null,
    modifierKeys: {
      ctrlKey: false,
      shiftKey: false,
      metaKey: false
    }
  };

  var settingsViewController = null;
  var layoutWorkflow = null;
  var deliveryStatusView = null;
  var automaticTickBusy = false;
  var automaticNotice = null;
  var planGeneration = 0;

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function normalizeName(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
  }

  function getBaseTemplateByName(name) {
    if (!window.IDPhotoTemplates) {
      return null;
    }
    return window.IDPhotoTemplates.getTemplateByName(name);
  }

  function getEffectiveTemplateByName(name) {
    var template;
    if (window.IDPhotoTemplateOverrideService && window.IDPhotoTemplateOverrideService.getEffectiveTemplateByName) {
      return window.IDPhotoTemplateOverrideService.getEffectiveTemplateByName(name);
    }
    template = getBaseTemplateByName(name);
    return template ? JSON.parse(JSON.stringify(template)) : null;
  }

  function getTemplateShortName(name) {
    var template = getBaseTemplateByName(name);
    return template && template.shortName ? template.shortName : String(name || "").split(" ")[0];
  }

  function getTemplateById(templateId) {
    if (!window.IDPhotoTemplates || !window.IDPhotoTemplates.getTemplateById) {
      return null;
    }
    return window.IDPhotoTemplates.getTemplateById(templateId);
  }

  function getTemplateIdByName(name) {
    var template = getBaseTemplateByName(name);
    return template ? template.id : String(name || "");
  }

  function getTemplateNameById(templateId) {
    var template = getTemplateById(templateId);
    return template ? template.name : String(templateId || "");
  }

  function getTemplateShortNameById(templateId) {
    var template = getTemplateById(templateId);
    return template && template.shortName ? template.shortName : getTemplateShortName(getTemplateNameById(templateId));
  }

  function getTemplateIdFromButton(button) {
    return getTemplateIdByName(button ? button.getAttribute("data-template") : "");
  }

  function getTemplateOrder() {
    if (window.IDPhotoTemplates && window.IDPhotoTemplates.getAllTemplates) {
      return window.IDPhotoTemplates.getAllTemplates().map(function (template) {
        return template.id;
      });
    }
    return all(".size-btn").map(function (button) {
      return getTemplateIdFromButton(button);
    });
  }

  function normalizeTemplateIds(templateIds) {
    var unique = [];

    (templateIds || []).forEach(function (templateId) {
      if (templateId && getTemplateById(templateId) && unique.indexOf(templateId) < 0) {
        unique.push(templateId);
      }
    });

    return unique;
  }

  function getSelectedTemplateNames() {
    return (state.selectedTemplateIds || []).map(getTemplateNameById);
  }

  function getSelectedTemplateSummary() {
    return getSelectedTemplateNames().map(getTemplateShortName).join("、");
  }

  function isDebugModeEnabled() {
    return Boolean(window.IDPhotoDebugSettingsStore && window.IDPhotoDebugSettingsStore.isEnabled && window.IDPhotoDebugSettingsStore.isEnabled());
  }

  function setStatus(message) {
    var statusText = one("#statusText");
    var names = getSelectedTemplateNames();
    var selectionText;
    var parts = [];
    var actionText = String(message || "").trim();

    if (!statusText) {
      return;
    }


    // Switch states are visible on the panel itself; the status line only
    // carries the selection and the latest message.
    selectionText = names.length ? "已选 " + getSelectedTemplateSummary() : "未选尺寸";
    if (names.length > 1) {
      selectionText += "（" + names.length + " 个版面）";
    }

    parts.push(selectionText);
    if (isDebugModeEnabled()) {
      parts.push("调试开");
    }

    if (actionText) {
      parts.push(shortenStatusMessage(actionText));
    }

    statusText.textContent = parts.join(" · ");
  }

  function shortenStatusMessage(message) {
    return String(message || "")
      .replace(/当前选中：/g, "当前：")
      .replace(/已选择尺寸：/g, "已选：")
      .replace(/当前操作：/g, "")
      .replace(/导出单张 JPG：开启/g, "JPG 已开")
      .replace(/导出单张 JPG：关闭/g, "JPG 已关")
      .replace(/NAS 日期归档：开启/g, "NAS 已开")
      .replace(/NAS 日期归档：关闭/g, "NAS 已关")
      .replace(/DS-RX1 快速打印：开启/g, "快印已开")
      .replace(/DS-RX1 快速打印：关闭/g, "快印已关")
      .replace(/ · /g, "｜")
      .replace(/\s+/g, " ")
      .trim();
  }

  function errorToText(error) {
    if (window.IDPhotoErrorService && window.IDPhotoErrorService.toText) {
      return window.IDPhotoErrorService.toText(error);
    }
    if (!error) {
      return "未知错误";
    }
    if (error.message) {
      return error.message;
    }
    try {
      return JSON.stringify(error);
    } catch (jsonError) {
      return String(error);
    }
  }

  // Every step carries the milliseconds since the run started, so the UXP log shows where time goes.
  var runStartedAt = 0;
  function logStep(name, message, payload) {
    if (name === "execute" && message === "start") runStartedAt = Date.now();
    var elapsed = runStartedAt ? " +" + (Date.now() - runStartedAt) + "ms" : "";
    if (payload !== undefined) {
      console.log("[" + name + "] " + message + elapsed, payload);
    } else {
      console.log("[" + name + "] " + message + elapsed);
    }
  }

  function logStepError(name, error) {
    console.error("[" + name + "] failed", error);
  }

  async function showPickupCodeFailure(error, doneSizes) {
    // Short on purpose: what happened, then the one thing to do. Unfinished
    // tasks continue automatically in the background (2026-10-17).
    var reason = errorToText(error), cause = error && (error.causeCode || error.code) || "";
    var title, body;
    var done = doneSizes && doneSizes.length ? "已出好：" + doneSizes.join("、") + "；这个尺寸和后面的没出。\n" : "";
    if (cause === "AUTO_TARGET_PREPARING" || cause === "AUTO_TASK_PENDING") {
      title = "这个尺寸稍后自动补上";
      body = done + "同一张照片的上一单还在后台处理，交付管理里还没到“可领取”。\n处理完插件会自动补做这个尺寸，补好后面板会提示你点“打印”，不用重新排。";
    } else {
      title = done ? "取件码没拿到，后面的尺寸没出" : "取件码没拿到，这次没出片";
      body = (done || "") + reason + "\n\n" + (done ? "" : "没有出成品，也没有打印。") +
        (error && error.retryable === false ? "请在交付管理里看看这单的原因。" :
        "\n请看看交付管理开着没有、网络通不通。连上后插件会自动再试，补好后面板会提示你点“打印”，不用重新排。");
    }
    setStatus(title + "：" + reason);
    try {
      await window.IDPhotoPhotoshopExecution.getPhotoshop().app.showAlert(title + "\n\n" + body);
    } catch (alertError) {
      logStepError("pickup-code-alert", alertError);
      setStatus(title + "：" + reason + "（提示窗口没打开：" + errorToText(alertError) + "）");
    }
  }

  function beginPhotoshopOperation(operationName) {
    if (state.activePhotoshopOperation) {
      return false;
    }
    state.activePhotoshopOperation = operationName;
    return true;
  }

  function endPhotoshopOperation(operationName) {
    if (!operationName || state.activePhotoshopOperation === operationName) {
      state.activePhotoshopOperation = null;
    }
  }

  function describeDocument(info) {
    if (!info) {
      return "当前没有打开照片，请先拖入照片到 Photoshop";
    }
    return "已读取当前文档：" + info.name + "，" + info.widthPx + "x" + info.heightPx + "px，" + info.resolution + "ppi";
  }

  async function readActiveDocumentForStatus(prefix) {
    var result;
    if (!window.IDPhotoDocumentService) {
      setStatus("Photoshop 文档服务未加载");
      return null;
    }

    try {
      result = await window.IDPhotoDocumentService.ensureActiveDocument();
    } catch (error) {
      logStepError("document", error);
      setStatus("documentService 失败：" + errorToText(error));
      return null;
    }

    if (!result.ok) {
      state.activeDocumentInfo = null;
      setStatus(result.message);
      return null;
    }

    state.activeDocumentInfo = result.document;
    setStatus((prefix ? prefix + " · " : "") + result.message);
    return result.document;
  }

  function getCurrentDocumentObject() {
    if (!window.IDPhotoDocumentService || !window.IDPhotoDocumentService.getActiveDocument) {
      return null;
    }
    try {
      return window.IDPhotoDocumentService.getActiveDocument();
    } catch (error) {
      console.error("[document] failed to get active document object", error);
      return null;
    }
  }

  function getSelectedCropStrategy() {
    if (settingsViewController && settingsViewController.getSelectedCropStrategy) {
      return settingsViewController.getSelectedCropStrategy();
    }
    var checked = one('input[name="cropStrategy"]:checked');
    var strategy = checked ? checked.value : null;
    if (window.IDPhotoCropStrategyStore && window.IDPhotoCropStrategyStore.normalize) {
      return window.IDPhotoCropStrategyStore.normalize(strategy || window.IDPhotoCropStrategyStore.load());
    }
    return strategy || "crop";
  }

  function getLayoutWorkflow() {
    if (!layoutWorkflow) {
      if (!window.IDPhotoLayoutWorkflow || typeof window.IDPhotoLayoutWorkflow.create !== "function") {
        throw new Error("layoutWorkflow 未加载");
      }
      layoutWorkflow = window.IDPhotoLayoutWorkflow.create({
        onStatus: setStatus,
        onStep: logStep,
        onError: logStepError
      });
    }
    return layoutWorkflow;
  }

  function switchView(targetId, message) {
    var tabs = all(".tab-button");
    var views = all(".view");

    tabs.forEach(function (item) {
      var active = item.getAttribute("data-view") === targetId;
      var icon = one(".tab-icon", item);
      item.classList.toggle("active", active);
      if (icon) {
        icon.setAttribute("data-icon", active ? "caret-down" : "caret-right");
        if (window.IDPhotoIcons && window.IDPhotoIcons.setIcon) {
          window.IDPhotoIcons.setIcon(icon, active ? "caret-down" : "caret-right");
        }
      }
    });

    views.forEach(function (view) {
      var active = view.id === targetId;
      view.classList.toggle("active", active);
      view.style.display = active ? "block" : "none";
    });

    if (targetId !== "settingsView" && settingsViewController && settingsViewController.showHome) {
      settingsViewController.showHome();
    }

    if (targetId === "settingsView") {
      refreshDebugStatus();
      if (settingsViewController && settingsViewController.showHome) {
        settingsViewController.showHome();
      }
      if (settingsViewController && settingsViewController.refresh) {
        settingsViewController.refresh().catch(function (error) {
          setStatus("读取当前照片信息失败：" + errorToText(error));
        });
      }
    }

    setStatus(message || "");
  }

  function syncTemplateButtons() {
    var buttons = all(".size-btn");
    var selected = state.selectedTemplateIds || [];

    buttons.forEach(function (button) {
      button.classList.toggle("active", selected.indexOf(getTemplateIdFromButton(button)) >= 0);
    });
  }

  function applySelectedTemplateIds(templateIds, currentTemplateId, message, preserveStatus) {
    var ids = normalizeTemplateIds(templateIds || []);
    var currentTemplate = currentTemplateId ? getTemplateById(currentTemplateId) : null;

    state.selectedTemplateIds = ids;
    state.selectedTemplates = ids.map(getTemplateNameById);
    if (ids.length) {
      state.selectedTemplate = currentTemplate && ids.indexOf(currentTemplateId) >= 0 ? currentTemplate.name : getTemplateNameById(ids[ids.length - 1]);
      state.lastTemplateRangeAnchor = state.selectedTemplate;
    }
    syncTemplateButtons();
    refreshDebugPanel();
    if (!preserveStatus) {
      // The status line already starts with the current selection.
      setStatus(message || (ids.length ? "" : "已取消选择尺寸"));
    }
  }

  function setSelectedTemplateNames(names, currentName, message) {
    var ids = (names || []).map(getTemplateIdByName);
    applySelectedTemplateIds(ids, currentName ? getTemplateIdByName(currentName) : null, message);
  }

  function selectTemplateByName(templateName, message) {
    var templateId = getTemplateIdByName(templateName);
    if (!getTemplateById(templateId)) {
      setStatus("未找到尺寸模板：" + templateName);
      return;
    }
    state.lastClickedTemplateId = templateId;
    applySelectedTemplateIds([templateId], templateId, message || "已选：" + getTemplateShortNameById(templateId));
  }

  function readTemplateClickModifiers(event, fallback) {
    var hasModifierState = event && typeof event.getModifierState === "function";
    var current = {
      ctrlKey: Boolean((event && event.ctrlKey) || (hasModifierState && event.getModifierState("Control")) || state.modifierKeys.ctrlKey),
      shiftKey: Boolean((event && event.shiftKey) || (hasModifierState && event.getModifierState("Shift")) || state.modifierKeys.shiftKey),
      metaKey: Boolean((event && event.metaKey) || (hasModifierState && event.getModifierState("Meta")) || state.modifierKeys.metaKey),
      detail: event && event.detail ? event.detail : 1
    };
    if (window.IDPhotoTemplateSelectionService && window.IDPhotoTemplateSelectionService.mergeModifiers) {
      return window.IDPhotoTemplateSelectionService.mergeModifiers(fallback, current);
    }
    return current;
  }

  function toggleTemplateId(templateId, selectedIds) {
    if (!window.IDPhotoTemplateSelectionService) {
      throw new Error("templateSelectionService 未加载");
    }
    return normalizeTemplateIds(window.IDPhotoTemplateSelectionService.toggle(selectedIds, templateId));
  }

  function selectTemplateRangeIds(fromTemplateId, toTemplateId, selectedIds) {
    var order = getTemplateOrder();
    var start = order.indexOf(fromTemplateId);
    var end = order.indexOf(toTemplateId);
    var range;
    if (start < 0 || end < 0) {
      return selectedIds.slice();
    }
    range = start <= end ? order.slice(start, end + 1) : order.slice(end, start + 1);
    range.forEach(function (templateId) {
      if (selectedIds.indexOf(templateId) < 0) {
        selectedIds.push(templateId);
      }
    });
    return normalizeTemplateIds(selectedIds);
  }

  function logSizeClick(label, payload) {
    console.log(label, {
      templateId: payload.templateId,
      "event.type": payload.eventType,
      "event.ctrlKey": Boolean(payload.ctrlKey),
      "event.shiftKey": Boolean(payload.shiftKey),
      "event.detail": payload.detail || 1,
      "selectedTemplateIds before": (payload.before || []).slice(),
      "selectedTemplateIds after": (payload.after || []).slice(),
      willExecute: Boolean(payload.willExecute)
    });
  }

  function handleTemplateClick(modifiers, templateId, eventType) {
    var before = (state.selectedTemplateIds || []).slice();
    var next;

    if (modifiers.shiftKey && state.lastClickedTemplateId) {
      next = selectTemplateRangeIds(state.lastClickedTemplateId, templateId, before.slice());
    } else {
      next = toggleTemplateId(templateId, before);
    }

    state.lastClickedTemplateId = templateId;
    applySelectedTemplateIds(next, templateId);
    logSizeClick("[size-click]", {
      templateId: templateId,
      eventType: eventType || "click",
      ctrlKey: modifiers.ctrlKey || modifiers.metaKey,
      shiftKey: modifiers.shiftKey,
      detail: modifiers.detail,
      before: before,
      after: state.selectedTemplateIds || []
    });
  }

  function scheduleTemplateClick(button, event) {
    var templateId = getTemplateIdFromButton(button);
    var modifiers = readTemplateClickModifiers(event, button.__idPhotoPointerModifiers);
    var before = (state.selectedTemplateIds || []).slice();
    var now = Date.now();
    var isRepeatedClick =
      window.IDPhotoTemplateSelectionService &&
      window.IDPhotoTemplateSelectionService.isRepeatedDoubleActivation &&
      window.IDPhotoTemplateSelectionService.isRepeatedDoubleActivation(button.__idPhotoClickAt, now);
    button.__idPhotoClickAt = now;
    button.__idPhotoPointerModifiers = null;

    logSizeClick("[size-click-event]", {
      templateId: templateId,
      eventType: event ? event.type : "click",
      ctrlKey: modifiers.ctrlKey || modifiers.metaKey,
      shiftKey: modifiers.shiftKey,
      detail: modifiers.detail,
      before: before,
      after: before
    });

    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    if (modifiers.detail > 1 || isRepeatedClick) {
      handleTemplateDoubleClick(button, event);
      return;
    }
    state.pendingTemplateSelection = {
      templateId: templateId,
      before: before,
      at: Date.now()
    };
    handleTemplateClick(modifiers, templateId, event ? event.type : "click");
  }

  function handleTemplateDoubleClick(button, event) {
    var templateId = getTemplateIdFromButton(button);
    var before = (state.selectedTemplateIds || []).slice();
    var pending = state.pendingTemplateSelection;
    var now = Date.now();
    var selectionBeforeDoubleClick =
      pending && pending.templateId === templateId && now - pending.at < 1000 ? pending.before : before;
    var next;

    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }

    if (
      window.IDPhotoTemplateSelectionService &&
      window.IDPhotoTemplateSelectionService.isRepeatedDoubleActivation &&
      window.IDPhotoTemplateSelectionService.isRepeatedDoubleActivation(button.__idPhotoDoubleActivationAt, now)
    ) {
      return;
    }
    button.__idPhotoDoubleActivationAt = now;

    state.pendingTemplateSelection = null;
    if (!window.IDPhotoTemplateSelectionService) {
      setStatus("多选服务未加载");
      return;
    }
    next = window.IDPhotoTemplateSelectionService.forDoubleClick(selectionBeforeDoubleClick, templateId);
    applySelectedTemplateIds(next, templateId, "双击执行：" + getTemplateShortNameById(templateId));
    logSizeClick("[size-dblclick]", {
      templateId: templateId,
      eventType: event ? event.type : "dblclick",
      detail: event && event.detail ? event.detail : 2,
      before: before,
      after: state.selectedTemplateIds || [],
      willExecute: true
    });

    if (!getTemplateById(templateId)) {
      setStatus("未找到尺寸模板：" + templateId);
      return;
    }
    runCurrentTemplateSafely({ source: "双击执行：" + getTemplateShortNameById(templateId) });
  }

  function toggleOption(key, message) {
    var button = one('.toggle-btn[data-key="' + key + '"]');
    var stateText;
    // JPG and NAS saving are always on; only printing and pickup codes are switchable.
    var optionLabels = {
      quickPrint: "打印",
      pickupCodeMode: "取件码模式"
    };
    var runButtonLabel;

    if (!optionLabels[key]) {
      return;
    }

    if (key === "pickupCodeMode") {
      if (state.activePhotoshopOperation) {
        setStatus("当前任务尚未结束，请结束后再切换取件码模式");
        return;
      }
      try {
        state.pickupCodeMode = window.IDPhotoPickupCodeModeStore.setEnabled(!state.pickupCodeMode);
        if (!state.pickupCodeMode && window.IDPhotoDeliveryAutomationService) window.IDPhotoDeliveryAutomationService.store().setGroup({ on: false });
      } catch (error) {
        setStatus("取件码模式未改变：" + errorToText(error));
        return;
      }
    } else {
      state[key] = !state[key];
    }
    if (button) {
      button.classList.toggle("active", state[key]);
      button.setAttribute("aria-pressed", String(state[key]));
      stateText = one(".toggle-state", button);
      if (stateText) {
        stateText.textContent = state[key] ? "开" : "关";
      }
    }

    if (key === "quickPrint") {
      if (window.IDPhotoQuickPrintPreferenceStore && window.IDPhotoQuickPrintPreferenceStore.recordLastEnabled) {
        window.IDPhotoQuickPrintPreferenceStore.recordLastEnabled(state.quickPrint);
      }
      runButtonLabel = one("#runButton .btn-label");
      if (runButtonLabel) {
        runButtonLabel.textContent = state.quickPrint ? "排版并打印" : "排版";
      }
    }

    setStatus((message ? message + "｜" : "") + optionLabels[key] + " 已" + (state[key] ? "开" : "关"));
  }

  function syncQuickPrintControls() {
    var button = one('.toggle-btn[data-key="quickPrint"]');
    var stateText = button ? one(".toggle-state", button) : null;
    var runButtonLabel = one("#runButton .btn-label");
    if (button) {
      button.classList.toggle("active", state.quickPrint);
      button.setAttribute("aria-pressed", String(state.quickPrint));
    }
    if (stateText) {
      stateText.textContent = state.quickPrint ? "开" : "关";
    }
    if (runButtonLabel) {
      runButtonLabel.textContent = state.quickPrint ? "排版并打印" : "排版";
    }
  }

  function applyQuickPrintPreference(enabled, mode) {
    state.quickPrint = Boolean(enabled);
    syncQuickPrintControls();
    setStatus(
      "快速打印启动方式：" +
      ({ off: "默认关闭", on: "默认打开", remember: "记住上次" }[mode] || "默认关闭")
    );
  }

  function applyCloseAfterPrintPreference(enabled) {
    state.closeAfterPrint = Boolean(enabled);
  }

  function loadQuickPrintPreference() {
    var preference = window.IDPhotoQuickPrintPreferenceStore && window.IDPhotoQuickPrintPreferenceStore.load
      ? window.IDPhotoQuickPrintPreferenceStore.load()
      : { mode: "off", initialEnabled: false, closeAfterPrint: false };
    state.quickPrint = Boolean(preference.initialEnabled);
    state.closeAfterPrint = Boolean(preference.closeAfterPrint);
    return preference;
  }

  function loadPickupCodeMode() {
    state.pickupCodeMode = Boolean(window.IDPhotoPickupCodeModeStore && window.IDPhotoPickupCodeModeStore.load());
    var button = one('.toggle-btn[data-key="pickupCodeMode"]');
    if (button) {
      button.classList.toggle("active", state.pickupCodeMode);
      button.setAttribute("aria-pressed", String(state.pickupCodeMode));
      var label = one(".toggle-state", button);
      if (label) label.textContent = state.pickupCodeMode ? "开" : "关";
    }
  }

  function getCurrentBaseTemplate() {
    return getBaseTemplateByName(state.selectedTemplate);
  }

  function rectFromDebugEntry(entry) {
    var rect;
    var fontSize;

    if (window.IDPhotoDebugSettingsStore && window.IDPhotoDebugSettingsStore.makeLayerRect) {
      return window.IDPhotoDebugSettingsStore.makeLayerRect(entry);
    }

    if (!entry || !entry.rect) {
      return null;
    }

    rect = {
      x: Math.round(entry.rect.x || 0),
      y: Math.round(entry.rect.y || 0),
      width: Math.max(1, Math.round(entry.rect.width || 1)),
      height: Math.max(1, Math.round(entry.rect.height || 1))
    };
    fontSize = Number(entry.fontSize);
    if (Number.isFinite(fontSize) && fontSize > 0) {
      rect.fontSize = Math.round(fontSize * 10) / 10;
    }
    return rect;
  }

  function makeDebugOverrideFromBounds(bounds, existingOverride) {
    var textLayers = {};
    var textKeys = ["shopNameDate", "shopName", "date", "phone", "tip", "pickupCode", "shopContact"];
    var existingTextLayers = existingOverride && existingOverride.textLayers ? existingOverride.textLayers : {};
    var savedTextCount = 0;
    var override = {
      infoBar: rectFromDebugEntry(bounds.background),
      avatar: rectFromDebugEntry(bounds.avatar)
    };

    textKeys.forEach(function (key) {
      var rect = rectFromDebugEntry(bounds.text && bounds.text[key]);
      if (rect) {
        textLayers[key] = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
        if (typeof rect.fontSize === "number") {
          textLayers[key].fontSize = rect.fontSize;
        }
        savedTextCount += 1;
      } else if (existingTextLayers[key]) {
        textLayers[key] = existingTextLayers[key];
      }
    });

    if (Object.keys(textLayers).length) {
      override.textLayers = textLayers;
    }
    override.__savedTextLayerCount = savedTextCount;

    if (existingOverride && existingOverride.fontSizes) {
      override.fontSizes = {};
      Object.keys(existingOverride.fontSizes).forEach(function (key) {
        var value = Number(existingOverride.fontSizes[key]);
        if (Number.isFinite(value) && value > 0) {
          override.fontSizes[key] = value;
        }
      });
      if (!Object.keys(override.fontSizes).length) {
        delete override.fontSizes;
      }
    }

    return override;
  }

  function refreshDebugStatus() {
    var status = one("#debugOverrideStatus");
    var template = getCurrentBaseTemplate();
    var hasOverride = template && window.IDPhotoTemplateOverrideService && window.IDPhotoTemplateOverrideService.hasOverride(template.id);

    if (!status) {
      return;
    }

    status.textContent =
      "当前模板：" +
      (template ? getTemplateShortName(template.name) : "-") +
      " | 调试覆盖：" +
      (hasOverride ? "已保存" : "无");
  }

  async function saveCurrentDebugOverrideFromDocument() {
    var template = getCurrentBaseTemplate();
    var documentRef = getCurrentDocumentObject();
    var bounds;
    var existingOverride;
    var override;
    var result;

    if (!template) {
      setStatus("当前模板不可用，无法保存调试 bounds");
      return;
    }
    if (!documentRef) {
      setStatus("请先打开已生成的拼版文档，再保存调试 bounds");
      return;
    }
    if (!window.IDPhotoLayerService || !window.IDPhotoLayerService.getDebugInfoBarLayerBounds) {
      setStatus("layerService 缺少调试 bounds 读取能力");
      return;
    }
    if (!window.IDPhotoDebugSettingsStore || !window.IDPhotoDebugSettingsStore.saveOverride) {
      setStatus("debugSettingsStore 未加载，无法保存调试 bounds");
      return;
    }

    bounds = window.IDPhotoLayerService.getDebugInfoBarLayerBounds(documentRef);
    if (!bounds.background || !bounds.avatar) {
      setStatus("未找到必要 DEBUG 图层，请先开启开发者调试模式并执行一次拼版");
      return;
    }

    existingOverride = window.IDPhotoTemplateOverrideService && window.IDPhotoTemplateOverrideService.getOverride ? window.IDPhotoTemplateOverrideService.getOverride(template.id) : null;
    if (template.infoBar.layoutVersion === 5 && existingOverride && existingOverride.layoutVersion !== 5) existingOverride = null;
    override = makeDebugOverrideFromBounds(bounds, existingOverride);
    override.layoutVersion = template.infoBar.layoutVersion;
    var savedTextLayerCount = override.__savedTextLayerCount || 0;
    delete override.__savedTextLayerCount;
    result = window.IDPhotoDebugSettingsStore.saveOverride(template.id, override);
    if (!result || !result.ok) {
      setStatus(result && result.message ? result.message : "调试参数保存失败");
      return;
    }
    if (window.IDPhotoTemplateOverrideService && window.IDPhotoTemplateOverrideService.applyRuntimeOverride) {
      window.IDPhotoTemplateOverrideService.applyRuntimeOverride(template.id, override);
    }
    refreshDebugStatus();
    setStatus((savedTextLayerCount ? "已保存文字层调试位置和字号" : result && result.message ? result.message : "调试 bounds 已保存") + "：" + getTemplateShortName(template.name));
  }

  function setDebugPanelVisible(enabled) {
    var toggle = one("#debugModeToggle");
    var stateText = toggle ? one(".toggle-state", toggle) : null;
    var panel = one("#debugPanel");

    if (toggle) {
      toggle.classList.toggle("active", enabled);
    }
    if (stateText) {
      stateText.textContent = enabled ? "开" : "关";
    }
    if (panel) {
      panel.style.display = enabled ? "block" : "none";
    }
    refreshDebugStatus();
  }

  function refreshDebugPanel() {
    refreshDebugStatus();
  }

  function resetCurrentDebugOverride() {
    var template = getCurrentBaseTemplate();
    var result;

    if (!template || !window.IDPhotoTemplateOverrideService) {
      setStatus("当前模板不可用，无法重置调试参数");
      return;
    }

    window.IDPhotoTemplateOverrideService.clearRuntimeOverride(template.id);
    if (window.IDPhotoDebugSettingsStore && window.IDPhotoDebugSettingsStore.clearOverride) {
      result = window.IDPhotoDebugSettingsStore.clearOverride(template.id);
    }
    refreshDebugPanel();
    setStatus((result ? result.message : "已重置当前模板调试参数") + "：" + getTemplateShortName(template.name));
  }

  function buildCompletionStatus(entry) {
    var templateName = entry && entry.templateName;
    var result = entry && entry.result;
    var placedCount = result && result.layerResult ? result.layerResult.placedCount : null;
    var text = "完成：" + getTemplateShortName(templateName);

    if (placedCount !== null && placedCount !== undefined) {
      text += "，共 " + placedCount + " 张";
    }
    if (result && result.infoResult && result.infoResult.createdCount > 0) {
      text += "，信息条已生成";
    }
    if (result && result.exportResult && result.exportResult.ok === false) {
      text += "；" + result.exportResult.message;
    }

    return text;
  }

  async function runCurrentTemplate(options) {
    state.pendingTemplateSelection = null;
    var explicitDelivery = options && typeof options.delivery === "boolean" ? options.delivery : null;
    var delivery = explicitDelivery === true;

    var templateNames = getSelectedTemplateNames();
    var docInfo;
    var sourceDocument;
    var source = options && options.source ? options.source : "点击主执行按钮";
    var runResult;
    var successes;
    var failures;
    var successResults;
    var exportFailures;
    var printFailures;
    var printedResults;
    var closedAfterPrintResults;
    var closeAfterPrintFailures;
    var duplicateExports;
    var replacedExports;
    var completionMessage;
    var deliveryIntent = null;
    var forceBlankInfoBar = false;
    var plainSourceMessage = "";

    if (!templateNames.length) {
      setStatus("请选择尺寸");
      return;
    }

    if (!beginPhotoshopOperation("layout")) {
      setStatus("Photoshop 正在执行排版，请稍候");
      return;
    }

    state.isRunning = true;
    logStep("execute", "start", { source: source, templates: templateNames });
    setStatus(source + "：执行选中模板");

    try {
      logStep("document", "reading active document");
      setStatus("步骤1：读取当前活动文档");
      docInfo = await readActiveDocumentForStatus("步骤1");
      if (!docInfo) {
        logStep("document", "no active document");
        return;
      }
      sourceDocument = getCurrentDocumentObject();
      if (!sourceDocument) {
        throw new Error("已读取文档信息，但无法取得 Photoshop 活动文档对象");
      }
      logStep("document", "success", docInfo);
      setStatus("步骤1成功：" + describeDocument(docInfo));
      // Decide from this original photo before creating any delivery copy/task.
      // An explicit delivery failure must never fall back to ordinary printing.
      if (explicitDelivery === null && state.pickupCodeMode) {
        var eligibilityService = window.IDPhotoSourceEligibilityService;
        if (!eligibilityService || typeof eligibilityService.checkSource !== "function") {
          throw new Error("照片来源判断未加载，请重新加载插件后再排版");
        }
        var sourceDecision = eligibilityService.checkSource(docInfo.sourceMetadata, docInfo.name);
        delivery = sourceDecision.eligible === true;
        if (delivery && window.IDPhotoDeliveryIdentity && !window.IDPhotoDeliveryIdentity.getSourceIdentity(docInfo)) {
          delivery = false; forceBlankInfoBar = true;
          plainSourceMessage = "这张照片读不到拍摄编号，本次只排版、不出取件码";
        }
        if (!delivery) {
          plainSourceMessage = plainSourceMessage || sourceDecision.message;
          setStatus(plainSourceMessage);
        }
      }
    } catch (documentError) {
      logStepError("document", documentError);
      setStatus("documentService 失败：" + errorToText(documentError));
      return;
    }

    try {
      if (delivery && window.IDPhotoVariantService && window.IDPhotoDeliveryAutomationService) {
        docInfo.sourceVariant = await window.IDPhotoVariantService.analyzeDocument(sourceDocument);
        // The delivery specification needs the background colour. When it cannot be read
        // the operator picks it on the panel (10-20); "只排版" keeps the plain sheet
        // without a code (10-17), Esc or no answer stops before anything is made.
        if (unknownBackground(docInfo)) {
          var picked = await askBackground();
          if (picked === null) {
            setStatus("没选底色，这次没排版");
            if (deliveryStatusView) deliveryStatusView.showPlan(null);
            return;
          }
          if (picked === "plain") {
            delivery = false;
            plainSourceMessage = UNKNOWN_BACKGROUND_MESSAGE;
            setStatus(plainSourceMessage);
          } else {
            docInfo.sourceVariant = Object.assign({}, docInfo.sourceVariant, { backgroundColor: picked, backgroundPicked: true });
          }
        }
      }
      if (deliveryStatusView && window.IDPhotoDeliveryAutomationService) {
        if (delivery) {
          if (templateNames.length === 1) showDeliveryPlan(docInfo, getEffectiveTemplateByName(templateNames[0]));
          else deliveryStatusView.showPlan(MULTI_SIZE_PLAN);
        } else deliveryStatusView.showPlan(state.pickupCodeMode ?
          (plainSourceMessage === UNKNOWN_BACKGROUND_MESSAGE ? UNKNOWN_BACKGROUND_PLAIN_PLAN : plainDeliveryPlan(sourceDecision)) : null);
      }
      runResult = await getLayoutWorkflow().run({
        templateNames: templateNames,
        sourceDocument: sourceDocument,
        docInfo: docInfo,
        delivery: delivery,
        deliveryIntent: deliveryIntent,
        forceBlankInfoBar: forceBlankInfoBar,
        cropStrategy: getSelectedCropStrategy(),
        exportJpg: state.exportJpg,
        nasArchive: state.nasArchive,
        tryExportSingle: Boolean(options && options.tryExportSingle),
        skipExport: Boolean(options && options.skipExport),
        quickPrint: state.quickPrint,
        closeAfterPrint: state.closeAfterPrint,
        skipPrint: Boolean(options && options.skipPrint),
        debugMode: options && typeof options.debugMode === "boolean" ? options.debugMode : isDebugModeEnabled(),
        rowGap: state.rowGap,
        colGap: state.colGap
      });
    } catch (workflowError) {
      logStepError("layout-workflow", workflowError);
      setStatus("排版任务失败：" + errorToText(workflowError));
      var execution = window.IDPhotoPhotoshopExecution;
      if (execution && execution.isCancellation && execution.isCancellation(workflowError)) setStatus("已停止：这单不再自动重做");
      else if (workflowError && workflowError.code === "PICKUP_CODE_REQUIRED") await showPickupCodeFailure(workflowError);
      return;
    } finally {
      if (settingsViewController && settingsViewController.refreshNasAuthorization) {
        settingsViewController.refreshNasAuthorization();
      }
    }

    successes = runResult.successes;
    failures = runResult.failures;
    successResults = runResult.successResults;
    exportFailures = runResult.exportFailures;
    printFailures = runResult.printFailures;
    printedResults = runResult.printedResults;
    closedAfterPrintResults = runResult.closedAfterPrintResults;
    closeAfterPrintFailures = runResult.closeAfterPrintFailures;
    duplicateExports = runResult.duplicateExports;
    replacedExports = runResult.replacedExports;

    // Esc is not a missing code: a cancelled run only reports that it stopped.
    var pickupFailure = runResult.cancelled ? null :
      failures.find(function (entry) { return entry.error && entry.error.code === "PICKUP_CODE_REQUIRED"; });
    if (pickupFailure) {
      // Keep the selection so the operator can correct the connection or choose
      // ordinary mode deliberately. A failure must never look like completion.
      await showPickupCodeFailure(pickupFailure.error, successes.map(getTemplateShortName));
      return;
    }

    if (failures.length) {
      completionMessage =
        "完成：" +
          successes.length +
          "/" +
          templateNames.length +
          "，失败：" +
          failures.length +
          "：" +
          failures.map(function (item) {
            return getTemplateShortName(item.templateName);
          }).join("、") +
          (failures.some(function (item) { return item.error && item.error.autoRedo; })
            ? "；没保存、没打印，后台会自动重做，好了面板提示你点“打印”" : "") +
          (exportFailures.length
            ? "；另有 JPG 导出失败：" +
              exportFailures.map(function (item) {
                return getTemplateShortName(item.templateName);
              }).join("、")
            : "");
    } else if (exportFailures.length) {
      completionMessage =
        "拼版完成：" +
          successes.length +
          "/" +
          templateNames.length +
          "；JPG 导出失败：" +
          exportFailures.map(function (item) {
            return getTemplateShortName(item.templateName);
          }).join("、");
    } else if (successResults.length === 1) {
      completionMessage = buildCompletionStatus(successResults[0]);
    } else {
      completionMessage = "完成：" + successes.length + "/" + templateNames.length;
    }
    if (duplicateExports.length) {
      completionMessage += "；同一原片 JPG 已跳过 " + duplicateExports.length + " 次";
    }
    if (replacedExports.length) {
      completionMessage += "；同组 JPG 已升级为更高像素 " + replacedExports.length + " 次";
    }
    var archiveNotices = [];
    successResults.forEach(function (entry) {
      var result = entry.result && entry.result.exportResult;
      if (result && (result.sourceNotOwned || result.identityUnverified || result.cleanupIncomplete || result.indexUnavailable || result.indexVisibilityWarning || result.indexSyncWarning)) {
        var notice = result.cleanupIncomplete ? "较小 JPG 清理失败，请检查目录权限" : result.message;
        if (archiveNotices.indexOf(notice) < 0) archiveNotices.push(notice);
      }
    });
    if (archiveNotices.length && successResults.length > 1) {
      completionMessage += "；" + archiveNotices.join("；");
    }
    if (printedResults.length) {
      completionMessage += "；DS-RX1 已提交打印 " + printedResults.length + " 张";
    }
    if (closedAfterPrintResults.length) {
      completionMessage += "；已不保存关闭拼版 " + closedAfterPrintResults.length + " 个";
    }
    if (closeAfterPrintFailures.length) {
      completionMessage +=
        "；打印后自动关闭失败：" +
        closeAfterPrintFailures.map(function (item) {
          return getTemplateShortName(item.templateName);
        }).join("、");
    }
    if (printFailures.length) {
      completionMessage +=
        "；DS-RX1 快印未确认成功：" +
        printFailures.map(function (item) {
          return getTemplateShortName(item.templateName);
        }).join("、") +
        (printFailures[0].result && printFailures[0].result.printResult && printFailures[0].result.printResult.message
          ? "（" + printFailures[0].result.printResult.message + "）"
          : "");
    }
    successResults.forEach(function (entry) {
      var delivery = entry.result && entry.result.deliveryResult;
      if (delivery && delivery.requested) completionMessage += "；" + delivery.message;
    });
    state.lastClickedTemplateId = null;
    if (runResult.cancelled) completionMessage += "；已停止：这单不再自动重做，后面的尺寸也没做";
    if (plainSourceMessage) completionMessage += "；" + plainSourceMessage;
    state.lastTemplateRangeAnchor = null;
    applySelectedTemplateIds(window.IDPhotoTemplateSelectionService.clear(), null, null, true);
    setStatus(completionMessage);
    logStep("execute", "done", { success: successes, failed: failures });
  }

  async function runCurrentTemplateSafely(options) {
    var previousOperation = state.activePhotoshopOperation;
    try {
      await runCurrentTemplate(options);
    } finally {
      if (!previousOperation && state.activePhotoshopOperation === "layout") {
        state.isRunning = false;
        endPhotoshopOperation("layout");
      }
    }
  }

  function runVisualAcceptance() {
    var templateIds = getTemplateOrder();
    if (!templateIds.length) {
      setStatus("视觉验收失败：没有可用模板");
      return;
    }
    applySelectedTemplateIds(getTemplateOrder(), templateIds[templateIds.length - 1], null, true);
    runCurrentTemplateSafely({
      source: "全模板视觉验收",
      delivery: false,
      skipExport: true,
      skipPrint: true,
      debugMode: false
    });
  }

  function bindTabs() {
    all(".tab-button").forEach(function (tab) {
      function openTab() {
        switchView(tab.getAttribute("data-view"));
      }
      tab.addEventListener("click", openTab);
    });
  }

  function bindSizeButtons() {
    all(".size-btn").forEach(function (button) {
      button.addEventListener("mousedown", function (event) {
        button.__idPhotoPointerModifiers = readTemplateClickModifiers(event);
      });
      button.addEventListener("click", function (event) {
        scheduleTemplateClick(button, event);
      });
      button.addEventListener("dblclick", function (event) {
        handleTemplateDoubleClick(button, event);
      });
    });
  }

  function bindToggleButtons() {
    all(".toggle-btn[data-key]").forEach(function (button) {
      button.addEventListener("click", function () {
        toggleOption(button.getAttribute("data-key"));
      });
    });
  }

  function bindModifierTracking() {
    // Esc in the panel stops a running layout at its next step (10-18); Photoshop's own
    // Esc still cancels a progress bar that is showing.
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (deliveryStatusView && deliveryStatusView.cancelBackground && deliveryStatusView.cancelBackground()) return;
      if (window.IDPhotoLayoutWorkflow && window.IDPhotoLayoutWorkflow.stopAll()) {
        setStatus("正在停止：做完当前这一步就停，不保存、不打印");
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Control") {
        state.modifierKeys.ctrlKey = true;
      } else if (event.key === "Shift") {
        state.modifierKeys.shiftKey = true;
      } else if (event.key === "Meta") {
        state.modifierKeys.metaKey = true;
      }
    });

    document.addEventListener("keyup", function (event) {
      if (event.key === "Control") {
        state.modifierKeys.ctrlKey = false;
      } else if (event.key === "Shift") {
        state.modifierKeys.shiftKey = false;
      } else if (event.key === "Meta") {
        state.modifierKeys.metaKey = false;
      }
    });

    window.addEventListener("blur", function () {
      state.modifierKeys.ctrlKey = false;
      state.modifierKeys.shiftKey = false;
      state.modifierKeys.metaKey = false;
    });
  }

  function bindMainActions() {
    var runButton = one("#runButton");
    var debugModeToggle = one("#debugModeToggle");
    var saveDebugTemplate = one("#saveDebugTemplate");
    var resetDebugTemplate = one("#resetDebugTemplate");
    var runVisualAcceptanceButton = one("#runVisualAcceptance");

    if (runButton) {
      runButton.addEventListener("click", function () {
        runCurrentTemplateSafely({ source: "点击主执行按钮" });
      });
    }
    var configureDelivery = one("#configureDeliveryRoot");
    var stopWait = one("#stopDeliveryWait");
    if (stopWait) stopWait.addEventListener("click", function () {
      setStatus(window.IDPhotoDeliveryService.stopWaiting() ?
        "已请求停止本机等待；原任务保留，不代表云端取消" : "当前没有正在等待的取码请求");
    });
    if (configureDelivery) configureDelivery.addEventListener("click", async function () {
      try { var path = await window.IDPhotoDeliveryService.configure(); if (path) setStatus("本机交接目录：" + path + "；请在后台选择同一目录，仅需配置一次"); }
      catch (error) { setStatus(errorToText(error)); }
    });
    var showDelivery = one("#showDeliveryRoot");
    if (showDelivery) showDelivery.addEventListener("click", async function () {
      try { setStatus("后台监听目录：" + (await window.IDPhotoDeliveryService.root()).nativePath); } catch (error) { setStatus(errorToText(error)); }
    });
    var regenerate = one("#regenerateDeliveryInfo");
    if (regenerate) regenerate.addEventListener("click", async function () {
      if (!beginPhotoshopOperation("delivery")) return;
      try { setStatus("原任务信息条已生成：" + await window.IDPhotoDeliveryService.regenerate()); }
      catch (error) { setStatus("补码未完成：" + errorToText(error)); }
      finally { endPhotoshopOperation("delivery"); }
    });
    var chooseDelivery = one("#chooseDeliveryInfo");
    if (chooseDelivery && window.IDPhotoDeliveryService.receiveInformationTasks) {
      var receiveInformation = document.createElement("button");
      receiveInformation.id = "receiveInformationTasks";
      receiveInformation.className = chooseDelivery.className;
      receiveInformation.textContent = "领取后台信息条任务";
      receiveInformation.type = "button";
      chooseDelivery.parentNode.insertBefore(receiveInformation, chooseDelivery);
      receiveInformation.addEventListener("click", async function () {
        if (!beginPhotoshopOperation("delivery")) return;
        receiveInformation.disabled = true;
        try {
          setStatus("正在领取后台信息条任务");
          var result = await window.IDPhotoDeliveryService.receiveInformationTasks();
          setStatus("后台信息条已完成 " + result.completed + " 份" +
            (result.failures.length ? "；未完成：" + result.failures[0] : "") +
            (result.remaining ? "；还有 " + result.remaining + " 份待下次领取" : ""));
        } catch (error) { setStatus("信息条领取未完成：" + errorToText(error)); }
        finally { receiveInformation.disabled = false; endPhotoshopOperation("delivery"); }
      });
    }
    if (chooseDelivery) chooseDelivery.addEventListener("click", async function () {
      if (!beginPhotoshopOperation("delivery")) return;
      try {
        var taskFolder = await require("uxp").storage.localFileSystem.getFolder();
        if (taskFolder) setStatus("所选原任务信息条已生成：" + await window.IDPhotoDeliveryService.regenerate(taskFolder));
      } catch (error) { setStatus("原任务补码未完成：" + errorToText(error)); }
      finally { endPhotoshopOperation("delivery"); }
    });

    if (debugModeToggle) {
      debugModeToggle.addEventListener("click", function () {
        var enabled = !isDebugModeEnabled();
        var result = window.IDPhotoDebugSettingsStore ? window.IDPhotoDebugSettingsStore.setEnabled(enabled) : null;
        setDebugPanelVisible(result && result.ok ? enabled : isDebugModeEnabled());
        refreshDebugPanel();
        setStatus(result ? result.message : "开发者调试模式：" + (enabled ? "开" : "关"));
      });
    }

    if (saveDebugTemplate) {
      saveDebugTemplate.addEventListener("click", function () {
        saveCurrentDebugOverrideFromDocument().catch(function (error) {
          logStepError("debug-save", error);
          setStatus("保存当前模板调试参数失败：" + errorToText(error));
        });
      });
    }

    if (resetDebugTemplate) {
      resetDebugTemplate.addEventListener("click", resetCurrentDebugOverride);
    }

    if (runVisualAcceptanceButton) {
      runVisualAcceptanceButton.addEventListener("click", runVisualAcceptance);
    }
  }

  function bindShortcuts() {
    if (!window.IDPhotoShortcutService) {
      return;
    }
    window.IDPhotoShortcutService.register({
      selectTemplate: selectTemplateByName,
      execute: runCurrentTemplateSafely,
      toggleOption: toggleOption,
      switchView: switchView
    });
  }

  function initSettings() {
    if (window.IDPhotoSettingsViewController && window.IDPhotoSettingsViewController.create) {
      settingsViewController = window.IDPhotoSettingsViewController.create({
        root: document,
        settingsStore: window.IDPhotoSettingsStore,
        cropStrategyStore: window.IDPhotoCropStrategyStore,
        exportService: window.IDPhotoExportService,
        documentService: window.IDPhotoDocumentService,
        sourceEligibilityService: window.IDPhotoSourceEligibilityService,
        settingsBackupService: window.IDPhotoSettingsBackupService,
        templateOverrideService: window.IDPhotoTemplateOverrideService,
        quickPrintPreferenceStore: window.IDPhotoQuickPrintPreferenceStore,
        onQuickPrintPreferenceChanged: applyQuickPrintPreference,
        onCloseAfterPrintChanged: applyCloseAfterPrintPreference,
        onSettingsRestored: function () {
          setDebugPanelVisible(isDebugModeEnabled());
          refreshDebugPanel();
        },
        onStatus: setStatus,
        formatError: errorToText
      });
      settingsViewController.init().catch(function (error) {
        setStatus("设置页初始化失败：" + errorToText(error));
      });
    }
    setDebugPanelVisible(isDebugModeEnabled());
    refreshDebugPanel();
  }

  function init() {
    if (window.IDPhotoDeliveryService && window.IDPhotoDeliveryService.onWaitingChanged)
      window.IDPhotoDeliveryService.onWaitingChanged(function (waiting) {
        var stop = one("#stopDeliveryWait"); if (stop) stop.style.display = waiting ? "block" : "none";
      });
    if (window.IDPhotoDeliveryService && window.IDPhotoDeliveryService.onProgress)
      window.IDPhotoDeliveryService.onProgress(function (message) {
        setStatus(message);
      });
    loadQuickPrintPreference();
    loadPickupCodeMode();
    initSettings();
    syncTemplateButtons();
    bindTabs();
    bindSizeButtons();
    bindToggleButtons();
    bindModifierTracking();
    bindMainActions();
    bindShortcuts();
    syncQuickPrintControls();
    initAutomaticDelivery();
    setStatus("");
  }

  function showDeliveryPlan(info, template) {
    var plan = window.IDPhotoDeliveryAutomationService.plan(info, "print", template);
    var previous = window.IDPhotoDeliveryAutomationService.store().source(plan.sourceKey);
    if (plan.kind === "same" && previous && !previous.specs.some(function (item) { return item.specKey === plan.specKey; }))
      deliveryStatusView.showPlan({ kind: "plain", text: "同一张原片 · 沿用 " + (plan.code || "原码") + "，追加照片" });
    else deliveryStatusView.showPlan(plan);
  }

  var MULTI_SIZE_PLAN = { kind: "plain", text: "多个尺寸 · 共用一个取件码，各打一张" };
  var UNKNOWN_BACKGROUND_PLAN = { kind: "plain", text: "认不出底色 · 排版时点一下红、蓝或白底" };
  var UNKNOWN_BACKGROUND_PLAIN_PLAN = { kind: "plain", text: "只排版 · 认不出底色，不出码" };
  var UNKNOWN_BACKGROUND_MESSAGE = "认不出底色，按你的选择只排版、不出取件码";

  function unknownBackground(info) {
    var color = info && info.sourceVariant && info.sourceVariant.backgroundColor;
    return !color || color === "unknown";
  }

  // "red" / "blue" / "white", "plain", or null when the operator cancels.
  async function askBackground() {
    if (!deliveryStatusView || typeof deliveryStatusView.askBackground !== "function") return "plain";
    setStatus("认不出底色：请在面板上点红底、蓝底或白底");
    logStep("background", "asking the operator");
    var picked = await deliveryStatusView.askBackground();
    logStep("background", "operator picked " + picked);
    return picked;
  }

  function plainDeliveryPlan(sourceDecision) {
    if (!sourceDecision) return { kind: "plain" };
    var reasons = {
      "plugin-export": "排版成品不出码，请打开相机原片",
      "historical-source": "不是今天拍的，不出码",
      "missing-serial": "读不到相机序列号，不出码",
      "no-registered-camera": "未登记本店相机，不出码",
      "external-camera": "外来照片，不出码",
      "unverified-capture-date": "读不到拍摄日期，不出码"
    };
    return { kind: "plain", text: "只排版 · " +
      (sourceDecision && reasons[sourceDecision.reason] || "读不到拍摄编号，不出码") };
  }

  async function refreshDeliveryPlan() {
    if (!deliveryStatusView || !window.IDPhotoDeliveryAutomationService) return;
    var generation = ++planGeneration;
    var selected = getSelectedTemplateNames();
    if (!state.pickupCodeMode || !selected.length) { deliveryStatusView.showPlan(null); return; }
    var info = await window.IDPhotoDocumentService.getActiveDocumentInfo(), doc = getCurrentDocumentObject();
    if (!info || !doc || doc.id !== info.id) { deliveryStatusView.showPlan(null); return; }
    var eligible = window.IDPhotoSourceEligibilityService.checkSource(info.sourceMetadata, info.name);
    if (!eligible.eligible || !window.IDPhotoDeliveryIdentity.getSourceIdentity(info)) {
      if (generation === planGeneration) deliveryStatusView.showPlan(plainDeliveryPlan(eligible));
      return;
    }
    info.sourceVariant = await window.IDPhotoVariantService.analyzeDocument(doc);
    var currentDocument = getCurrentDocumentObject();
    var current = getSelectedTemplateNames();
    if (generation !== planGeneration || !state.pickupCodeMode || current.length !== selected.length || current[0] !== selected[0] ||
      !currentDocument || currentDocument.id !== info.id) return;
    if (unknownBackground(info)) deliveryStatusView.showPlan(UNKNOWN_BACKGROUND_PLAN);
    else if (selected.length > 1) deliveryStatusView.showPlan(MULTI_SIZE_PLAN);
    else showDeliveryPlan(info, getEffectiveTemplateByName(selected[0]));
  }

  function initAutomaticDelivery() {
    if (!window.IDPhotoDeliveryStatusView || !window.IDPhotoDeliveryAutomationService) return;
    deliveryStatusView = window.IDPhotoDeliveryStatusView.create({ root: document });
    function showAutomaticNotice() {
      var notice = automaticNotice;
      deliveryStatusView.showRecovery(notice, async function () {
        if (!notice || !notice.canPrint || !beginPhotoshopOperation("recovered-print")) return;
        try {
          await window.IDPhotoDeliveryService.printRecovered(notice.id);
          if (automaticNotice === notice) automaticNotice = null;
          showAutomaticNotice(); setStatus("打印任务已提交");
        } catch (error) {
          automaticNotice = { id: notice.id, canPrint: false, text: "没打印：" + errorToText(error) };
          showAutomaticNotice(); setStatus(errorToText(error));
        } finally { endPhotoshopOperation("recovered-print"); }
      });
    }
    async function tick() {
      if (automaticTickBusy) return;
      automaticTickBusy = true;
      try {
        // 10-28: the 同行 switch is gone. A group an older version left open closes here so it
        // cannot pull new customers onto its code; a merge it started still reconciles below.
        try {
          if (window.IDPhotoDeliveryAutomationService.store().group().on) window.IDPhotoDeliveryAutomationService.store().setGroup({ on: false });
        } catch (error) { setStatus(errorToText(error)); }
        var mergeIntent = window.IDPhotoDeliveryAutomationService.store().mergeIntent();
        if (mergeIntent && !state.activePhotoshopOperation) {
          try { await window.IDPhotoDeliveryAutomationService.openGroup(mergeIntent.taskIds); }
          catch (error) { setStatus(errorToText(error)); }
        }
        if (!state.activePhotoshopOperation) {
          var pendingRecovery = await window.IDPhotoDeliveryService.primeRecovery();
          if (pendingRecovery && typeof pendingRecovery === "object") automaticNotice = pendingRecovery;
          var justRecovered = false;
          if (typeof pendingRecovery === "string" && beginPhotoshopOperation("auto-recovery")) {
            try {
              var recovered = await window.IDPhotoDeliveryService.recoverNext(pendingRecovery);
              if (recovered) { automaticNotice = recovered; justRecovered = true; }
            } finally { endPhotoshopOperation("auto-recovery"); }
          }
          // Nothing left to print: a remembered "可以打印" is gone too (it was printed or retired).
          var currentNotice = await window.IDPhotoDeliveryService.recoveredNotice();
          if (currentNotice) automaticNotice = currentNotice;
          else if (!justRecovered && automaticNotice && automaticNotice.canPrint) automaticNotice = null;
          showAutomaticNotice();
          if (beginPhotoshopOperation("auto-plan")) {
            try { await refreshDeliveryPlan(); }
            catch (error) { deliveryStatusView.showPlan(null); setStatus(errorToText(error)); }
            finally { endPhotoshopOperation("auto-plan"); }
          }
        }
      } catch (error) { setStatus(errorToText(error)); }
      finally { automaticTickBusy = false; setTimeout(tick, 5000); }
    }
    setTimeout(tick, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
