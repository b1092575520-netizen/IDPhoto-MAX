(function () {
  "use strict";

  var MODE_KEY = "idphoto-max-quick-print-mode";
  var LAST_ENABLED_KEY = "idphoto-max-quick-print-last-enabled";
  var CLOSE_AFTER_PRINT_KEY = "idphoto-max-close-after-print";

  function read(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function normalizeMode(value) {
    return value === "on" || value === "remember" ? value : "off";
  }

  function write(key, value) {
    if (!window.localStorage) {
      return false;
    }
    window.localStorage.setItem(key, value);
    return true;
  }

  function load() {
    var mode = normalizeMode(read(MODE_KEY));
    var lastEnabled = read(LAST_ENABLED_KEY) === "on";
    return {
      mode: mode,
      lastEnabled: lastEnabled,
      initialEnabled: mode === "on" || (mode === "remember" && lastEnabled),
      closeAfterPrint: read(CLOSE_AFTER_PRINT_KEY) === "on"
    };
  }

  function setMode(mode) {
    write(MODE_KEY, normalizeMode(mode));
    return load();
  }

  function recordLastEnabled(enabled) {
    if (load().mode === "remember") {
      write(LAST_ENABLED_KEY, enabled ? "on" : "off");
    }
    return load();
  }

  function setCloseAfterPrint(enabled) {
    write(CLOSE_AFTER_PRINT_KEY, enabled ? "on" : "off");
    return load();
  }

  window.IDPhotoQuickPrintPreferenceStore = {
    MODE_KEY: MODE_KEY,
    LAST_ENABLED_KEY: LAST_ENABLED_KEY,
    CLOSE_AFTER_PRINT_KEY: CLOSE_AFTER_PRINT_KEY,
    load: load,
    setMode: setMode,
    recordLastEnabled: recordLastEnabled,
    setCloseAfterPrint: setCloseAfterPrint
  };
})();
