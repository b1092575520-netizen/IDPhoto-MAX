"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadSettingsProfile = require("./helpers/loadSettingsProfile");

const servicePath = path.join(__dirname, "..", "src", "core", "sourceEligibilityService.js");

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
});

test("only registered camera serial numbers are eligible for automatic saving", () => {
  const service = loadService();
  const shopCamera = { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "0123456789", hasXmp: true };

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
  const shopCamera = { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "160402000589", hasXmp: true };
  const externalCamera = { make: "Canon", model: "Canon EOS R6 Mark III", serialNumber: "999999999999", hasXmp: true };

  assert.equal(service.getInfoBarDecision(shopCamera).showInfoBar, false);
  service.registerCamera(shopCamera);
  assert.equal(service.getInfoBarDecision(shopCamera).showInfoBar, true);
  assert.equal(service.getInfoBarDecision(externalCamera).leaveBlank, true);
  assert.equal(service.getInfoBarDecision({ serialNumber: "" }).leaveBlank, true);
});
