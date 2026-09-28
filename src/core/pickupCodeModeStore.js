(function () {
  "use strict";
  var KEY = "idphoto-max-pickup-code-mode";

  function load() {
    try {
      return Boolean(window.localStorage && window.localStorage.getItem(KEY) === "on");
    } catch (error) {
      return false;
    }
  }

  function setEnabled(enabled) {
    if (!window.localStorage) throw new Error("无法保存取件码模式，请重试。");
    window.localStorage.setItem(KEY, enabled ? "on" : "off");
    return load();
  }

  window.IDPhotoPickupCodeModeStore = { KEY: KEY, load: load, setEnabled: setEnabled };
})();
