(function () {
  "use strict";

  function toText(error) {
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

  function log(moduleName, error) {
    console.error("[" + moduleName + "] failed", error);
    return moduleName + " 失败：" + toText(error);
  }

  window.IDPhotoErrorService = {
    toText: toText,
    log: log
  };
})();
