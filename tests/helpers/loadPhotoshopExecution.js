"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const executionPath = path.join(__dirname, "..", "..", "src", "photoshop", "photoshopExecution.js");
const executionSource = fs.readFileSync(executionPath, "utf8");

module.exports = function loadPhotoshopExecution(context) {
  vm.runInContext(executionSource, context, { filename: executionPath });
  return context.window.IDPhotoPhotoshopExecution;
};
