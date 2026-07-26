(function () {
  "use strict";

  var DEFAULT_STRATEGY = "auto";
  var validStrategies = {
    crop: true,
    "content-aware": true,
    auto: true
  };

  function normalize(strategy) {
    if (window.IDPhotoSettingsProfile && window.IDPhotoSettingsProfile.normalizeCropStrategy) {
      return window.IDPhotoSettingsProfile.normalizeCropStrategy(strategy);
    }
    return validStrategies[strategy] ? strategy : DEFAULT_STRATEGY;
  }

  function getLabel(strategy) {
    var normalized = normalize(strategy);
    if (normalized === "content-aware") {
      return "内容识别填充扩图";
    }
    if (normalized === "auto") {
      return "自动模式（1:1 自动补边）";
    }
    return "默认裁切";
  }

  function load() {
    try {
      return normalize(window.IDPhotoSettingsProfile.load().cropStrategy);
    } catch (error) {
      return DEFAULT_STRATEGY;
    }
  }

  function save(strategy) {
    var normalized = normalize(strategy);
    try {
      window.IDPhotoSettingsProfile.update("cropStrategy", normalized);
    } catch (error) {
      return {
        ok: false,
        strategy: normalized,
        message: "裁剪策略保存失败：" + error.message
      };
    }
    return {
      ok: true,
      strategy: normalized,
      message: "裁剪策略已保存：" + getLabel(normalized)
    };
  }

  window.IDPhotoCropStrategyStore = {
    DEFAULT_STRATEGY: DEFAULT_STRATEGY,
    normalize: normalize,
    getLabel: getLabel,
    load: load,
    save: save
  };
})();
