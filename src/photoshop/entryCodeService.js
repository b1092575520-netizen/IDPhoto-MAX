(function () {
  "use strict";
  var KEY = "idphoto-verified-entry-code-v1";
  function storage() { return require("uxp").storage; }
  function protocol() { return window.IDPhotoDeliveryProtocol; }
  function record() {
    var raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    var value = JSON.parse(raw);
    if (value.version !== 1 || value.verified !== true ||
        !/^entry-code-[a-f0-9]{64}\.(png|jpg)$/.test(value.file || "") ||
        !/^[a-f0-9]{64}$/.test(value.sha256 || "") || value.width < 425 ||
        value.width !== value.height) throw new Error("小程序入口码配置损坏，请重新选择并核实");
    return value;
  }
  function label() {
    var value = record();
    return value ? "已核实：" + value.name : "未配置；成品不显示扫码提示";
  }
  async function openOwned(file) {
    var execution = window.IDPhotoPhotoshopExecution, owned = null;
    try { await execution.executeAsModal(async function () {
      var app = execution.getPhotoshop().app;
      var before = Array.from(app.documents).map(function (d) { return d.id; });
      await app.open(file);
      var created = Array.from(app.documents).filter(function (d) { return before.indexOf(d.id) === -1; });
      if (created.length !== 1) throw new Error("无法独立打开小程序码图片，已保留原有文档");
      owned = created[0];
      await execution.activateDocument(owned);
      await execution.batchPlay([{ _obj: "flattenImage", _options: { dialogOptions: "dontDisplay" } }]);
    }, "核实小程序码图片"); }
    catch (error) {
      // A decode/flatten failure must close only the asset copy created here.
      if (owned) try { await closeOwned(owned); } catch (cleanupError) { console.warn("[entry-code] cleanup pending", cleanupError); }
      throw error;
    }
    return owned;
  }
  async function closeOwned(doc) {
    if (doc) await window.IDPhotoDocumentService.closeWithoutSaving(doc);
  }
  function pixels(value) { return Number(value && value.value !== undefined ? value.value : value); }
  async function configure(verified) {
    if (verified !== true) throw new Error("请先确认入口码属于本店且已用微信扫码核实");
    var fs = storage().localFileSystem;
    var source = await fs.getFileForOpening({ types: ["png", "jpg", "jpeg"], allowMultiple: false });
    if (!source) return null;
    var bytes = new Uint8Array(await source.read({ format: storage().formats.binary }));
    var png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    var jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if ((!png && !jpg) || bytes.length > 16 * 1024 * 1024) throw new Error("请选择完整 PNG/JPG 小程序码图片（不超过16MB）");
    var hash = protocol().sha256(bytes), filename = "entry-code-" + hash + (png ? ".png" : ".jpg");
    var folder = await fs.getDataFolder(), file = await folder.createFile(filename, { overwrite: true });
    await file.write(bytes.buffer, { format: storage().formats.binary });
    var doc = null, value;
    try {
      doc = await openOwned(file);
      var width = pixels(doc.width), height = pixels(doc.height);
      if (width !== height || width < 425) throw new Error("入口码须为至少425×425像素的完整正方形图片，包含原有留白；请勿裁切");
      value = { version: 1, verified: true, name: source.name, file: filename, sha256: hash,
        width: width, height: height, verifiedAt: new Date().toISOString() };
    } finally { await closeOwned(doc); }
    // Commit the setting only after successful validation and document cleanup.
    window.localStorage.setItem(KEY, JSON.stringify(value));
    return value;
  }
  function clear() { window.localStorage.removeItem(KEY); }
  async function withAsset(callback) {
    var value = record();
    if (!value) return await callback(null);
    var file = await (await storage().localFileSystem.getDataFolder()).getEntry(value.file);
    var bytes = new Uint8Array(await file.read({ format: storage().formats.binary }));
    if (protocol().sha256(bytes) !== value.sha256) throw new Error("已核实入口码图片发生变化，已停止输出，请重新核实");
    var doc = null;
    try {
      doc = await openOwned(file);
      if (pixels(doc.width) !== value.width || pixels(doc.height) !== value.height) throw new Error("入口码尺寸与核实记录不一致");
      return await callback(doc);
    } finally { await closeOwned(doc); }
  }
  window.IDPhotoEntryCodeService = { configure: configure, clear: clear, label: label, withAsset: withAsset };
})();
