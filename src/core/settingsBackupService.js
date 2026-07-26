(function () {
  "use strict";

  function getStorage() {
    var uxp;
    if (typeof require !== "function") {
      throw new Error("当前环境无法访问 UXP storage API");
    }
    uxp = require("uxp");
    if (!uxp || !uxp.storage || !uxp.storage.localFileSystem) {
      throw new Error("当前 UXP 环境不支持设置备份文件");
    }
    return uxp.storage;
  }

  function getProfile() {
    if (!window.IDPhotoSettingsProfile) {
      throw new Error("settingsProfile 未加载");
    }
    return window.IDPhotoSettingsProfile;
  }

  async function exportBackup() {
    var storage = getStorage();
    var fs = storage.localFileSystem;
    var file = await fs.getFileForSaving("idphoto-max-settings-v1.json", { types: ["json"] });
    if (!file) {
      return { ok: false, cancelled: true, message: "已取消设置备份" };
    }
    await file.write(getProfile().exportJson(), {
      format: storage.formats && storage.formats.utf8 ? storage.formats.utf8 : "utf8"
    });
    return {
      ok: true,
      fileName: file.name || "idphoto-max-settings-v1.json",
      message: "设置备份已保存：" + (file.name || "idphoto-max-settings-v1.json")
    };
  }

  async function importBackup() {
    var storage = getStorage();
    var fs = storage.localFileSystem;
    var picked = await fs.getFileForOpening({ types: ["json"], allowMultiple: false });
    var file = Array.isArray(picked) ? picked[0] : picked;
    var raw;
    var profile;
    if (!file) {
      return { ok: false, cancelled: true, message: "已取消恢复设置" };
    }
    raw = await file.read({
      format: storage.formats && storage.formats.utf8 ? storage.formats.utf8 : "utf8"
    });
    profile = getProfile().importJson(raw);
    return {
      ok: true,
      fileName: file.name || "设置备份.json",
      profile: profile,
      message: "设置已恢复：" + (file.name || "设置备份.json")
    };
  }

  window.IDPhotoSettingsBackupService = {
    exportBackup: exportBackup,
    importBackup: importBackup
  };
})();
