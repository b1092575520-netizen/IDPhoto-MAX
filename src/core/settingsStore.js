(function () {
  "use strict";

  var defaults = {
    shopName: "福清印象照相馆",
    shopPhone: "13003825982（微信同号）",
    shopTip: "[请妥善保管此单据]"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function load() {
    try {
      return Object.assign(clone(defaults), window.IDPhotoSettingsProfile.load().shop);
    } catch (error) {
      return clone(defaults);
    }
  }

  function save(settings) {
    var merged = Object.assign(clone(defaults), settings || {});
    try {
      window.IDPhotoSettingsProfile.update("shop", merged);
    } catch (error) {
      return {
        ok: false,
        settings: merged,
        message: "配置暂存失败：" + error.message
      };
    }
    return {
      ok: true,
      settings: merged,
      message: "配置参数已保存：" + merged.shopName
    };
  }

  window.IDPhotoSettingsStore = {
    defaults: defaults,
    load: load,
    save: save
  };
})();
