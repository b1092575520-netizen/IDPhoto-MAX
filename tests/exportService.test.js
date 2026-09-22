"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");
const loadSettingsProfile = require("./helpers/loadSettingsProfile");

const exportServicePath = path.join(__dirname, "..", "src", "photoshop", "exportService.js");
const pathServicePath = path.join(__dirname, "..", "src", "core", "pathService.js");
const storageFormats = { utf8: Symbol("utf8"), binary: Symbol("binary") };

function checkStorageFormat(options) {
  if (options && options.format !== undefined && options.format !== storageFormats.utf8 && options.format !== storageFormats.binary) {
    throw new Error("Format must be storage.formats.utf8 or storage.formats.binary");
  }
}

function makeFolder(name, parentPath = "C:\\Mock") {
  const entries = new Map();
  const createFileCalls = [];

  return {
    name,
    nativePath: parentPath + "\\" + name,
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
      const folder = makeFolder(entryName, this.nativePath);
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
        isFile: true,
        content: "",
        async read(options) { checkStorageFormat(options); return this.content; },
        async write(value, options) { checkStorageFormat(options); this.content = value; },
        async commitHiddenIndex() {
          await this.moveTo({ entries }, { newName: ".idphoto-jpg-index.json", overwrite: true });
          this.hidden = true;
        },
        async moveTo(folder, options) {
          if (folder.entries.has(options.newName) && !options.overwrite) throw new Error("entry exists");
          entries.delete(this.name);
          this.name = options.newName;
          folder.entries.set(this.name, this);
        },
        async delete() {
          entries.delete(this.name);
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
          formats: storageFormats,
          localFileSystem
        }
      };
    },
    window: {
      IDPhotoPrintService: {
        async hideArchiveIndex(file) { file.hidden = true; },
        async commitArchiveIndex(file) { await file.commitHiddenIndex(); }
      },
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
      IDPhotoTemplates: {
        getAllTemplates() {
          return [
            { name: "1寸 2.7x3.8", widthPx: 638, heightPx: 898 },
            { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
            { name: "美签 5.0x5.0", widthPx: 1181, heightPx: 1181 }
          ];
        }
      },
      IDPhotoSourceEligibilityService: sourceEligibilityService || { checkSource() { return { eligible: true }; } },
      IDPhotoDateService: {
        getTodayParts() {
          return { year: 2026, month: 7, day: 13 };
        }
      }
    }
  };

  vm.createContext(context);
  loadPhotoshopExecution(context);
  loadSettingsProfile(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src/core/photoVariantService.js"), "utf8"), context);
  context.window.IDPhotoVariantService.analyzeDocument = async () => ({
    personFingerprint: "0123456789abcdef", backgroundColor: "blue"
  });
  vm.runInContext(fs.readFileSync(pathServicePath, "utf8"), context, {
    filename: pathServicePath
  });
  vm.runInContext(fs.readFileSync(exportServicePath, "utf8"), context, {
    filename: exportServicePath
  });
  return {
    service: context.window.IDPhotoExportService,
    pathService: context.window.IDPhotoPathService,
    localStorageValues,
    context
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
    docInfo: { name: "portrait.psd", stableSourceId: "image-unique-id:portrait" },
    nasArchive: false
  };
  const secondOptions = {
    template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
    docInfo: { name: "portrait.psd", stableSourceId: "image-unique-id:portrait" },
    nasArchive: false
  };

  const first = await service.exportSingleJpg(documentRef, firstOptions);
  const yearFolder = rootFolder.entries.get("2026");
  const monthFolder = yearFolder.entries.get("2026-07");
  const dayFolder = monthFolder.entries.get("2026-07-13");
  const firstFile = dayFolder.entries.get(first.fileName);
  const second = await service.exportSingleJpg(documentRef, secondOptions);

  assert.match(first.fileName, /^1寸_638x898_蓝_[A-Z0-9]{6}\.jpg$/);
  assert.match(second.fileName, /^标准2寸_827x1157_蓝_[A-Z0-9]{6}\.jpg$/);
  assert.equal(second.replacedSmaller, true);
  assert.deepEqual(savedNames, [first.fileName, second.fileName]);
  assert.equal(dayFolder.entries.has(firstFile.name), false);
  assert.equal(dayFolder.entries.has(second.fileName), true);
  assert.equal(Array.from(dayFolder.entries.keys()).filter(name => /\.jpg$/i.test(name)).length, 1);
  assert.ok(dayFolder.createFileCalls.filter(call => /\.jpg$/i.test(call.entryName)).every((call) => call.options.overwrite === false));

  const smallerRepeat = await service.exportSingleJpg(documentRef, firstOptions);
  assert.equal(smallerRepeat.skipped, true);
  assert.equal(smallerRepeat.fileName, second.fileName);
  assert.equal(savedNames.length, 2);

  const square = await service.exportSingleJpg(documentRef, {
    template: { name: "美签 5.0x5.0", widthPx: 1181, heightPx: 1181 },
    docInfo: { name: "portrait.psd", stableSourceId: "image-unique-id:portrait" },
    nasArchive: false
  });
  assert.equal(square.skipped, undefined);
  assert.equal(savedNames.length, 3);
  assert.equal(Array.from(dayFolder.entries.keys()).filter(name => /\.jpg$/i.test(name)).length, 2);

  const differentSource = await service.exportSingleJpg(documentRef, {
    template: { name: "标准2寸 3.5x4.9", widthPx: 827, heightPx: 1157 },
    docInfo: { name: "another-person.psd", stableSourceId: "image-unique-id:another" },
    nasArchive: false
  });

  assert.equal(differentSource.skipped, undefined);
  assert.equal(savedNames.length, 4);
  assert.equal(Array.from(dayFolder.entries.keys()).filter(name => /\.jpg$/i.test(name)).length, 3);
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

test("historical photos are treated like external photos and never reach JPG or NAS storage", async () => {
  let storageAccessed = false;
  let saveCalls = 0;
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
      checkSource(metadata, documentName) {
        assert.equal(metadata.historical, true);
        assert.equal(documentName, "old-photo.psd");
        return { eligible: false, reason: "historical-source", message: "历史照片：仅排版，不保存" };
      }
    }
  );

  const result = await service.exportSingleJpg(
    { saveAs: { async jpg() { saveCalls += 1; } } },
    {
      template: { name: "1寸 2.7x3.8", widthPx: 638, heightPx: 898 },
      docInfo: { name: "old-photo.psd", historical: true, sourceMetadata: { historical: true } },
      nasArchive: true
    }
  );

  assert.equal(result.skipped, true);
  assert.equal(result.sourceNotOwned, true);
  assert.equal(result.eligibilityReason, "historical-source");
  assert.equal(storageAccessed, false);
  assert.equal(saveCalls, 0);
});

