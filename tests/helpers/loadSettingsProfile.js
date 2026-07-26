"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const profilePath = path.join(__dirname, "..", "..", "src", "core", "settingsProfile.js");
const profileSource = fs.readFileSync(profilePath, "utf8");

module.exports = function loadSettingsProfile(context) {
  vm.runInContext(profileSource, context, { filename: profilePath });
  return context.window.IDPhotoSettingsProfile;
};
