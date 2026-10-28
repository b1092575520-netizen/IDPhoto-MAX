(function () {
  "use strict";

  // Display-only helpers for delivery status on the layout panel. Business code
  // decides what is true and calls these; nothing here talks to the backend.
  function create(options) {
    var root = (options && options.root) || document;
    var printHandler = null;
    var backgroundAnswer = null;
    var backgroundTimer = null;

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

    // Asked when the background colour of a shop photo cannot be read (10-20). Resolves
    // "red" / "blue" / "white", "plain" for layout without a code, or null when the
    // operator cancels (Esc) or leaves it for three minutes.
    function askBackground() {
      var panel = one("backgroundPicker");
      if (!panel) return Promise.resolve("plain");
      finishBackground(null);
      panel.style.display = "block";
      return new Promise(function (resolve) {
        backgroundAnswer = resolve;
        backgroundTimer = setTimeout(function () { finishBackground(null); }, 3 * 60 * 1000);
      });
    }

    function finishBackground(choice) {
      var answer = backgroundAnswer;
      var panel = one("backgroundPicker");
      backgroundAnswer = null;
      if (backgroundTimer) clearTimeout(backgroundTimer);
      backgroundTimer = null;
      if (panel) panel.style.display = "none";
      if (answer) answer(choice);
      return Boolean(answer);
    }

    [["backgroundRed", "red"], ["backgroundBlue", "blue"], ["backgroundWhite", "white"], ["backgroundPlain", "plain"]]
      .forEach(function (entry) {
        var button = one(entry[0]);
        if (button && button.addEventListener) button.addEventListener("click", function () { finishBackground(entry[1]); });
      });

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

    return {
      showPlan: showPlan,
      showRecovery: showRecovery,
      askBackground: askBackground,
      // true when an open background question was cancelled
      cancelBackground: function () { return finishBackground(null); }
    };
  }

  window.IDPhotoDeliveryStatusView = { create: create };
})();