test("exportSingleJpg recognizes a numbered legacy export with a full matching source identity", async () => {
  const rootFolder = makeFolder("root");
  const yearFolder = await rootFolder.createFolder("2026");
  const monthFolder = await yearFolder.createFolder("2026-07");
  const dayFolder = await monthFolder.createFolder("2026-07-13");
  const existing = await dayFolder.createFile("2026-07-13_标准2寸3.5x4.9_id-s2i706f727472616974_bg-blue_portrait_3.jpg", { overwrite: false });
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
      docInfo: { name: "portrait.psd", stableSourceId: "image-unique-id:portrait" },
      nasArchive: false
    }
  );

  assert.equal(result.skipped, true);
  assert.equal(result.fileName, existing.name);
  assert.equal(saveCalls, 0);
  assert.equal(Array.from(dayFolder.entries.keys()).filter(name => /\.jpg$/i.test(name)).length, 1);
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

  assert.equal(firstResult.label, firstFolder.nativePath);
  assert.equal(secondResult.label, secondFolder.nativePath);
  assert.equal(service.getNasAuthorizationLabel(), secondFolder.nativePath);
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
  assert.equal(result.label, newFolder.nativePath);
  assert.equal(service.getNasAuthorizationLabel(), newFolder.nativePath);
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
    docInfo: { name: "portrait.psd", stableSourceId: "image-unique-id:portrait" },
    nasArchive: true
  });

  assert.equal(result.mode, "nas-token");
  assert.equal(folderPickerCalls, 0);
  assert.equal(service.getNasAuthorizationLabel(), nasRoot.nativePath);
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
      docInfo: { name: "portrait.psd", stableSourceId: "image-unique-id:portrait" },
      nasArchive: false
    }),
    /Photoshop save failed/
  );

  const yearFolder = rootFolder.entries.get("2026");
  const monthFolder = yearFolder.entries.get("2026-07");
  const dayFolder = monthFolder.entries.get("2026-07-13");
  assert.equal(Array.from(dayFolder.entries.keys()).filter(name => /\.jpg$/i.test(name)).length, 0);
});

