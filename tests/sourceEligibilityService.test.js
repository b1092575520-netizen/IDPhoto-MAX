"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadSettingsProfile = require("./helpers/loadSettingsProfile");

const servicePath = path.join(__dirname, "..", "src", "core", "sourceEligibilityService.js");
const today = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};

function loadService(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  const context = {
    window: {
      localStorage: {
        getItem(key) {
          return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
          values.set(key, String(value));
        },
        removeItem(key) {
          values.delete(key);
        }
      }
    }
  };
  vm.createContext(context);
  loadSettingsProfile(context);
  vm.runInContext(fs.readFileSync(servicePath, "utf8"), context, { filename: servicePath });
  return context.window.IDPhotoSourceEligibilityService;
}

test("Canon XMP camera metadata is parsed from both attributes and elements", () => {
  const service = loadService();
  const metadata = service.parseXmp(`
    <rdf:Description tiff:Make="Canon" tiff:Model="Canon EOS R6 Mark III">
      <aux:SerialNumber>0123456789</aux:SerialNumber>
    </rdf:Description>
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), {
    make: "Canon",
    model: "Canon EOS R6 Mark III",
    serialNumber: "0123456789",
    captureDate: "",
    historical: false,
    hasXmp: true
  });
});

test("the shop Canon sample BodySerialNumber is parsed from Photoshop XMP", () => {
  const service = loadService();
  const metadata = service.parseXmp(`
    <rdf:Description tiff:Make="Canon" tiff:Model="Canon EOS R6 Mark III"
      exifEX:BodySerialNumber="160402000589" />
  `);

  assert.equal(metadata.make, "Canon");
  assert.equal(metadata.model, "Canon EOS R6 Mark III");
  assert.equal(metadata.serialNumber, "160402000589");
  assert.equal(metadata.captureDate, "");
});

test("a capture date from a previous day is treated as a historical source", () => {
  const service = loadService();
  const historical = {
    make: "Canon",
    model: "Canon EOS R6 Mark III",
    serialNumber: "0123456789",
    captureDate: "2000:01:02 12:34:56",
    historical: false
  };

  service.registerCamera(historical);
  assert.equal(service.isHistoricalSource(historical), true);
  assert.equal(service.checkSource(historical).reason, "historical-source");
  assert.equal(service.getInfoBarDecision(historical).leaveBlank, true);
});

test("plugin-generated document names are historical even without XMP date", () => {
  const service = loadService();
  const camera = { serialNumber: "0123456789", historical: false };

  service.registerCamera(camera);
  assert.equal(service.checkSource(camera, "2026-08-25_1寸_638x898_红_A7K3M9.jpg").reason, "historical-source");
  assert.equal(service.checkSource(camera, "2026-08-22_结婚照5.3x3.5_1252.jpg").reason, "historical-source");
});

test("only registered camera serial numbers are eligible for automatic saving", () => {
  const service = loadService();
  const shopCamera = { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "0123456789", hasXmp: true, captureDate: today() };

  assert.equal(service.checkSource(shopCamera).reason, "no-registered-camera");
  assert.equal(service.registerCamera(shopCamera).ok, true);
  assert.equal(service.checkSource(shopCamera).eligible, true);
  assert.equal(
    service.checkSource({ make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "9999999999", hasXmp: true }).reason,
    "external-camera"
  );
  assert.equal(service.checkSource({ make: "", model: "", serialNumber: "", hasXmp: false }).reason, "missing-serial");
});

test("the same registered serial is not duplicated", () => {
  const service = loadService();
  const camera = { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: " 0123 456789 ", hasXmp: true };

  service.registerCamera(camera);
  service.registerCamera(camera);

  assert.equal(service.loadRegisteredCameras().length, 1);
});

test("information-bar content follows the same shop-camera eligibility as JPG saving", () => {
  const service = loadService();
  const shopCamera = { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "160402000589", hasXmp: true, captureDate: today() };
  const externalCamera = { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "999999999999", hasXmp: true };

  assert.equal(service.getInfoBarDecision(shopCamera).showInfoBar, false);
  service.registerCamera(shopCamera);
  assert.equal(service.getInfoBarDecision(shopCamera).showInfoBar, true);
  assert.equal(service.getInfoBarDecision(externalCamera).leaveBlank, true);
  assert.equal(service.getInfoBarDecision({ serialNumber: "" }).leaveBlank, true);
});

test("registered camera without a trustworthy capture date never authorizes saving", () => {
  const service = loadService();
  service.registerCamera({ serialNumber: "shop" });
  for (const captureDate of [undefined, "", "garbage", "2026-02-31", "prefix" + today(), today() + "oops"]) {
    const metadata = { serialNumber: "shop", captureDate };
    assert.equal(service.checkSource(metadata, "renamed.psd").eligible, false, String(captureDate));
    assert.equal(service.getInfoBarDecision(metadata, "renamed.psd").leaveBlank, true);
  }
  assert.equal(service.checkSource({ serialNumber: "shop", captureDate: today() }, "new.psd").eligible, true);
});

test("reopened exports stay historical after Photoshop copy suffix or extension changes", () => {
  const service = loadService();
  const metadata = { serialNumber: "shop", captureDate: today() };
  service.registerCamera(metadata);
  for (const name of ["1寸_638x898_白_BFP6MY.jpg", "1寸_638x898_白_BFP6MY 副本.psd", "标准2寸_827x1157_蓝_15AJJ4 copy 2.tif", "证件照排版_1寸"]) {
    assert.equal(service.checkSource(metadata, name).reason, "historical-source", name);
  }
});

test("digitizing or editing an old shop photo today cannot substitute for DateTimeOriginal", () => {
  const service = loadService();
  service.registerCamera({ serialNumber: "shop" });
  const metadata = service.parseXmp(`<rdf:Description aux:SerialNumber="shop" exif:DateTimeDigitized="${today()}T12:00:00" photoshop:DateCreated="${today()}" />`);
  assert.equal(service.checkSource(metadata, "old-renamed.psd").eligible, false);
});
