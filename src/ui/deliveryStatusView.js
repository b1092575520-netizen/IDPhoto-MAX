(function () {
  "use strict";

  // Display-only helpers for delivery status on the layout panel. Business code
  // decides what is true and calls these; nothing here talks to the backend.
  function create(options) {
    var root = (options && options.root) || document;
    var doc = root.createElement ? root : root.ownerDocument;
    var printHandler = null;
    var groupHandler = null;
    var groupBusy = false;
    var pickerHandler = null;

    function one(id) {
      return root.querySelector("#" + id);
    }

    // plan: null hides the line; { kind: "new" } a new delivery will take a new code;
    // { kind: "same", code } the same original photo keeps its code and replaces the photo;
    // { kind: "group", code } the photo joins the open group under its shared code;
    // { kind: "plain", text } layout only (blank strip), with an optional reason.
    function showPlan(plan) {
      var hint = one("deliveryPlanHint");
      var text = "";
      if (!hint) return;
      if (plan && plan.kind === "new") text = "新顾客 · 将取新码";
      else if (plan && plan.kind === "same") text = "同一张原片 · 沿用 " + String(plan.code || "原码") + "，替换照片";
      else if (plan && plan.kind === "group") text = "同行 · 并入 " + String(plan.code || "本组取件码");
      else if (plan && plan.kind === "plain") text = plan.text || "只排版 · 信息条留白";
      hint.textContent = text;
      hint.classList.toggle("same", Boolean(plan && (plan.kind === "same" || plan.kind === "group")));
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

    // Shows the 同行 switch. onToggle(wantOn) does the real work and resolves
    // once the state is known; the switch only changes through showGroup.
    function enableGroup(onToggle) {
      var toggle = one("groupToggle");
      if (!toggle) return;
      groupHandler = typeof onToggle === "function" ? onToggle : null;
      toggle.style.display = groupHandler ? "flex" : "none";
    }

    // group: null or { on: false } shows the switch off; { on: true, count, code }
    // marks it on and shows who is in the group.
    function showGroup(group) {
      var toggle = one("groupToggle");
      var status = one("groupStatus");
      var on = Boolean(group && group.on);
      var label;
      var text = "";
      if (toggle) {
        toggle.classList.toggle("active", on);
        toggle.setAttribute("aria-pressed", String(on));
        label = toggle.querySelector(".toggle-state");
        if (label) label.textContent = on ? "开" : "关";
      }
      if (on) {
        text = "同行中 · 已 " + (Number(group.count) || 0) + " 人" + (group.code ? " · 码 " + group.code : "");
      }
      if (status) {
        status.textContent = text;
        status.style.display = text ? "block" : "none";
      }
    }

    // items: recent customers [{ id, name, time, code, thumbnail }]. onConfirm(ids)
    // receives the ticked ids, or [] for "none". An empty list hides the picker.
    function showGroupPicker(items, onConfirm) {
      var panel = one("groupPicker");
      var list = one("groupPickerList");
      if (!panel || !list) return;
      while (list.firstChild) list.removeChild(list.firstChild);
      pickerHandler = items && items.length && typeof onConfirm === "function" ? onConfirm : null;
      (pickerHandler ? items : []).forEach(function (item) {
        var row = doc.createElement("label");
        var box = doc.createElement("input");
        var text = doc.createElement("span");
        row.className = "picker-row";
        box.type = "checkbox";
        box.setAttribute("data-id", String(item.id));
        row.appendChild(box);
        if (item.thumbnail) {
          var image = doc.createElement("img");
          image.className = "picker-thumb";
          image.src = item.thumbnail;
          image.alt = "";
          row.appendChild(image);
        }
        text.textContent = [item.time, item.name, item.code ? "码 " + item.code : ""].filter(Boolean).join(" · ");
        row.appendChild(text);
        list.appendChild(row);
      });
      panel.style.display = pickerHandler ? "block" : "none";
    }

    function finishPicker(ids) {
      var handler = pickerHandler;
      var panel = one("groupPicker");
      pickerHandler = null;
      if (panel) panel.style.display = "none";
      if (handler) handler(ids);
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

    var groupToggle = one("groupToggle");
    if (groupToggle && groupToggle.addEventListener) {
      groupToggle.addEventListener("click", function () {
        if (!groupHandler || groupBusy) return;
        groupBusy = true;
        Promise.resolve()
          .then(function () { return groupHandler(!groupToggle.classList.contains("active")); })
          .catch(function () {})
          .then(function () { groupBusy = false; });
      });
    }

    var confirm = one("groupPickerConfirm");
    if (confirm && confirm.addEventListener) {
      confirm.addEventListener("click", function () {
        var list = one("groupPickerList");
        var ids = [];
        if (list) {
          Array.prototype.forEach.call(list.querySelectorAll("input[type=checkbox]"), function (box) {
            if (box.checked) ids.push(box.getAttribute("data-id"));
          });
        }
        finishPicker(ids);
      });
    }
    var skip = one("groupPickerSkip");
    if (skip && skip.addEventListener) {
      skip.addEventListener("click", function () { finishPicker([]); });
    }

    return {
      showPlan: showPlan,
      showRecovery: showRecovery,
      enableGroup: enableGroup,
      showGroup: showGroup,
      showGroupPicker: showGroupPicker
    };
  }

  window.IDPhotoDeliveryStatusView = { create: create };
})();