function exportOptions(widthPx, heightPx, sourceVariant, extra = {}) {
  return {
    template: { name: widthPx === 638 ? "1寸" : "标准2寸", widthPx, heightPx },
    docInfo: Object.assign({ name: "original.psd", sourceVariant }, extra)
  };
}

function variantFixture(service, color, offset = 0) {
  const data = [];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const value = (x * 31 + y * 17 + offset) % 255;
      data.push(value, value * 0.7, value * 0.4);
    }
  }
  return Object.assign(service.analyzeSample({ width: 32, height: 32, components: 3, data }), { backgroundColor: color });
}

const jpgNames = (root) => Array.from(root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13").entries.keys()).filter(name => /\.jpg$/i.test(name));
const savingDocument = () => ({ saveAs: { async jpg() {} } });

test("first archive retains a completed JPG when index creation, writing or rename fails", async () => {
  for (const failure of ["create", "write", "move"]) {
    const root = makeFolder("root");
    const loaded = loadExportService(root);
    const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "blue");
    const photoBytes = "completed JPEG bytes";
    const document = { saveAs: { async jpg(file) {
      file.content = photoBytes;
      const day = root.entries.get("archive-index-cache");
      const createFile = day.createFile.bind(day);
      day.createFile = async (name, options) => {
        if (name.endsWith(".tmp") && failure === "create") throw Error("index create failed");
        const entry = await createFile(name, options);
        if (name.endsWith(".tmp")) {
          if (failure === "write") entry.write = async () => { throw Error("index write failed"); };
          if (failure === "move") entry.moveTo = async () => { throw Error("index move failed"); };
        }
        return entry;
      };
    } } };
    const result = await loaded.service.exportSingleJpg(document, exportOptions(638, 898, variant));
    assert.equal(result.ok, true);
    assert.equal(result.indexUnavailable, true);
    assert.match(result.message, /已保存/);
    assert.equal(jpgNames(root).length, 1);
    const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
    assert.equal(day.entries.get(result.fileName).content, photoBytes);
    assert.equal(Array.from(day.entries.keys()).some(name => name.endsWith(".tmp")), false);
  }
});

test("three backgrounds and two sizes retain three largest JPGs despite resized-image identity drift", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  let processedAnalyses = 0;
  const variantService = loaded.context.window.IDPhotoVariantService;
  variantService.analyzeDocument = async () => variantFixture(variantService, "blue", ++processedAnalyses * 91);
  for (const color of ["white", "red", "blue"]) {
    const sourceVariant = variantFixture(variantService, color);
    for (const [w, h] of [[638, 898], [827, 1157], [638, 898]]) {
      await loaded.service.exportSingleJpg(savingDocument(), exportOptions(w, h, sourceVariant));
    }
  }
  assert.equal(processedAnalyses, 0, "identity must come from the original before resizing");
  assert.equal(jpgNames(root).length, 3);
  assert.ok(jpgNames(root).every(name => name.includes("827x1157")));
  assert.deepEqual(jpgNames(root).map(name => name.split("_")[2]).sort(), ["白", "红", "蓝"].sort());
});

test("archive identity survives plugin restart and an empty local cache", async () => {
  const root = makeFolder("root");
  const first = loadExportService(root);
  const sourceVariant = variantFixture(first.context.window.IDPhotoVariantService, "white");
  await first.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, sourceVariant));
  const restarted = loadExportService(root);
  const indexFile = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13").entries.get(".idphoto-jpg-index.json");
  assert.equal(JSON.parse(indexFile.content).version, 1);
  const result = await restarted.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, sourceVariant));
  assert.equal(result.replacedSmaller, true);
  assert.equal(jpgNames(root).length, 1);
});

