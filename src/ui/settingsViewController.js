(function () {
  "use strict";

  function create(options) {
    var root = options.root || document;
    var settingsStore = options.settingsStore;
    var cropStrategyStore = options.cropStrategyStore;
    var exportService = options.exportService;
    var documentService = options.documentService;
    var sourceEligibilityService = options.sourceEligibilityService;
    var settingsBackupService = options.settingsBackupService;
    var templateOverrideService = options.templateOverrideService;
    var onSettingsRestored = typeof options.onSettingsRestored === "function" ? options.onSettingsRestored : function () {};
    var onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    var formatError = typeof options.formatError === "function" ? options.formatError : function (error) { return error && error.message ? error.message : String(error); };
    var initialized = false;
    var currentSourceMetadata = null;

    function one(selector) {
      return root.querySelector(selector);
    }

    function all(selector) {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    }

    function setInputValue(selector, value) {
      var input = one(selector);
      if (input) {
        input.value = value || "";
      }
    }

    function collectShopSettings() {
      return {
        shopName: one("#shopName") ? one("#shopName").value : "",
        shopPhone: one("#shopPhone") ? one("#shopPhone").value : "",
        shopTip: one("#shopTip") ? one("#shopTip").value : ""
      };
    }

    function applyShopSettings(settings) {
      settings = settings || {};
      setInputValue("#shopName", settings.shopName || "");
      setInputValue("#shopPhone", settings.shopPhone || "");
      setInputValue("#shopTip", settings.shopTip || "");
    }

    function getSelectedCropStrategy() {
      var checked = one('input[name="cropStrategy"]:checked');
      var value = checked ? checked.value : null;
      if (cropStrategyStore && cropStrategyStore.normalize) {
        return cropStrategyStore.normalize(value || cropStrategyStore.load());
      }
      return value || "auto";
    }

    function applyCropStrategy(strategy) {
      var normalized = cropStrategyStore && cropStrategyStore.normalize ? cropStrategyStore.normalize(strategy) : strategy || "auto";
      all('input[name="cropStrategy"]').forEach(function (input) {
        input.checked = input.value === normalized;
      });
    }

    function refreshProfileFields() {
      applyShopSettings(settingsStore && settingsStore.load ? settingsStore.load() : null);
      applyCropStrategy(cropStrategyStore && cropStrategyStore.load ? cropStrategyStore.load() : "auto");
    }

    function refreshNasAuthorization() {
      var label = exportService && exportService.getNasAuthorizationLabel ? exportService.getNasAuthorizationLabel() : "";
      var authorized = exportService && exportService.hasNasAuthorization
        ? exportService.hasNasAuthorization()
        : Boolean(label);
      setInputValue(
        "#nasFolderStatus",
        label
          ? authorized
            ? "已授权：" + label
            : "已恢复目录标签：" + label + "（需重新授权）"
          : "尚未授权（首次导出时选择）"
      );
    }

    function refreshRegisteredCameras() {
      var summary = sourceEligibilityService && sourceEligibilityService.getRegistrationSummary
        ? sourceEligibilityService.getRegistrationSummary()
        : "相机识别模块未加载";
      setInputValue("#shopCameraStatus", summary);
    }

    function currentCameraLabel(metadata) {
      var serial = String(metadata && metadata.serialNumber || "");
      var tail = serial.length > 4 ? serial.slice(-4) : serial;
      var camera = [metadata && metadata.make, metadata && metadata.model].filter(Boolean).join(" ");
      if (!serial) {
        return "当前照片没有机身序列号，将只排版、不保存";
      }
      return (camera || "已读取相机") + " · 序列号尾号 " + tail;
    }

    function updateCurrentCameraUi(metadata) {
      var registerButton = one("#registerCurrentCamera");
      var eligibility;
      currentSourceMetadata = metadata || null;
      setInputValue("#currentCameraStatus", currentCameraLabel(currentSourceMetadata));
      if (registerButton) {
        if (!(currentSourceMetadata && currentSourceMetadata.serialNumber)) {
          registerButton.disabled = true;
          registerButton.textContent = "当前照片不可登记";
          return;
        }
        eligibility = sourceEligibilityService && sourceEligibilityService.checkSource
          ? sourceEligibilityService.checkSource(currentSourceMetadata)
          : null;
        registerButton.disabled = Boolean(eligibility && eligibility.eligible);
        registerButton.textContent = registerButton.disabled ? "已登记，可自动保存" : "设为本店相机并启用保存";
      }
    }

    async function refreshCurrentCamera() {
      var info;
      if (!documentService || !documentService.getActiveDocumentInfo) {
        updateCurrentCameraUi(null);
        return null;
      }
      try {
        info = await documentService.getActiveDocumentInfo();
        updateCurrentCameraUi(info && info.sourceMetadata ? info.sourceMetadata : null);
        return currentSourceMetadata;
      } catch (error) {
        updateCurrentCameraUi(null);
        return null;
      }
    }

    function saveSettings() {
      var settingsResult = settingsStore && settingsStore.save ? settingsStore.save(collectShopSettings()) : null;
      onStatus(settingsResult && settingsResult.message ? settingsResult.message : "店铺信息已保存");
    }

    async function backupSettings() {
      var result;
      try {
        if (!settingsBackupService || !settingsBackupService.exportBackup) {
          throw new Error("设置备份模块未加载");
        }
        result = await settingsBackupService.exportBackup();
        onStatus(result && result.message ? result.message : "设置备份未完成");
      } catch (error) {
        onStatus("设置备份失败：" + formatError(error));
      }
    }

    async function restoreSettings() {
      var result;
      try {
        if (!settingsBackupService || !settingsBackupService.importBackup) {
          throw new Error("设置恢复模块未加载");
        }
        result = await settingsBackupService.importBackup();
        if (!result || !result.ok) {
          onStatus(result && result.message ? result.message : "设置恢复未完成");
          return;
        }
        if (templateOverrideService && templateOverrideService.clearAllRuntimeOverrides) {
          templateOverrideService.clearAllRuntimeOverrides();
        }
        refreshProfileFields();
        await refresh();
        onSettingsRestored(result.profile);
        onStatus(result.message || "设置已恢复");
      } catch (error) {
        onStatus("设置恢复失败：" + formatError(error));
      }
    }

    async function chooseNasFolder() {
      try {
        if (!exportService || !exportService.chooseNasRootFolder) {
          throw new Error("NAS 授权模块未加载");
        }
        onStatus((await exportService.chooseNasRootFolder()).message);
      } catch (error) {
        onStatus("NAS 目录授权失败：" + formatError(error));
      } finally {
        refreshNasAuthorization();
      }
    }

    function clearNasFolder() {
      var result = exportService && exportService.clearNasRootFolder ? exportService.clearNasRootFolder() : null;
      refreshNasAuthorization();
      onStatus(result && result.message ? result.message : "NAS 授权模块未加载");
    }

    function registerCurrentCamera() {
      var result;
      if (!sourceEligibilityService || !sourceEligibilityService.registerCamera) {
        onStatus("相机识别模块未加载");
        return;
      }
      result = sourceEligibilityService.registerCamera(currentSourceMetadata);
      refreshRegisteredCameras();
      updateCurrentCameraUi(currentSourceMetadata);
      onStatus(result.message);
    }

    function clearShopCameras() {
      var result = sourceEligibilityService && sourceEligibilityService.clearRegisteredCameras
        ? sourceEligibilityService.clearRegisteredCameras()
        : null;
      refreshRegisteredCameras();
      updateCurrentCameraUi(currentSourceMetadata);
      onStatus(result && result.message ? result.message : "相机识别模块未加载");
    }

    function bindClick(selector, handler) {
      var button = one(selector);
      if (button) {
        button.addEventListener("click", handler);
      }
    }

    function setSettingsCardOpen(card, open) {
      var toggle = card.querySelector(".settings-card-toggle");
      var icon = toggle ? toggle.querySelector(".section-caret") : null;
      if (open) {
        card.classList.add("open");
      } else {
        card.classList.remove("open");
      }
      if (toggle) {
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      }
      if (icon && window.IDPhotoIcons && window.IDPhotoIcons.setIcon) {
        window.IDPhotoIcons.setIcon(icon, open ? "caret-down" : "caret-right");
      }
    }

    function showSettingsHome() {
      var settingsView = one("#settingsView");
      if (settingsView) {
        settingsView.classList.remove("detail-open");
      }
      all(".settings-card").forEach(function (card) {
        setSettingsCardOpen(card, false);
      });
    }

    function showSettingsCard(card) {
      var settingsView = one("#settingsView");
      var backButton = one("#settingsBackButton");
      var toggle = card.querySelector(".settings-card-toggle");
      all(".settings-card").forEach(function (item) {
        setSettingsCardOpen(item, item === card);
      });
      if (settingsView) {
        settingsView.classList.add("detail-open");
      }
      if (backButton) {
        backButton.textContent = "← 返回设置 · " + String(toggle && toggle.textContent || "").trim();
      }
    }

    function initSettingsNavigation() {
      var cards = all(".settings-card");
      var backButton = one("#settingsBackButton");
      showSettingsHome();
      cards.forEach(function (card) {
        var toggle = card.querySelector(".settings-card-toggle");
        if (!toggle) {
          return;
        }
        toggle.addEventListener("click", function () {
          showSettingsCard(card);
        });
      });
      if (backButton) {
        backButton.addEventListener("click", showSettingsHome);
      }
    }

    async function refresh() {
      refreshNasAuthorization();
      refreshRegisteredCameras();
      await refreshCurrentCamera();
    }

    function init() {
      if (initialized) {
        return refresh();
      }
      initialized = true;
      refreshProfileFields();
      initSettingsNavigation();
      bindClick("#saveSettings", saveSettings);
      bindClick("#backupSettings", backupSettings);
      bindClick("#restoreSettings", restoreSettings);
      bindClick("#authorizeNasFolder", chooseNasFolder);
      bindClick("#clearNasFolder", clearNasFolder);
      bindClick("#registerCurrentCamera", registerCurrentCamera);
      bindClick("#clearShopCameras", clearShopCameras);
      return refresh();
    }

    return {
      init: init,
      refresh: refresh,
      showHome: showSettingsHome,
      refreshNasAuthorization: refreshNasAuthorization,
      getSelectedCropStrategy: getSelectedCropStrategy
    };
  }

  window.IDPhotoSettingsViewController = {
    create: create
  };
})();
