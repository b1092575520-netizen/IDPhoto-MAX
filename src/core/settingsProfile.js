(function () {
  "use strict";

  var PROFILE_KEY = "idphoto-max-profile-v1";
  var SCHEMA_VERSION = 1;
  var LEGACY_KEYS = {
    shop: "idphoto-max-settings",
    cropStrategy: "idphoto-max-crop-strategy",
    cropMigration: "idphoto-max-crop-strategy-auto-v1",
    cameras: "idphoto-max-shop-cameras",
    debugMode: "idphoto-max-debug-mode",
    debugOverrides: "idphoto-max-template-debug-overrides",
    nasLabel: "idphoto-max-nas-folder-label"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaults() {
    return {
      schemaVersion: SCHEMA_VERSION,
      shop: {
        shopName: "福清印象照相馆",
        shopPhone: "",
        shopTip: "[请妥善保管此单据]"
      },
      cropStrategy: "auto",
      cameras: [],
      debug: {
        enabled: false,
        overrides: {}
      },
      nas: {
        label: ""
      }
    };
  }

  function read(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function write(key, value) {
    if (!window.localStorage) {
      return false;
    }
    window.localStorage.setItem(key, value);
    return true;
  }

  function parseJson(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function normalizeCropStrategy(value) {
    if (value === "generative") {
      return "content-aware";
    }
    return value === "crop" || value === "content-aware" || value === "auto" ? value : "auto";
  }

  function normalizeProfile(value) {
    var base = defaults();
    var input = value && typeof value === "object" ? value : {};
    var debug = input.debug && typeof input.debug === "object" ? input.debug : {};
    var nas = input.nas && typeof input.nas === "object" ? input.nas : {};

    base.shop = Object.assign(base.shop, input.shop && typeof input.shop === "object" ? input.shop : {});
    base.cropStrategy = normalizeCropStrategy(input.cropStrategy);
    base.cameras = Array.isArray(input.cameras)
      ? input.cameras.filter(function (camera) {
          return camera && typeof camera === "object" && String(camera.serialNumber || "").trim();
        }).map(clone)
      : [];
    base.debug.enabled = Boolean(debug.enabled);
    base.debug.overrides = debug.overrides && typeof debug.overrides === "object" && !Array.isArray(debug.overrides)
      ? clone(debug.overrides)
      : {};
    base.nas.label = String(nas.label || "");
    return base;
  }

  function migrateLegacy() {
    var profile = defaults();
    var shop = parseJson(read(LEGACY_KEYS.shop), {});
    var cropStrategy = read(LEGACY_KEYS.cropStrategy);
    var cropMigrationDone = read(LEGACY_KEYS.cropMigration) === "done";
    var cameras = parseJson(read(LEGACY_KEYS.cameras), []);
    var overrides = parseJson(read(LEGACY_KEYS.debugOverrides), {});

    profile.shop = Object.assign(profile.shop, shop && typeof shop === "object" ? shop : {});
    if (!cropMigrationDone && (!cropStrategy || cropStrategy === "crop")) {
      profile.cropStrategy = "auto";
    } else {
      profile.cropStrategy = normalizeCropStrategy(cropStrategy);
    }
    profile.cameras = Array.isArray(cameras) ? cameras : [];
    profile.debug.enabled = read(LEGACY_KEYS.debugMode) === "on";
    profile.debug.overrides = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {};
    profile.nas.label = String(read(LEGACY_KEYS.nasLabel) || "");
    return normalizeProfile(profile);
  }

  function save(profile) {
    var normalized = normalizeProfile(profile);
    try {
      if (!write(PROFILE_KEY, JSON.stringify(normalized))) {
        throw new Error("本地存储不可用");
      }
    } catch (error) {
      throw new Error("设置档案保存失败：" + error.message);
    }
    return clone(normalized);
  }

  function load() {
    var raw = read(PROFILE_KEY);
    var parsed;
    if (raw) {
      parsed = parseJson(raw, null);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("设置档案损坏，请从有效备份恢复");
      }
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        throw new Error("设置档案版本不兼容，已保留原数据");
      }
      return normalizeProfile(parsed);
    }
    return save(migrateLegacy());
  }

  function update(section, value) {
    var profile = load();
    if (section === "shop") {
      profile.shop = Object.assign({}, profile.shop, value || {});
    } else if (section === "cropStrategy") {
      profile.cropStrategy = normalizeCropStrategy(value);
    } else if (section === "cameras") {
      profile.cameras = Array.isArray(value) ? value : [];
    } else if (section === "debug") {
      profile.debug = Object.assign({}, profile.debug, value || {});
    } else if (section === "nas") {
      profile.nas = Object.assign({}, profile.nas, value || {});
    } else {
      throw new Error("未知设置档案分区：" + section);
    }
    return save(profile);
  }

  function exportJson() {
    return JSON.stringify(load(), null, 2);
  }

  function importJson(raw) {
    var parsed;
    try {
      parsed = JSON.parse(String(raw || ""));
    } catch (error) {
      throw new Error("设置备份格式无效：无法解析 JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("设置备份格式无效：缺少设置对象");
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      throw new Error("设置备份版本无效或不兼容，无法恢复");
    }
    return save(parsed);
  }

  window.IDPhotoSettingsProfile = {
    PROFILE_KEY: PROFILE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    defaults: defaults,
    normalizeCropStrategy: normalizeCropStrategy,
    load: load,
    save: save,
    update: update,
    exportJson: exportJson,
    importJson: importJson
  };
})();
