"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const servicePath = path.join(__dirname, "..", "src", "core", "pathService.js");

function loadService() {
  const context = {
    window: {
      IDPhotoDateService: {
        getTodayParts() {
          return { year: 2026, month: 8, day: 26 };
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(servicePath, "utf8"), context, { filename: servicePath });
  return context.window.IDPhotoPathService;
}

test("JPG names expose only the template, pixels, background, and short identity token", () => {
  const service = loadService();
  const name = service.makeJpgFileName(
    "1寸 2.7x3.8",
    "客户原片.psd",
    638,
    898,
    { backgroundColor: "red", identityMarker: "v2" + "a".repeat(129) }
  );

  assert.match(name, /^1寸_638x898_红_[A-Z0-9]{6}\.jpg$/);
  assert.equal(name.length <= 30, true);
  assert.equal(service.makeJpgVariantToken({ identityMarker: "same" }, "other.psd"), service.makeJpgVariantToken({ identityMarker: "same" }, "source.psd"));
});

test("short names still include unknown background when analysis is unavailable", () => {
  const service = loadService();
  assert.match(service.makeJpgFileName("标准2寸 3.5x4.9", "portrait.psd", 827, 1157), /^标准2寸_827x1157_未知_[A-Z0-9]{6}\.jpg$/);
});
