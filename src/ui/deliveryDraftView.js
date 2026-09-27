(function () {
  "use strict";
  function create(options) {
    var panel = document.getElementById("multiDeliveryPanel"), rows = document.getElementById("deliverySpecRows"), target = null, targetDocumentId = null, busy = false;
    function message(text) { document.getElementById("multiDeliveryStatus").textContent = text; }
    function resetTarget() { target = null; targetDocumentId = null; document.getElementById("deliveryTargetText").textContent = "独立交付 · 不加入上一位顾客"; document.getElementById("deliveryTargetPreview").src = ""; }
    function field(parent, label, key, value, type) {
      var wrap = document.createElement("label"), title = document.createElement("span"), input = document.createElement("input");
      title.textContent = label; input.type = type || "text"; input.value = value == null ? "" : value; input.setAttribute("data-field", key);
      wrap.appendChild(title); wrap.appendChild(input); parent.appendChild(wrap); return input;
    }
    function add() {
      if (busy) return;
      if (rows.children.length >= 20) { message("每批最多 20 份照片。"); return; }
      var row = document.createElement("div"); row.className = "delivery-spec-row";
      field(row, "文件名（含 .jpg）", "filename", "照片-" + (rows.children.length + 1) + ".jpg");
      var sizes = document.createElement("div"); sizes.className = "delivery-spec-grid"; row.appendChild(sizes);
      field(sizes, "宽 px（空=原图）", "width", "", "number"); field(sizes, "高 px（空=原图）", "height", "", "number");
      field(sizes, "最小 KB（可空）", "minKB", "", "number"); field(sizes, "最大 KB（可空）", "maxKB", "", "number");
      field(sizes, "用途（可空）", "purpose", ""); field(sizes, "底色（可空）", "background", "");
      field(row, "允许最低 JPG 品质（1–12）", "minQuality", 8, "number");
      var remove = document.createElement("button"); remove.type = "button"; remove.textContent = "移除此规格"; remove.className = "panel-btn";
      remove.addEventListener("click", function () { if (!busy) rows.removeChild(row); }); row.appendChild(remove); rows.appendChild(row);
    }
    function read() {
      return Array.from(rows.children).map(function (row) {
        var values = {}; Array.from(row.querySelectorAll("input")).forEach(function (input) { values[input.getAttribute("data-field")] = input.value.trim(); });
        function number(key) { if (!values[key]) return 0; var value = Number(values[key]); if (!Number.isFinite(value) || value <= 0) throw new Error("尺寸、大小和品质请输入有效正数。"); return value; }
        return { filename: values.filename, width: number("width"), height: number("height"), minBytes: Math.ceil(number("minKB") * 1024), maxBytes: Math.floor(number("maxKB") * 1024),
          minQuality: number("minQuality") || 8, purpose: values.purpose, background: values.background };
      });
    }
    document.getElementById("multiDeliveryButton").addEventListener("click", function () { if (busy) return; resetTarget(); panel.style.display = "block"; if (!rows.children.length) add(); });
    document.getElementById("addDeliverySpec").addEventListener("click", add);
    document.getElementById("clearDeliveryTarget").addEventListener("click", function () { if (!busy) resetTarget(); });
    document.getElementById("chooseDeliveryTarget").addEventListener("click", async function () {
      if (busy) return;
      try {
        var uxp = require("uxp"), file = await uxp.storage.localFileSystem.getFileForOpening({ types: ["json"] }); if (!file) return;
        var text = await file.read({ format: uxp.storage.formats.utf8 }); if (text.length > 2000000) throw new Error("目标核对文件过大，请重新导出。");
        target = window.IDPhotoDeliverySpecifications.target(JSON.parse(text));
        targetDocumentId = options.currentDocumentId();
        if (!targetDocumentId) throw new Error("请先打开并选中本次顾客照片，再选择共领目标。");
        document.getElementById("deliveryTargetText").textContent = "本次加入：" + target.title + " · 主码 " + target.code + "。原已领取者将获得本次全部照片。";
        document.getElementById("deliveryTargetPreview").src = target.preview; message("核对目标缩略图与本次照片。完成、关闭后都会清除目标。");
      } catch (error) { resetTarget(); message(error.message || String(error)); }
    });
    document.getElementById("closeMultiDelivery").addEventListener("click", function () { if (!busy) { resetTarget(); panel.style.display = "none"; } });
    document.getElementById("generateDeliveryDraft").addEventListener("click", async function () {
      if (busy) return;
      if (target && targetDocumentId !== options.currentDocumentId()) { resetTarget(); message("活动照片已切换，已清除上一位顾客的共领目标。请重新核对后选择。"); return; }
      busy = true; var chosen = target; resetTarget();
      var controls = Array.from(panel.querySelectorAll("button,input")); controls.forEach(function (control) { control.disabled = true; });
      try { var specs = read(); message("正在生成独立规格，原片保持不变…"); await options.generate(specs, chosen); message("草稿已交接。请在后台核对并完成交付，再使用补码入口生成信息条。"); }
      catch (error) { message(error.message || String(error)); }
      finally { busy = false; controls.forEach(function (control) { control.disabled = false; }); }
    });
  }
  window.IDPhotoDeliveryDraftView = { create: create };
})();
