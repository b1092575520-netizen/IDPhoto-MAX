"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");
const loadSettingsProfile = require("./helpers/loadSettingsProfile");

const exportServicePath = path.join(__dirname, "..", "src", "photoshop", "exportService.js");

function makeFolder(name) {
  const entries = new Map();
  const createFileCalls = [];

  return {
    name,
    entries,
    createFileCalls,
    async getEntries() {
      return Array.from(entries.values());
    },
    async getEntry(entryName) {
      if (!entries.has(entryName)) {
        throw new Error("entry not found");
      }
      return entries.get(entryName);
    },
    async createFolder(entryName) {
      const folder = makeFolder(entryName);
      entries.set(entryName, folder);
      return folder;
    },
    async createFile(entryName, options) {
      createFileCalls.push({ entryName, options });
      if (entries.has(entryName) && !(options && options.overwrite)) {
        throw new Error("entry already exists");
      }
      const file = {
        name: entryName,
        async delete() {
          entries.delete(entryName);
        }
      };
      entries.set(entryName, file);
      return file;
    }
  };
}

function loadExportService(rootFolder, fileSystemOverrides = {}, sourceEligibilityService = null) {
  const localStorageValues = new Map();
  const localFileSystem = Object.assign(
    {
      async getDataFolder() {
        return rootFolder;
      }
    },
    fileSystemOverrides
  );
  const context = {
    console: {
      log() {},
      warn() {},
      error() {}
    },
    require(name) {
      if (name === "photoshop") {
        return {
          core: {
            async executeAsModal(callback) {
              await callback();
            }
          }
        };
      }
      assert.equal(name, "uxp");
      return {
        storage: {
          localFileSystem
        }
      };
    },
    window: {
      localStorage: {
        getItem(key) {
          return localStorageValues.get(key) || null;
        },
        setItem(key, value) {
          localStorageValues.set(key, value);
        },
        removeItem(key) {
          localStorageValues.delete(key);
        }
      },
      IDPhotoPathService: {
        sanitizeFilePart(value) {
          return String(value || "未命名").replace(/\s+/g, "");
        },
        getDateFolders() {
          return { year: "2026", month: "2026-07", day: "2026-07-13" };
        },
        makeJpgFileName(templateName, sourceName, widthPx, heightPx) {
          const templatePart = String(templateName).replace(/\s+/g, "");
          const sourcePart = String(sourceName).replace(/\.[^.]+$/, "");
          return "2026-07-13_" + templatePart + "_" + widthPx + "x" + heightPx + "_" + sourcePart + ".jpg";
        },
        makeJpgSourceKey(sourceName) {
          return String(sourceName).replace(/\.[^.]+$/, "");
        }
      },
      IDPhotoTemplates: {
        getAllTemplates() {
          return [
            { name: "1寸 2.7x3.8", widthPx: 638, heightPx: 898 },
            { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
            { name: "美签 5.0x5.0", widthPx: 1181, heightPx: 1181 }
          ];
        }
      },
      IDPhotoSourceEligibilityService: sourceEligibilityService
    }
  };

  vm.createContext(context);
  loadPhotoshopExecution(context);
  loadSettingsProfile(context);
  vm.runInContext(fs.readFileSync(exportServicePath, "utf8"), context, {
    filename: exportServicePath
  });
  return {
    service: context.window.IDPhotoExportService,
    localStorageValues
  };
}

test("exportSingleJpg keeps the largest JPG per source and approximate aspect ratio", async () => {
  const rootFolder = makeFolder("root");
  const { service } = loadExportService(rootFolder);
  const savedNames = [];
  const documentRef = {
    saveAs: {
      async jpg(file) {
        savedNames.push(file.name);
      }
    }
  };
  const firstOptions = {
    template: { name: "1寸 2.7x3.8", widthPx: 638, heightPx: 898 },
    docInfo: { name: "portrait.psd" },
    nasArchive: false
  };
  const secondOptions = {
    template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
    docInfo: { name: "portrait.psd" },
    nasArchive: false
  };

  const first = await service.exportSingleJpg(documentRef, firstOptions);
  const yearFolder = rootFolder.entries.get("2026");
  const monthFolder = yearFolder.entries.get("2026-07");
  const dayFolder = monthFolder.entries.get("2026-07-13");
  const firstFile = dayFolder.entries.get(first.fileName);
  const second = await service.exportSingleJpg(documentRef, secondOptions);

  assert.equal(first.fileName, "2026-07-13_1寸2.7x3.8_638x898_portrait.jpg");
  assert.equal(second.fileName, "2026-07-13_标准2寸3.5x4.9_827x1157_portrait.jpg");
  assert.equal(second.replacedSmaller, true);
  assert.deepEqual(savedNames, [first.fileName, second.fileName]);
  assert.equal(dayFolder.entries.has(firstFile.name), false);
  assert.equal(dayFolder.entries.has(second.fileName), true);
  assert.equal(dayFolder.entries.size, 1);
  assert.ok(dayFolder.createFileCalls.every((call) => call.options.overwrite === false));

  const smallerRepeat = await service.exportSingleJpg(documentRef, firstOptions);
  assert.equal(smallerRepeat.skipped, true);
  assert.equal(smallerRepeat.fileName, second.fileName);
  assert.equal(savedNames.length, 2);

  const square = await service.exportSingleJpg(documentRef, {
    template: { name: "美签 5.0x5.0", widthPx: 1181, heightPx: 1181 },
    docInfo: { name: "portrait.psd" },
    nasArchive: false
  });
  assert.equal(square.skipped, undefined);
  assert.equal(savedNames.length, 3);
  assert.equal(dayFolder.entries.size, 2);

  const differentSource = await service.exportSingleJpg(documentRef, {
    template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
    docInfo: { name: "another-person.psd" },
    nasArchive: false
  });

  assert.equal(differentSource.skipped, undefined);
  assert.equal(savedNames.length, 4);
  assert.equal(dayFolder.entries.size, 3);
});

test("external-camera photos are laid out but skipped before JPG or NAS storage access", async () => {
  let storageAccessed = false;
  const rootFolder = makeFolder("root");
  const { service } = loadExportService(
    rootFolder,
    {
      async getDataFolder() {
        storageAccessed = true;
        return rootFolder;
      }
    },
    {
      checkSource() {
        return { eligible: false, reason: "external-camera", message: "外来相片：仅排版，不保存" };
      }
    }
  );

  const result = await service.exportSingleJpg(
    { saveAs: { async jpg() {} } },
    {
      template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
      docInfo: {
        name: "outside.jpg",
        sourceMetadata: { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "9999999999", hasXmp: true }
      },
      nasArchive: true
    }
  );

  assert.equal(result.skipped, true);
  assert.equal(result.sourceNotOwned, true);
  assert.equal(result.eligibilityReason, "external-camera");
  assert.equal(storageAccessed, false);
});

test("exportSingleJpg recognizes a numbered historical export as the same source", async () => {
  const rootFolder = makeFolder("root");
  const yearFolder = await rootFolder.createFolder("2026");
  const monthFolder = await yearFolder.createFolder("2026-07");
  const dayFolder = await monthFolder.createFolder("2026-07-13");
  const existing = await dayFolder.createFile("2026-07-13_标准2寸3.5x4.9_portrait_3.jpg", { overwrite: false });
  const { service } = loadExportService(rootFolder);
  let saveCalls = 0;

  const result = await service.exportSingleJpg(
    {
      saveAs: {
        async jpg() {
          saveCalls += 1;
        }
      }
    },
    {
      template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
      docInfo: { name: "portrait.psd" },
      nasArchive: false
    }
  );

  assert.equal(result.skipped, true);
  assert.equal(result.fileName, existing.name);
  assert.equal(saveCalls, 0);
  assert.equal(dayFolder.entries.size, 1);
});

test("NAS authorization can be replaced and cleared", async () => {
  const firstFolder = makeFolder("first");
  const secondFolder = makeFolder("second");
  const pickedFolders = [firstFolder, secondFolder];
  const { service, localStorageValues } = loadExportService(makeFolder("data"), {
    async getFolder() {
      return pickedFolders.shift();
    },
    async createPersistentToken(folder) {
      return "token:" + folder.name;
    }
  });

  assert.equal(service.hasNasAuthorization(), false);

  const firstResult = await service.chooseNasRootFolder();
  const secondResult = await service.chooseNasRootFolder();

  assert.equal(firstResult.label, "first");
  assert.equal(secondResult.label, "second");
  assert.equal(service.getNasAuthorizationLabel(), "second");
  assert.equal(service.hasNasAuthorization(), true);
  assert.equal(localStorageValues.get("idphoto-max-nas-folder-token"), "token:second");

  service.clearNasRootFolder();

  assert.equal(service.getNasAuthorizationLabel(), "");
  assert.equal(service.hasNasAuthorization(), false);
  assert.equal(localStorageValues.has("idphoto-max-nas-folder-token"), false);
});

test("a failed persistent token does not retain the previous NAS authorization", async () => {
  const newFolder = makeFolder("new-folder");
  const { service, localStorageValues } = loadExportService(makeFolder("data"), {
    async getFolder() {
      return newFolder;
    },
    async createPersistentToken() {
      throw new Error("token failed");
    }
  });
  localStorageValues.set("idphoto-max-nas-folder-token", "old-token");
  localStorageValues.set("idphoto-max-nas-folder-label", "old-folder");

  const result = await service.chooseNasRootFolder();

  assert.equal(result.persistent, false);
  assert.equal(result.label, "new-folder");
  assert.equal(service.getNasAuthorizationLabel(), "new-folder");
  assert.equal(localStorageValues.has("idphoto-max-nas-folder-token"), false);
  assert.equal(localStorageValues.has("idphoto-max-nas-folder-label"), false);
});

test("NAS export restores the authorized folder from its persistent token", async () => {
  const nasRoot = makeFolder("archive");
  let folderPickerCalls = 0;
  const { service, localStorageValues } = loadExportService(makeFolder("data"), {
    async getEntryForPersistentToken(token) {
      assert.equal(token, "saved-token");
      return nasRoot;
    },
    async getFolder() {
      folderPickerCalls += 1;
      return null;
    }
  });
  localStorageValues.set("idphoto-max-nas-folder-token", "saved-token");
  const documentRef = {
    saveAs: {
      async jpg() {}
    }
  };

  const result = await service.exportSingleJpg(documentRef, {
    template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
    docInfo: { name: "portrait.psd" },
    nasArchive: true
  });

  assert.equal(result.mode, "nas-token");
  assert.equal(folderPickerCalls, 0);
  assert.equal(service.getNasAuthorizationLabel(), "archive");
});

test("a failed JPG save removes the incomplete file", async () => {
  const rootFolder = makeFolder("root");
  const { service } = loadExportService(rootFolder);
  const documentRef = {
    saveAs: {
      async jpg() {
        throw new Error("Photoshop save failed");
      }
    }
  };

  await assert.rejects(
    service.exportSingleJpg(documentRef, {
      template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
      docInfo: { name: "portrait.psd" },
      nasArchive: false
    }),
    /Photoshop save failed/
  );

  const yearFolder = rootFolder.entries.get("2026");
  const monthFolder = yearFolder.entries.get("2026-07");
  const dayFolder = monthFolder.entries.get("2026-07-13");
  assert.equal(dayFolder.entries.size, 0);
});
