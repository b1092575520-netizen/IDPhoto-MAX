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
    return await action.batchPlay(commands, executionOptions);
  }

  async function executeAsModal(callback, commandName) {
    var core = getPhotoshop().core;
    if (!core || typeof core.executeAsModal !== "function") {
      throw new Error("当前 Photoshop UXP API 不支持 executeAsModal");
    }
    return await core.executeAsModal(callback, {
      commandName: commandName || "证件照排版"
    });
  }

  window.IDPhotoPhotoshopExecution = {
    getPhotoshop: getPhotoshop,
    batchPlay: batchPlay,
    executeAsModal: executeAsModal
  };
})();
