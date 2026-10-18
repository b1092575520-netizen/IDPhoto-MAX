(function () {
  "use strict";
  // The mini-program entry code is drawn straight into the layout (user 10-18): no picture
  // is opened, so nothing flashes and every module edge is sharp. The store link ships with
  // the plugin; Settings can replace it by reading a new square code image once.
  var STORE_KEY = "IDPhotoMAX.entryCode.v1";
  var LOGO = { file: "entry-logo.rgb", width: 240,
    sha256: "cea3c5f518567112a4b4e8d91303762992f4daefc230ad7160a8b74e6b7c112c" };
  var logoCache = null;
  function storage() { return require("uxp").storage; }
  function imaging() { return require("photoshop").imaging; }
  function code() { return window.IDPhotoEntryCode; }
  function execution() { return window.IDPhotoPhotoshopExecution; }
  function readSaved() {
    try {
      var value = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null");
      return value && typeof value.text === "string" && value.text ? value : null;
    } catch (error) { return null; }
  }
  function current() {
    var saved = readSaved();
    return saved ? { text: saved.text, custom: true, at: saved.at || "" } : { text: code().DEFAULT_TEXT, custom: false };
  }
  function label() {
    var value = current();
    if (!value.custom) return "小程序码：本店默认（随插件自带）";
    return "小程序码：已更换为 " + value.text.replace(/^https?:\/\//, "").slice(0, 32) + (value.text.length > 40 ? "…" : "");
  }
  async function loadLogo() {
    if (logoCache) return logoCache;
    var folder = await storage().localFileSystem.getPluginFolder();
    var file = await (await (await folder.getEntry("src")).getEntry("assets")).getEntry(LOGO.file);
    var bytes = new Uint8Array(await file.read({ format: storage().formats.binary }));
    if (bytes.length !== LOGO.width * LOGO.width * 3 || window.IDPhotoDeliveryProtocol.sha256(bytes) !== LOGO.sha256)
      throw new Error("插件自带的小程序码 logo 已损坏，请重新安装插件");
    logoCache = { data: bytes, width: LOGO.width };
    return logoCache;
  }
  // Prepared before the drawing modal; a custom code is drawn without the store logo.
  async function prepare() {
    if (!imaging() || typeof imaging().putPixels !== "function") throw new Error("这版 Photoshop 不能直接画小程序码");
    var value = current(), logo = null;
    if (!value.custom) {
      try { logo = await loadLogo(); } catch (error) { console.warn("[entry-code] logo unavailable", error); }
    }
    return { text: value.text, custom: value.custom, logo: logo };
  }
  // Must run inside the caller's executeAsModal. `rect` is the square on the sheet.
  async function draw(targetDocument, prepared, rect, options) {
    var rendered = code().render({ text: prepared.text, variant: options.variant, size: rect.width,
      turn: options.turn, logo: prepared.logo });
    var layer = await targetDocument.createLayer("pixel", { name: options.name || "完整小程序码" });
    var data = await imaging().createImageDataFromBuffer(rendered.pixels,
      { width: rendered.size, height: rendered.size, components: 3, colorSpace: "RGB" });
    try {
      await imaging().putPixels({ documentID: targetDocument.id, layerID: layer.id, imageData: data,
        targetBounds: { left: rect.x, top: rect.y } });
    } finally { data.dispose(); }
    return layer;
  }

  function toRgba(bytes, width, height, components) {
    var rgba = new Uint8ClampedArray(width * height * 4);
    for (var i = 0; i < width * height; i++) {
      var src = i * components;
      rgba[i * 4] = bytes[src];
      rgba[i * 4 + 1] = components >= 3 ? bytes[src + 1] : bytes[src];
      rgba[i * 4 + 2] = components >= 3 ? bytes[src + 2] : bytes[src];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  // Both drawings of the new link must read back as exactly that link before it is kept.
  function selfCheck(text) {
    ["logo", "coarse"].forEach(function (variant) {
      var size = 6 * (code().matrix(text, code().STYLES[variant].level).count + 2 * code().STYLES[variant].margin);
      var rendered = code().render({ text: text, variant: variant, size: size });
      var read = window.IDPhotoQrDecode(toRgba(rendered.pixels, size, size, 3), size, size);
      if (!read || read.data !== text) throw new Error("新二维码自检没通过，已保留原来的码");
    });
  }
  function readCode(rgba, width, height) {
    var found = window.IDPhotoQrDecode(rgba, width, height, { inversionAttempts: "attemptBoth" });
    if (!found || !found.data) throw new Error("没认出二维码。请选微信里保存的方形二维码图片，圆形的小程序太阳码认不了");
    var text = String(found.data).trim();
    if (!/^https?:\/\/\S+$/.test(text) || text.length > 200) throw new Error("这张二维码里不是小程序链接，已保留原来的码");
    return text;
  }
  // Opens the chosen picture as its own document, reads its pixels and closes it again.
  async function replaceFromImage() {
    var file = await storage().localFileSystem.getFileForOpening({ types: ["png", "jpg", "jpeg"] });
    if (!file) return { cancelled: true, label: label() };
    var owned = null, picture = null;
    try {
      await execution().executeAsModal(async function () {
        var app = execution().getPhotoshop().app;
        var before = Array.from(app.documents).map(function (d) { return d.id; });
        await app.open(file);
        var created = Array.from(app.documents).filter(function (d) { return before.indexOf(d.id) === -1; });
        if (created.length !== 1) throw new Error("无法单独打开这张图片");
        owned = created[0];
        var width = Number(owned.width), height = Number(owned.height), scale = Math.min(1, 1600 / Math.max(width, height));
        var got = await imaging().getPixels({ documentID: owned.id, colorSpace: "RGB", componentSize: 8,
          targetSize: scale < 1 ? { width: Math.round(width * scale), height: Math.round(height * scale) } : undefined });
        try {
          var image = got.imageData;
          picture = { width: image.width, height: image.height, components: image.components, bytes: await image.getData() };
        } finally { got.imageData.dispose(); }
      }, "识别小程序码图片");
    } finally {
      if (owned) await window.IDPhotoDocumentService.closeWithoutSaving(owned);
    }
    var text = readCode(toRgba(picture.bytes, picture.width, picture.height, picture.components), picture.width, picture.height);
    selfCheck(text);
    if (text === code().DEFAULT_TEXT) window.localStorage.removeItem(STORE_KEY);
    else window.localStorage.setItem(STORE_KEY, JSON.stringify({ text: text, at: new Date().toISOString() }));
    return { text: text, label: label() };
  }
  function reset() { window.localStorage.removeItem(STORE_KEY); return label(); }

  window.IDPhotoEntryCodeService = { prepare: prepare, draw: draw, current: current, label: label,
    replaceFromImage: replaceFromImage, reset: reset, readCode: readCode, selfCheck: selfCheck };
})();
