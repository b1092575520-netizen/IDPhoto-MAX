(function () {
  "use strict";

  var runtimeOverrides = {};

  function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
  }

  function numberOrNull(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function setNumber(target, key, value) {
    var number = numberOrNull(value);
    if (number !== null) {
      target[key] = Math.round(number);
    }
  }

  function setFloatNumber(target, key, value) {
    var number = numberOrNull(value);
    if (number !== null && number > 0) {
      target[key] = Math.round(number * 10) / 10;
    }
  }

  function getStoredOverride(templateId) {
    if (!window.IDPhotoDebugSettingsStore || !window.IDPhotoDebugSettingsStore.getOverride) {
      return null;
    }
    return window.IDPhotoDebugSettingsStore.getOverride(templateId);
  }

  function getOverride(templateId) {
    return runtimeOverrides[templateId] || getStoredOverride(templateId);
  }

  function hasOverride(templateId) {
    return Boolean(getOverride(templateId));
  }

  function applyRuntimeOverride(templateId, override) {
    if (templateId) {
      runtimeOverrides[templateId] = clone(override) || {};
    }
  }

  function clearRuntimeOverride(templateId) {
    if (templateId) {
      delete runtimeOverrides[templateId];
    }
  }

  function clearAllRuntimeOverrides() {
    runtimeOverrides = {};
  }

  function applyTextOverride(texts, override) {
    var fontSizes = override.fontSizes || {};
    var textLayers = override.textLayers || {};

    if (!texts) {
      return;
    }

    if (Array.isArray(texts)) {
      texts.forEach(function (item, index) {
        var layerRect = textLayers[item.key];
        if (override.textBlock) {
          if (typeof override.textBlock.x === "number") {
            item.x = override.textBlock.x;
          }
          if (index === 0 && typeof override.textBlock.y === "number") {
            item.y = override.textBlock.y;
          }
          if (typeof override.textBlock.lineGap === "number") {
            item.lineGap = override.textBlock.lineGap;
          }
        }
        if (layerRect) {
          setNumber(item, "x", layerRect.x);
          setNumber(item, "y", layerRect.y);
          setNumber(item, "width", layerRect.width);
          setNumber(item, "height", layerRect.height);
          setFloatNumber(item, "fontSize", layerRect.fontSize);
          item.debugFixedPosition = true;
        }
        if (typeof fontSizes[item.key] === "number") {
          item.fontSize = fontSizes[item.key];
        }
      });
      return;
    }

    if (override.textBlock) {
      setNumber(texts, "x", override.textBlock.x);
      setNumber(texts, "y", override.textBlock.y);
      setNumber(texts, "lineGap", override.textBlock.lineGap);
    }

    if (Object.keys(textLayers).length) {
      texts.columns = Object.assign({}, texts.columns || {});
      Object.keys(textLayers).forEach(function (key) {
        texts.columns[key] = Object.assign({}, texts.columns[key] || {});
        setNumber(texts.columns[key], "x", textLayers[key].x);
        setNumber(texts.columns[key], "y", textLayers[key].y);
        setNumber(texts.columns[key], "width", textLayers[key].width);
        setNumber(texts.columns[key], "height", textLayers[key].height);
        setFloatNumber(texts.columns[key], "fontSize", textLayers[key].fontSize);
      });
      texts.debugFixedPosition = true;
    }

    texts.fontSizes = Object.assign({}, texts.fontSizes || {});
    ["shopNameDate", "shopName", "date", "phone", "tip"].forEach(function (key) {
      if (typeof fontSizes[key] === "number") {
        texts.fontSizes[key] = fontSizes[key];
      }
    });
  }

  function applyOverride(template, override) {
    var next = clone(template);
    var textLayerKeys;

    if (!next || !override || !next.infoBar) {
      return next;
    }

    if (override.infoBar) {
      setNumber(next.infoBar, "x", override.infoBar.x);
      setNumber(next.infoBar, "y", override.infoBar.y);
      setNumber(next.infoBar, "width", override.infoBar.width);
      setNumber(next.infoBar, "height", override.infoBar.height);
    }

    if (override.avatar) {
      next.infoBar.avatar = Object.assign({}, next.infoBar.avatar || {});
      setNumber(next.infoBar.avatar, "x", override.avatar.x);
      setNumber(next.infoBar.avatar, "y", override.avatar.y);
      setNumber(next.infoBar.avatar, "width", override.avatar.width);
      setNumber(next.infoBar.avatar, "height", override.avatar.height);
    }

    if (override.textLayers && Object.keys(override.textLayers).length) {
      next.infoBar.textLayers = {};
      textLayerKeys = Object.keys(override.textLayers);
      textLayerKeys.forEach(function (key) {
        next.infoBar.textLayers[key] = {};
        setNumber(next.infoBar.textLayers[key], "x", override.textLayers[key].x);
        setNumber(next.infoBar.textLayers[key], "y", override.textLayers[key].y);
        setNumber(next.infoBar.textLayers[key], "width", override.textLayers[key].width);
        setNumber(next.infoBar.textLayers[key], "height", override.textLayers[key].height);
        setFloatNumber(next.infoBar.textLayers[key], "fontSize", override.textLayers[key].fontSize);
      });
    }

    applyTextOverride(next.infoBar.texts, override);
    if (next.infoBar.pickupLayout === "v5") {
      var bar = next.infoBar, space = template.deliveryArea || template.infoBar;
      if (bar.x < space.x || bar.y < space.y ||
          bar.x + bar.width > space.x + space.width || bar.y + bar.height > space.y + space.height ||
          Math.max(bar.width, bar.height) > 1417 || Math.min(bar.width, bar.height) < 150)
        throw new Error("取码信息条调试尺寸超出模板空位或6厘米限制，请恢复本模板默认布局");
      bar.safeMargin = 24;
      // V5 typography is measured and fitted as one coherent reading layout.
      // Old independent text rectangles cannot override or remove its code.
      delete bar.textLayers; delete bar.avatar;
    }
    next.debugOverrideApplied = true;
    return next;
  }

  function getEffectiveTemplate(template) {
    var override = template ? getOverride(template.id) : null;
    // Old debug rectangles describe full-length strips. Keep their saved data,
    // but do not apply them to the new detachable region or remove its code.
    if (template && template.infoBar && override &&
        (template.infoBar.layoutVersion || 0) !== (override.layoutVersion || 0)) override = null;
    return override ? applyOverride(template, override) : clone(template);
  }

  function getEffectiveTemplateByName(name) {
    var template;
    if (!window.IDPhotoTemplates || !window.IDPhotoTemplates.getTemplateByName) {
      return null;
    }
    template = window.IDPhotoTemplates.getTemplateByName(name);
    return getEffectiveTemplate(template);
  }

  function readTextDefaults(texts) {
    var result = {
      x: 0,
      y: 0,
      lineGap: 0,
      fontSizes: {
        shopNameDate: 0,
        shopName: 0,
        date: 0,
        phone: 0,
        tip: 0
      }
    };

    if (Array.isArray(texts)) {
      texts.forEach(function (item, index) {
        if (index === 0) {
          result.x = Math.round(item.x || 0);
          result.y = Math.round(item.y || 0);
          result.lineGap = Math.round(item.lineGap || 0);
        }
        if (item.key && typeof item.fontSize === "number") {
          result.fontSizes[item.key] = item.fontSize;
        }
      });
      return result;
    }

    if (texts) {
      result.x = Math.round(texts.x || 0);
      result.y = Math.round(texts.y || 0);
      result.lineGap = Math.round(texts.lineGap || 0);
      ["shopNameDate", "shopName", "date", "phone", "tip"].forEach(function (key) {
        result.fontSizes[key] =
          texts.fontSizes && typeof texts.fontSizes[key] === "number" ? texts.fontSizes[key] : 0;
      });
    }

    return result;
  }

  function getDebugValues(template) {
    var effective = getEffectiveTemplate(template);
    var infoBar = effective && effective.infoBar ? effective.infoBar : {};
    var avatar = infoBar.avatar || {};
    var text = readTextDefaults(infoBar.texts);

    return {
      infoBar: {
        x: Math.round(infoBar.x || 0),
        y: Math.round(infoBar.y || 0),
        width: Math.round(infoBar.width || 0),
        height: Math.round(infoBar.height || 0)
      },
      avatar: {
        x: Math.round(avatar.x || 0),
        y: Math.round(avatar.y || 0),
        width: Math.round(avatar.width || 0),
        height: Math.round(avatar.height || 0)
      },
      textBlock: {
        x: Math.round(text.x || 0),
        y: Math.round(text.y || 0),
        lineGap: Math.round(text.lineGap || 0)
      },
      fontSizes: text.fontSizes
    };
  }

  window.IDPhotoTemplateOverrideService = {
    applyOverride: applyOverride,
    applyRuntimeOverride: applyRuntimeOverride,
    clearRuntimeOverride: clearRuntimeOverride,
    clearAllRuntimeOverrides: clearAllRuntimeOverrides,
    getOverride: getOverride,
    hasOverride: hasOverride,
    getEffectiveTemplate: getEffectiveTemplate,
    getEffectiveTemplateByName: getEffectiveTemplateByName,
    getDebugValues: getDebugValues
  };
})();
