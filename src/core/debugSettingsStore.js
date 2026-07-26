(function () {
  "use strict";

  function makeLayerRect(entry) {
    var fontSize;
    var rect;

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

  function isEnabled() {
    try {
      return Boolean(window.IDPhotoSettingsProfile.load().debug.enabled);
    } catch (error) {
      return false;
    }
  }

  function setEnabled(enabled) {
    try {
      window.IDPhotoSettingsProfile.update("debug", { enabled: Boolean(enabled) });
    } catch (error) {
      return {
        ok: false,
        enabled: Boolean(enabled),
        message: "开发者调试模式保存失败：" + error.message
      };
    }
    return {
      ok: true,
      enabled: Boolean(enabled),
      message: "开发者调试模式：" + (enabled ? "开" : "关")
    };
  }

  function loadOverrides() {
    try {
      return window.IDPhotoSettingsProfile.load().debug.overrides || {};
    } catch (error) {
      return {};
    }
  }

  function saveOverrides(overrides) {
    try {
      window.IDPhotoSettingsProfile.update("debug", { overrides: overrides || {} });
    } catch (error) {
      return {
        ok: false,
        message: "调试参数保存失败：" + error.message
      };
    }
    return {
      ok: true,
      message: "调试参数已保存"
    };
  }

  function getOverride(templateId) {
    var overrides = loadOverrides();
    return overrides && templateId ? overrides[templateId] || null : null;
  }

  function saveOverride(templateId, override) {
    var overrides;
    var result;

    if (!templateId) {
      return {
        ok: false,
        message: "缺少模板 id，无法保存调试参数"
      };
    }

    overrides = loadOverrides();
    overrides[templateId] = override || {};
    result = saveOverrides(overrides);
    result.templateId = templateId;
    return result;
  }

  function clearOverride(templateId) {
    var overrides;
    var result;

    if (!templateId) {
      return {
        ok: false,
        message: "缺少模板 id，无法重置调试参数"
      };
    }

    overrides = loadOverrides();
    delete overrides[templateId];
    result = saveOverrides(overrides);
    result.templateId = templateId;
    result.message = "已重置当前模板调试参数";
    return result;
  }

  function hasOverride(templateId) {
    return Boolean(getOverride(templateId));
  }

  window.IDPhotoDebugSettingsStore = {
    makeLayerRect: makeLayerRect,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    loadOverrides: loadOverrides,
    getOverride: getOverride,
    saveOverride: saveOverride,
    clearOverride: clearOverride,
    hasOverride: hasOverride
  };
})();