test("a colliding short token alone cannot authorize deletion of an unrelated JPG", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const sourceVariant = variantFixture(loaded.context.window.IDPhotoVariantService, "blue");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, sourceVariant, { stableSourceId: "image-unique-id:a" }));
  loaded.context.window.IDPhotoPathService.makeJpgVariantToken = () => jpgNames(root)[0].match(/_([A-Z0-9]{6})\.jpg$/)[1];
  const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
  for (const name of Array.from(day.entries.keys())) {
    if (!/\.jpg$/i.test(name)) day.entries.delete(name);
  }
  loaded.localStorageValues.clear();
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, sourceVariant, { stableSourceId: "image-unique-id:b" }));
  assert.equal(jpgNames(root).length, 2);
});

test("concurrent exports serialize lookup, save and cleanup", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const sourceVariant = variantFixture(loaded.context.window.IDPhotoVariantService, "red");
  let saving = 0;
  let maxSaving = 0;
  const doc = { saveAs: { async jpg() {
    saving++;
    maxSaving = Math.max(maxSaving, saving);
    await new Promise(resolve => setTimeout(resolve, 5));
    saving--;
  } } };
  await Promise.all([638, 827].map(w => loaded.service.exportSingleJpg(doc, exportOptions(w, w === 638 ? 898 : 1157, sourceVariant))));
  assert.equal(maxSaving, 1);
  assert.equal(jpgNames(root).length, 1);
  assert.match(jpgNames(root)[0], /827x1157/);
});

test("unknown background or failed source analysis skips all archive access", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  for (const sourceVariant of [null, { backgroundColor: "unknown", personFingerprint: "0123456789abcdef" }]) {
    const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, sourceVariant));
    assert.equal(result.skipped, true);
    assert.equal(root.entries.size, 0);
  }
});

test("missing eligibility service blocks saving before storage access", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  loaded.context.window.IDPhotoSourceEligibilityService = null;
  await assert.rejects(loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, null)), /资格/);
  assert.equal(root.entries.size, 0);
});

test("a failed larger save preserves the previously archived smaller JPG and queue recovers", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "red");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  const failSave = { saveAs: { async jpg() { throw new Error("save failed"); } } };
  await assert.rejects(loaded.service.exportSingleJpg(failSave, exportOptions(827, 1157, variant)), /save failed/);
  assert.equal(jpgNames(root).length, 1);
  assert.match(jpgNames(root)[0], /638x898/);
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, variant));
  assert.equal(jpgNames(root).length, 1);
  assert.match(jpgNames(root)[0], /827x1157/);
});

test("archive index write failure preserves the new JPG and previous copy with an explicit warning", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "white");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
  const cache = root.entries.get("archive-index-cache");
  const createFile = cache.createFile.bind(cache);
  cache.createFile = async (name, options) => {
    if (name.endsWith(".tmp")) throw new Error("index permission denied");
    return createFile(name, options);
  };
  const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, variant));
  assert.equal(result.ok, true);
  assert.equal(result.indexUnavailable, true);
  assert.equal(result.replacedSmaller, false);
  assert.match(result.message, /index permission denied/);
  assert.equal(jpgNames(root).length, 2);
  assert.ok(jpgNames(root).some(name => /827x1157/.test(name)));
});

test("corrupt shared index recovers from the private record and keeps the larger photo", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "blue");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
  day.entries.get(".idphoto-jpg-index.json").content = "{broken";
  const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, variant));
  assert.equal(result.indexUnavailable, undefined);
  assert.equal(JSON.parse(day.entries.get(".idphoto-jpg-index.json").content).version, 1);
  assert.equal(jpgNames(root).length, 1);
  assert.match(jpgNames(root)[0], /827x1157/);
});

test("cleanup failure is reported instead of claiming the smaller JPG was replaced", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "blue");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
  day.entries.get(jpgNames(root)[0]).delete = async () => { throw new Error("access denied"); };
  const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, variant));
  assert.equal(result.cleanupIncomplete, true);
  assert.equal(result.removedCount, 0);
  assert.match(result.message, /清理失败/);
  assert.equal(jpgNames(root).length, 2);
});

