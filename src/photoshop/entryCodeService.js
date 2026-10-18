(function () {
  "use strict";
  // The store's mini-program entry code ships with the plugin (user 10-18): one
  // link, two drawings. "logo" is the official code with the store logo; "coarse"
  // is the same link redrawn with 29 modules and no logo for the two thinnest strips.
  var ASSETS = {
    logo: { file: "entry-code.png", size: 1290,
      sha256: "bd477594c648607710250bc8492c7a614a1076c46df0f062d5b2b27b1a59ae79" },
    coarse: { file: "entry-code-coarse.png", size: 990,
      sha256: "f9f50aea67275bfb665d4cb3c911f91244c73aafd9918e6a2d1b329acd5679fc" }
  };
  function storage() { return require("uxp").storage; }
  function protocol() { return window.IDPhotoDeliveryProtocol; }
  async function assetFile(asset) {
    var folder = await storage().localFileSystem.getPluginFolder();
    return await (await (await folder.getEntry("src")).getEntry("assets")).getEntry(asset.file);
  }
  async function closeOwned(doc) {
    if (doc) await window.IDPhotoDocumentService.closeWithoutSaving(doc);
  }
  function pixels(value) { return Number(value && value.value !== undefined ? value.value : value); }
  // Opens the bundled image as its own flattened document; only that copy is ever closed.
  async function open(variant) {
    var asset = ASSETS[variant || "logo"];
    if (!asset) throw new Error("未知的小程序码样式：" + variant);
    var file = await assetFile(asset);
    var bytes = new Uint8Array(await file.read({ format: storage().formats.binary }));
    if (protocol().sha256(bytes) !== asset.sha256) throw new Error("插件自带的小程序码图片已损坏，请重新安装插件");
    var execution = window.IDPhotoPhotoshopExecution, owned = null;
    try {
      await execution.executeAsModal(async function () {
        var app = execution.getPhotoshop().app;
        var before = Array.from(app.documents).map(function (d) { return d.id; });
        await app.open(file);
        var created = Array.from(app.documents).filter(function (d) { return before.indexOf(d.id) === -1; });
        if (created.length !== 1) throw new Error("无法独立打开小程序码图片，已保留原有文档");
        owned = created[0];
        await execution.activateDocument(owned);
        await execution.batchPlay([{ _obj: "flattenImage", _options: { dialogOptions: "dontDisplay" } }]);
      }, "打开小程序码图片");
      if (pixels(owned.width) !== asset.size || pixels(owned.height) !== asset.size) throw new Error("小程序码图片尺寸不对");
    } catch (error) {
      if (owned) try { await closeOwned(owned); } catch (cleanupError) { console.warn("[entry-code] cleanup pending", cleanupError); }
      throw error;
    }
    return owned;
  }
  window.IDPhotoEntryCodeService = { open: open, close: closeOwned, ASSETS: ASSETS };
})();
