"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const controllerPath = path.join(__dirname, "..", "src", "ui", "settingsViewController.js");

function makeElement(options = {}) {
  const listeners = new Map();
  return {
    value: options.value || "",
    textContent: options.textContent || "",
    checked: Boolean(options.checked),
    disabled: Boolean(options.disabled),
    listeners,
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    click() {
      (listeners.get("click") || []).forEach((handler) => handler());
    },
    hover() {
      (listeners.get("mouseenter") || []).forEach((handler) => handler());
    }
  };
}

function makeClassedElement(classNames = []) {
  const element = makeElement();
  const classes = new Set(classNames);
  element.classList = {
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
    contains(name) { return classes.has(name); }
  };
  return element;
}

function makeAccordionCard(open = false, title = "设置项") {
  const classes = new Set(["settings-card"]);
  const icon = makeElement();
  const toggle = makeElement({ textContent: title });
  const attributes = new Map();
  if (open) {
    classes.add("open");
  }
  toggle.querySelector = (selector) => (selector === ".section-caret" ? icon : null);
  toggle.setAttribute = (name, value) => attributes.set(name, value);
  return {
    toggle,
    attributes,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    querySelector(selector) {
      return selector === ".settings-card-toggle" ? toggle : null;
    }
  };
}

function makeRoot(options = {}) {
  const elements = {
    shopName: makeElement(),
    shopPhone: makeElement(),
    shopTip: makeElement(),
    currentCameraStatus: makeElement(),
    shopCameraStatus: makeElement(),
    nasFolderStatus: makeElement(),
    saveSettings: makeElement(),
    backupSettings: makeElement(),
    restoreSettings: makeElement(),
    authorizeNasFolder: makeElement(),
    clearNasFolder: makeElement(),
    registerCurrentCamera: makeElement({ disabled: true }),
    clearShopCameras: makeElement(),
    settingsView: makeClassedElement(["settings-view"]),
    settingsBackButton: makeElement({ textContent: "← 返回设置" })
  };
  const cropInputs = [
    Object.assign(makeElement(), { value: "crop" }),
    Object.assign(makeElement(), { value: "content-aware" })
  ];
  const settingsCards = options.settingsCards || [];
  return {
    elements,
    cropInputs,
    querySelector(selector) {
      if (selector === 'input[name="cropStrategy"]:checked') {
        return cropInputs.find((input) => input.checked) || null;
      }
      return selector.startsWith("#") ? elements[selector.slice(1)] || null : null;
    },
    querySelectorAll(selector) {
      if (selector === ".settings-card") {
        return settingsCards;
      }
      return selector === 'input[name="cropStrategy"]' ? cropInputs : [];
    }
  };
}

function loadController() {
  const context = { window: {}, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(controllerPath, "utf8"), context, { filename: controllerPath });
  return context.window.IDPhotoSettingsViewController;
}

test("init reads the active Canon camera and binds settings actions only once", async () => {
  const root = makeRoot();
  const registered = [];
  let cameraRegistered = false;
  const controller = loadController().create({
    root,
    settingsStore: {
      load() {
        return { shopName: "福清印象照相馆", shopPhone: "13000000000", shopTip: "请妥善保管" };
      }
    },
    cropStrategyStore: {
      load() {
        return "content-aware";
      },
      normalize(value) {
        return value;
      }
    },
    exportService: {
      getNasAuthorizationLabel() {
        return "picture";
      },
      hasNasAuthorization() {
        return true;
      }
    },
    documentService: {
      async getActiveDocumentInfo() {
        return {
          name: "1M9A3405.JPG",
          sourceMetadata: {
            make: "Canon",
            model: "Canon EOS R6 Mark III",
            serialNumber: "160402000589",
            hasXmp: true
          }
        };
      }
    },
    sourceEligibilityService: {
      getRegistrationSummary() {
        return cameraRegistered ? "Canon Canon EOS R6 Mark III · 尾号 0589" : "尚未登记本店相机";
      },
      checkSource() {
        return { eligible: cameraRegistered };
      },
      registerCamera(metadata) {
        registered.push(metadata);
        cameraRegistered = true;
        return { ok: true, message: "已登记本店相机" };
      }
    }
  });

  await controller.init();
  await controller.init();

  assert.equal(root.elements.shopName.value, "福清印象照相馆");
  assert.equal(root.cropInputs[1].checked, true);
  assert.equal(root.elements.nasFolderStatus.value, "已授权：picture");
  assert.match(root.elements.currentCameraStatus.value, /Canon EOS R6 Mark III/);
  assert.match(root.elements.currentCameraStatus.value, /0589/);
  assert.equal(root.elements.registerCurrentCamera.disabled, false);
  assert.equal(root.elements.registerCurrentCamera.textContent, "设为本店相机");
  assert.equal(root.elements.registerCurrentCamera.listeners.get("click").length, 1);

  root.elements.registerCurrentCamera.click();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].serialNumber, "160402000589");
  assert.equal(root.elements.registerCurrentCamera.disabled, true);
  assert.equal(root.elements.registerCurrentCamera.textContent, "已登记，可自动保存");
  assert.match(root.elements.shopCameraStatus.value, /0589/);
});