test("near-identical aspect ratios on opposite rounding boundaries still share the largest export", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "red");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(714, 1000, variant));
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(1432, 2000, variant));
  assert.equal(jpgNames(root).length, 1);
});

test("real camera eligibility and original analysis jointly block old and undated shop photos", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src/core/sourceEligibilityService.js"), "utf8"), loaded.context);
  loaded.context.window.IDPhotoSourceEligibilityService.registerCamera({ serialNumber: "shop" });
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "red");
  for (const captureDate of ["2000:01:02 12:34:56", ""]) {
    const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant, { sourceMetadata: { serialNumber: "shop", captureDate } }));
    assert.equal(result.sourceNotOwned, true);
    assert.equal(root.entries.size, 0);
  }
});

test("partial index write keeps the previous committed identity index intact", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "red");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
  const cache = root.entries.get("archive-index-cache");
  const cacheFile = Array.from(cache.entries.values()).find(file => file.name.endsWith(".json"));
  const previous = cacheFile.content;
  const createFile = cache.createFile.bind(cache);
  cache.createFile = async (name, options) => {
    const file = await createFile(name, options);
    if (name.endsWith(".tmp")) file.write = async function () { this.content = "{partial"; throw new Error("disk full"); };
    return file;
  };
  const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, variant));
  assert.equal(result.indexUnavailable, true);
  assert.match(result.message, /disk full/);
  assert.equal(cacheFile.content, previous);
  assert.equal(jpgNames(root).length, 2);
  assert.equal(Array.from(cache.entries.keys()).some(name => name.endsWith(".tmp")), false);
});

test("archive index is hidden after first save, replacement and duplicate reuse", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "red");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
  const original = day.entries.get(".idphoto-jpg-index.json");
  assert.equal(original.hidden, true);
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827, 1157, variant));
  const updated = day.entries.get(".idphoto-jpg-index.json");
  assert.notEqual(updated, original);
  assert.equal(updated.hidden, true);
  updated.hidden = false;
  const duplicate = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  assert.equal(duplicate.keptLargest, true);
  assert.equal(updated.hidden, true);
  assert.equal(jpgNames(root).length, 1);
});

test("attribute failure preserves photo and valid index and reports a separate warning", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "blue");
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  loaded.context.window.IDPhotoPrintService.hideArchiveIndex = async () => { throw new Error("attributes denied"); };
  const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638, 898, variant));
  assert.equal(result.ok, true);
  assert.equal(result.indexVisibilityWarning, true);
  assert.equal(result.indexUnavailable, undefined);
  assert.match(result.message, /attributes denied/);
  const day = root.entries.get("2026").entries.get("2026-07").entries.get("2026-07-13");
  assert.equal(JSON.parse(day.entries.get(".idphoto-jpg-index.json").content).version, 1);
  assert.equal(jpgNames(root).length, 1);
});

test("combined index executor replaces standalone launches and preserves JPGs if its receipt fails", async () => {
  const root = makeFolder("root");
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, "blue");
  let operations = [];
  loaded.context.window.IDPhotoPrintService.commitArchiveIndex = async () => { throw Error("unexpected standalone launch"); };
  loaded.context.window.IDPhotoPrintService.hideArchiveIndex = async () => { throw Error("unexpected standalone launch"); };
  const options = Object.assign(exportOptions(638, 898, variant), { archiveIndexExecutor: async (file, operation) => {
    operations.push(operation);
    if (operation === "commit-archive-index") await file.commitHiddenIndex();
    else file.hidden = true;
  } });
  const saved = await loaded.service.exportSingleJpg(savingDocument(), options);
  const duplicate = await loaded.service.exportSingleJpg(savingDocument(), options);
  assert.equal(saved.indexUnavailable, undefined);
  assert.equal(duplicate.indexVisibilityWarning, undefined);
  assert.deepEqual(operations, ["commit-archive-index", "hide-archive-index"]);
  const failed = await loaded.service.exportSingleJpg(savingDocument(), Object.assign(exportOptions(827, 1157, variant), {
    archiveIndexExecutor: async () => { throw Error("combined launch denied"); }
  }));
  assert.equal(failed.indexSyncWarning, true);
  assert.equal(jpgNames(root).length, 1);
  assert.match(failed.message, /combined launch denied/);
});

