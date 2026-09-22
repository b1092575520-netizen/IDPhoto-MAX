(function () {
  "use strict";

  var photoshopModule = null;

  function getPhotoshop() {
    if (photoshopModule) {
      return photoshopModule;
    }
    if (typeof require !== "function") {
      throw new Error("当前环境无法访问 Photoshop UXP API");
    }
    photoshopModule = require("photoshop");
    return photoshopModule;
  }

  async function batchPlay(commands, options) {
    var action = getPhotoshop().action;
    var executionOptions = Object.assign(
      {
        synchronousExecution: false,
        modalBehavior: "execute"
      },
      options || {}
    );
    if (!action || typeof action.batchPlay !== "function") {
      throw new Error("当前 Photoshop API 不支持 batchPlay");
    }
    var results = await action.batchPlay(commands, executionOptions);
    (results || []).forEach(function (result, index) {
      if (result && result._obj === "error") {
        var error = new Error(result.message || "Photoshop 命令失败：" + (commands[index] && commands[index]._obj));
        error.number = result.result;
        error.commandIndex = index;
        throw error;
      }
    });
    return results;
  }

  function isCancellation(error) {
    return Boolean(error && (error.cancelled === true || error.number === -128 || error.code === -128));
  }

  function throwIfCancelled(error) {
    if (isCancellation(error)) throw error;
  }

  async function activateDocument(documentRef) {
    if (!documentRef) throw new Error("缺少要激活的文档");
    var app = getPhotoshop().app;
    var active = app && app.activeDocument;
    if (active && (active === documentRef || (active.id != null && documentRef.id != null && active.id === documentRef.id))) {
      return;
    }
    // Legacy adapters may provide activate; Photoshop DOM uses app.activeDocument.
    if (typeof documentRef.activate === "function") {
      await documentRef.activate();
      return;
    }
    if (!app) throw new Error("Photoshop app 不可用，无法激活目标文档");
    app.activeDocument = documentRef;
  }

  async function executeAsModal(callback, commandName) {
    var core = getPhotoshop().core;
    if (!core || typeof core.executeAsModal !== "function") {
      throw new Error("当前 Photoshop UXP API 不支持 executeAsModal");
    }
    return await core.executeAsModal(async function (context) {
      try {
        var result = await callback(context);
        if (context && context.isCancelled) {
          var cancelled = new Error("用户已取消操作");
          cancelled.number = -128;
          throw cancelled;
        }
        return result;
      } catch (error) {
        if (context && context.isCancelled) error.cancelled = true;
        throw error;
      }
    }, {
      commandName: commandName || "证件照排版"
    });
  }

  window.IDPhotoPhotoshopExecution = {
    getPhotoshop: getPhotoshop,
    activateDocument: activateDocument,
    isCancellation: isCancellation,
    throwIfCancelled: throwIfCancelled,
    batchPlay: batchPlay,
    executeAsModal: executeAsModal
  };
})();