test("an external photo without camera metadata finishes with saving disabled", async () => {
  const root = makeRoot();
  const controller = loadController().create({
    root,
    documentService: {
      async getActiveDocumentInfo() {
        return {
          name: "c29d217ddc6a9e552ddc781789dbfaf.jpg",
          sourceMetadata: { make: "", model: "", serialNumber: "", hasXmp: false }
        };
      }
    }
  });

  await controller.init();

  assert.match(root.elements.currentCameraStatus.value, /没有机身序列号/);
  assert.match(root.elements.currentCameraStatus.value, /不保存/);
  assert.equal(root.elements.registerCurrentCamera.disabled, true);
});

test("settings cards only navigate on click so pointer travel cannot open the wrong detail", async () => {
  const first = makeAccordionCard(false, "照片保存来源");
  const second = makeAccordionCard(false, "店铺与信息条");
  const root = makeRoot({ settingsCards: [first, second] });
  const controller = loadController().create({ root });

  await controller.init();
  assert.equal(first.classList.contains("open"), false);
  assert.equal(second.classList.contains("open"), false);
  assert.equal(root.elements.settingsView.classList.contains("detail-open"), false);
  assert.equal((root.elements.settingsBackButton.listeners.get("mouseenter") || []).length, 0);
  assert.equal((first.toggle.listeners.get("mouseenter") || []).length, 0);
  assert.equal((second.toggle.listeners.get("mouseenter") || []).length, 0);

  second.toggle.hover();
  assert.equal(second.classList.contains("open"), false);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(first.classList.contains("open"), false);
  assert.equal(second.classList.contains("open"), false);
  assert.equal(root.elements.settingsView.classList.contains("detail-open"), false);

  second.toggle.click();
  assert.equal(second.classList.contains("open"), true);
  assert.equal(root.elements.settingsView.classList.contains("detail-open"), true);
  assert.equal(first.attributes.get("aria-expanded"), "false");
  assert.equal(second.attributes.get("aria-expanded"), "true");
  assert.match(root.elements.settingsBackButton.textContent, /店铺与信息条/);

  root.elements.settingsBackButton.hover();
  assert.equal(second.classList.contains("open"), true);
  assert.equal(root.elements.settingsView.classList.contains("detail-open"), true);

  root.elements.settingsBackButton.click();
  assert.equal(second.classList.contains("open"), false);
  assert.equal(root.elements.settingsView.classList.contains("detail-open"), false);

  first.toggle.click();
  assert.equal(first.classList.contains("open"), true);
  assert.equal(second.classList.contains("open"), false);

  root.elements.settingsBackButton.click();
  assert.equal(first.classList.contains("open"), false);
  assert.equal(second.classList.contains("open"), false);

});

test("backup and restore refresh every settings field and clear runtime template overrides", async () => {
  const root = makeRoot();
  const statuses = [];
  let profile = {
    shop: { shopName: "旧店名", shopPhone: "旧电话", shopTip: "旧提示" },
    cropStrategy: "crop"
  };
  let clearedRuntimeOverrides = 0;
  let restoredUi = 0;
  const controller = loadController().create({
    root,
    settingsStore: {
      load() {
        return profile.shop;
      }
    },
    cropStrategyStore: {
      load() {
        return profile.cropStrategy;
      },
      normalize(value) {
        return value;
      }
    },
    exportService: {
      getNasAuthorizationLabel() {
        return profile.nasLabel || "";
      },
      hasNasAuthorization() {
        return false;
      }
    },
    sourceEligibilityService: {
      getRegistrationSummary() {
        return profile.cameraSummary || "尚未登记本店相机";
      }
    },
    settingsBackupService: {
      async exportBackup() {
        return { ok: true, message: "设置备份已保存" };
      },
      async importBackup() {
        profile = {
          shop: { shopName: "恢复店名", shopPhone: "恢复电话", shopTip: "恢复提示" },
          cropStrategy: "content-aware",
          nasLabel: "picture",
          cameraSummary: "Canon · 尾号 0589"
        };
        return { ok: true, profile, message: "设置已恢复" };
      }
    },
    templateOverrideService: {
      clearAllRuntimeOverrides() {
        clearedRuntimeOverrides += 1;
      }
    },
    onSettingsRestored() {
      restoredUi += 1;
    },
    onStatus(message) {
      statuses.push(message);
    }
  });

  await controller.init();
  root.elements.backupSettings.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(statuses.includes("设置备份已保存"));

  root.elements.restoreSettings.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(root.elements.shopName.value, "恢复店名");
  assert.equal(root.elements.shopPhone.value, "恢复电话");
  assert.equal(root.elements.shopTip.value, "恢复提示");
  assert.equal(root.cropInputs[1].checked, true);
  assert.equal(root.elements.nasFolderStatus.value, "已恢复目录标签：picture（需重新授权）");
  assert.match(root.elements.shopCameraStatus.value, /0589/);
  assert.equal(clearedRuntimeOverrides, 1);
  assert.equal(restoredUi, 1);
  assert.ok(statuses.includes("设置已恢复"));
});
