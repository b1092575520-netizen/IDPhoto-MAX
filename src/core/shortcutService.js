(function () {
  "use strict";

  var keyTemplateMap = {
    "1": "1寸 2.7x3.8",
    "2": "标准2寸 3.5x4.9",
    "3": "签证2寸 3.5x4.5",
    "4": "小2寸 3.3x4.8",
    "5": "香港台湾 3.0x4.0",
    "6": "巴西 4.0x5.0",
    "7": "阿根廷 4.0x4.0",
    "8": "美签 5.0x5.0",
    "9": "美签 5.1x5.1",
    "0": "毕业证 4.0x5.5",
    "-": "结婚照 5.3x3.5"
  };

  function isEditableTarget(target) {
    var tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
    return tagName === "input" || tagName === "textarea" || Boolean(target && target.isContentEditable);
  }

  function registerShortcuts(handlers) {
    document.addEventListener("keydown", function (event) {
      var key;
      var lowerKey;

      if (isEditableTarget(event.target)) {
        return;
      }

      key = event.key;
      lowerKey = String(key || "").toLowerCase();

      if ((event.ctrlKey || event.metaKey || event.altKey) && !(key === "Enter" && event.ctrlKey && !event.metaKey && !event.altKey)) {
        return;
      }

      if (keyTemplateMap[key]) {
        event.preventDefault();
        handlers.selectTemplate(keyTemplateMap[key], "快捷键 " + key + "：已选择" + keyTemplateMap[key]);
        return;
      }

      if (key === "Enter" && event.ctrlKey) {
        event.preventDefault();
        handlers.execute({ source: "快捷键 Ctrl+Enter", tryExportSingle: true });
        return;
      }

      if (key === "Enter") {
        event.preventDefault();
        handlers.execute({ source: "快捷键 Enter" });
        return;
      }

      if (lowerKey === "j") {
        event.preventDefault();
        handlers.toggleOption("exportJpg", "快捷键 J：切换导出单张 JPG");
        return;
      }

      if (lowerKey === "n") {
        event.preventDefault();
        handlers.toggleOption("nasArchive", "快捷键 N：切换 NAS 日期归档");
        return;
      }

      if (lowerKey === "s") {
        event.preventDefault();
        handlers.switchView("settingsView", "快捷键 S：打开店铺参数设置");
        return;
      }

      if (lowerKey === "a") {
        event.preventDefault();
        handlers.switchView("mainView", "快捷键 A：打开自动排版大师");
      }
    });
  }

  window.IDPhotoShortcutService = {
    register: registerShortcuts,
    keyTemplateMap: keyTemplateMap
  };
})();
