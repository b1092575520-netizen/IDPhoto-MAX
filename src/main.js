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


    selectionText = names.length ? "当前：" + getSelectedTemplateSummary() : "请选择尺寸";
    if (names.length > 1) {
      selectionText += "｜共 " + names.length + " 个版面";
    }

    parts.push(selectionText);
    parts.push("JPG " + (state.exportJpg ? "开" : "关"));
    parts.push("NAS " + (state.nasArchive ? "开" : "关"));
    parts.push("快印 " + (state.quickPrint ? "开" : "关"));
    parts.push("取件码 " + (state.pickupCodeMode ? "开" : "关"));
    parts.push("调试" + (isDebugModeEnabled() ? "开" : "关"));

    if (actionText) {
      parts.push(shortenStatusMessage(actionText));
    }

    statusText.textContent = parts.join("｜");
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

  function logStep(name, message, payload) {
    if (payload !== undefined) {
      console.log("[" + name + "] " + message, payload);
    } else {
      console.log("[" + name + "] " + message);
    }
  }

  function logStepError(name, error) {
    console.error("[" + name + "] failed", error);
  }

  async function showPickupCodeFailure(error) {
    var message = "取件码模式已中止\n\n" + errorToText(error) +
      "\n\n本次未输出成品、未提交打印。请检查交付后台是否运行、网络及交接目录是否一致。" +
      "\n若已生成独立交接副本，会保留待处理；本次未提交交付完成，网络恢复不会自动打印或发布。" +
      "\n如仅需普通排版，请关闭取件码模式，再使用“开始排版”。";
    setStatus(message);
    try {
      await window.IDPhotoPhotoshopExecution.getPhotoshop().app.showAlert(message);
    } catch (alertError) {
      logStepError("pickup-code-alert", alertError);
      setStatus(message + "；提示窗口未能打开：" + errorToText(alertError));
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
    var viewLabel = "排版";

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
      viewLabel = "设置";
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

    setStatus(message || "打开" + viewLabel);
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
      setStatus(message || (ids.length ? "已选：" + ids.map(getTemplateShortNameById).join("、") : "已取消选择尺寸"));
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
    var optionLabels = {
      exportJpg: "JPG",
      nasArchive: "NAS",
      quickPrint: "DS-RX1 快速打印",
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
        runButtonLabel.textContent = state.quickPrint ? "开始排版并打印" : "开始排版";
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
    }
    if (stateText) {
      stateText.textContent = state.quickPrint ? "开" : "关";
    }
    if (runButtonLabel) {
      runButtonLabel.textContent = state.quickPrint ? "开始排版并打印" : "开始排版";
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
    var delivery = options && typeof options.delivery === "boolean" ? options.delivery : state.pickupCodeMode;

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
    } catch (documentError) {
      logStepError("document", documentError);
      setStatus("documentService 失败：" + errorToText(documentError));
      return;
    }

    try {
      runResult = await getLayoutWorkflow().run({
        templateNames: templateNames,
        sourceDocument: sourceDocument,
        docInfo: docInfo,
        delivery: delivery,
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
      if (workflowError && workflowError.code === "PICKUP_CODE_REQUIRED") await showPickupCodeFailure(workflowError);
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

    var pickupFailure = failures.find(function (entry) { return entry.error && entry.error.code === "PICKUP_CODE_REQUIRED"; });
    if (pickupFailure) {
      // Keep the selection so the operator can correct the connection or choose
      // ordinary mode deliberately. A failure must never look like completion.
      await showPickupCodeFailure(pickupFailure.error);
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
    if (runResult.cancelled) completionMessage += "；用户已取消，后续模板未执行";
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
    var deliverButton = one("#deliverLayoutButton");
    if (deliverButton) deliverButton.addEventListener("click", function () {
      runCurrentTemplateSafely({ source: "排版并交付（沿用打印开关）", delivery: true });
    });
    var electronicButton = one("#electronicDeliveryButton");
    if (electronicButton) electronicButton.addEventListener("click", async function () {
      if (!beginPhotoshopOperation("delivery")) { setStatus("当前任务尚未完成，请稍候"); return; }
      try {
        var info = await readActiveDocumentForStatus("电子交付"), sourceDoc = getCurrentDocumentObject();
        if (!info || !sourceDoc || sourceDoc.id !== info.id) throw new Error("活动照片已改变，请重新确认");
        setStatus("正在生成当前照片的独立电子成片，不调用打印");
        var task = await window.IDPhotoDeliveryService.electronic(sourceDoc, info, window.IDPhotoSettingsStore.load());
        setStatus("电子成片已交接，等待后台发布；取件码 " + task.code + "；信息条：" + (task.status.info === "saved" ? "已保存" : "待重试"));
      } catch (error) {
        setStatus("电子交付未完成：" + errorToText(error));
        if (error && error.code === "PICKUP_CODE_REQUIRED") await showPickupCodeFailure(error);
      }
      finally { endPhotoshopOperation("delivery"); }
    });
    var configureDelivery = one("#configureDeliveryRoot");
    if (window.IDPhotoDeliveryDraftView) window.IDPhotoDeliveryDraftView.create({ currentDocumentId: function () { var doc = getCurrentDocumentObject(); return doc && doc.id; }, generate: async function (specs, target) {
      if (!beginPhotoshopOperation("delivery")) throw new Error("当前任务尚未完成，请稍候。");
      try {
        var info = await readActiveDocumentForStatus("多规格草稿"), sourceDoc = getCurrentDocumentObject();
        if (!info || !sourceDoc || sourceDoc.id !== info.id) throw new Error("活动照片已改变，请重新核对。");
        var task = await window.IDPhotoDeliveryService.multi(sourceDoc, info, window.IDPhotoSettingsStore.load(), specs, target);
        setStatus(task.status.message); return task;
      } finally { endPhotoshopOperation("delivery"); }
    } });
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
    setStatus("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