test("all built-in size pairs keep the maximum only for the specified near-ratio pairs, in either order", async () => {
  const registry = { window: {} };
  vm.createContext(registry);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core/templateRegistry.js'), 'utf8'), registry);
  const templates = Array.from(registry.window.IDPhotoTemplates.getAllTemplates());
  assert.equal(templates.length, 11);
  const nearPairs = new Set(['0:1','0:3','0:9','1:3','1:4','1:9','2:4','2:5','4:9','6:7','6:8','7:8']);
  for (let a = 0; a < templates.length; a++) {
    for (let b = a; b < templates.length; b++) {
      for (const order of [[a,b],[b,a]]) {
        const root = makeFolder('root');
        const loaded = loadExportService(root);
        const variant = variantFixture(loaded.context.window.IDPhotoVariantService, 'red');
        for (const i of order) {
          await loaded.service.exportSingleJpg(savingDocument(), exportOptions(templates[i].widthPx, templates[i].heightPx, variant));
        }
        const sameGroup = a === b || nearPairs.has(a + ':' + b);
        assert.equal(jpgNames(root).length, sameGroup ? 1 : 2, `${a}:${b} order ${order}`);
        if (sameGroup) {
          const largest = templates[a].widthPx * templates[a].heightPx >= templates[b].widthPx * templates[b].heightPx ? templates[a] : templates[b];
          assert.ok(jpgNames(root)[0].includes(`${largest.widthPx}x${largest.heightPx}`));
        }
      }
    }
  }
});

test("all screenshot-size orders survive bridge denial and restart, keeping one largest JPG per color", async () => {
  for (const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) {
    const root = makeFolder('root');
    const sizes = [[638,898],[827,1157],[780,1134]];
    for (const color of ['white','red','blue']) {
      for (const i of order.concat(order)) {
        const loaded = loadExportService(root); // Restart, including no in-memory identity cache.
        const variant = variantFixture(loaded.context.window.IDPhotoVariantService, color);
        await loaded.service.exportSingleJpg(savingDocument(), Object.assign(exportOptions(...sizes[i],variant), {
          archiveIndexExecutor: async () => { throw Error('permission denied'); }
        }));
      }
    }
    assert.equal(jpgNames(root).length, 3);
    assert.ok(jpgNames(root).every(name => name.includes('827x1157')));
  }
});

test("custom dimensions use a symmetric threshold and an intermediate ratio cannot erase an incompatible keeper", async () => {
  const root = makeFolder('root');
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, 'blue');
  for (const size of [[1360,2000],[2175,3000],[700,1000]]) {
    await loaded.service.exportSingleJpg(savingDocument(), exportOptions(...size,variant));
  }
  assert.equal(jpgNames(root).length, 2);
  assert.ok(jpgNames(root).some(name => name.includes('1360x2000')));
  assert.ok(jpgNames(root).some(name => name.includes('2175x3000')));
  for (const order of [[[1000,1000],[2100,2000]],[[2100,2000],[1000,1000]]]) {
    const boundaryRoot = makeFolder('boundary');
    const boundary = loadExportService(boundaryRoot);
    for (const size of order) await boundary.service.exportSingleJpg(savingDocument(), exportOptions(...size,variant));
    assert.equal(jpgNames(boundaryRoot).length, 1);
    assert.ok(jpgNames(boundaryRoot)[0].includes('2100x2000'));
  }
});

test("a private index path mismatch refuses cleanup instead of trusting a cache collision", async () => {
  const root = makeFolder('root');
  const loaded = loadExportService(root);
  const variant = variantFixture(loaded.context.window.IDPhotoVariantService, 'red');
  await loaded.service.exportSingleJpg(savingDocument(), exportOptions(638,898,variant));
  const cached = Array.from(root.entries.get('archive-index-cache').entries.values()).find(file => file.name.endsWith('.json'));
  const value = JSON.parse(cached.content);
  value.directory = 'c:/unrelated';
  cached.content = JSON.stringify(value);
  const result = await loaded.service.exportSingleJpg(savingDocument(), exportOptions(827,1157,variant));
  assert.equal(result.indexUnavailable,true);
  assert.equal(jpgNames(root).length,2);
});
