(function () {
  "use strict";

  // Display-only helpers for delivery status on the layout panel. Business code
  // decides what is true and calls these; nothing here talks to the backend.
  function create(options) {
    var root = (options && options.root) || document;
    var printHandler = null;

    function one(id) {
      return root.querySelector("#" + id);
    }

    // plan: null hides the line; { kind: "new" } a new delivery will take a new code;
    // { kind: "same", code } the same original photo keeps its code and replaces the photo;
    // { kind: "plain", text } layout only (blank strip), with an optional reason.
    function showPlan(plan) {
      var hint = one("deliveryPlanHint");
      var text = "";
      if (!hint) return;
      if (plan && plan.kind === "new") text = "新顾客 · 将取新码";
      else if (plan && plan.kind === "same") text = "同一张原片 · 沿用 " + String(plan.code || "原码") + "，替换照片";
      else if (plan && plan.kind === "plain") text = plan.text || "只排版 · 信息条留白";
      hint.textContent = text;
      hint.classList.toggle("same", Boolean(plan && plan.kind === "same"));
      hint.style.display = text ? "block" : "none";
    }

    // item: null hides the bar; { text, canPrint } shows a recovered task. The print
    // button only runs onPrint after the operator clicks it.
    function showRecovery(item, onPrint) {
      var bar = one("deliveryRecoveryBar");
      var text = one("deliveryRecoveryText");
      var print = one("deliveryRecoveryPrint");
      if (!bar || !text || !print) return;
      printHandler = item && item.canPrint && typeof onPrint === "function" ? onPrint : null;
      text.textContent = item ? String(item.text || "") : "";
      print.style.display = printHandler ? "block" : "none";
      bar.style.display = item ? "flex" : "none";
    }

    // count: drafts handed to the desktop backend and not yet published.
    function showDraftCount(count) {
      var button = one("multiDeliveryButton");
      var value = Number(count) || 0;
      if (!button) return;
      button.textContent = value > 0 ? "多规格 / 同行共领 · 暂存 " + value : "多规格 / 同行共领";
    }

    var printButton = one("deliveryRecoveryPrint");
    if (printButton && printButton.addEventListener) {
      printButton.addEventListener("click", function () {
        var handler = printHandler;
        if (!handler) return;
        printButton.disabled = true;
        Promise.resolve()
          .then(handler)
          .catch(function () {})
          .then(function () { printButton.disabled = false; });
      });
    }

    return { showPlan: showPlan, showRecovery: showRecovery, showDraftCount: showDraftCount };
  }

  window.IDPhotoDeliveryStatusView = { create: create };
})();
