"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("manifest, README, and changelog agree on the current version", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const progress = fs.readFileSync(path.join(root, "DEV_PROGRESS.md"), "utf8");
  const readmeVersions = [...readme.matchAll(/当前版本为 v(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
  const changelogVersion = changelog.match(/^## (\d+\.\d+\.\d+)/m);

  assert.deepEqual(readmeVersions, [manifest.version]);
  assert.equal(packageJson.version, manifest.version);
  assert.equal(changelogVersion && changelogVersion[1], manifest.version);
  assert.match(progress, new RegExp("当前阶段\\s+v" + manifest.version.replace(/\./g, "\\.")));
});

test("the filesystem-discovered third-party manifest uses a host object", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

  assert.equal(Array.isArray(manifest.host), false);
  assert.equal(manifest.host.app, "PS");
  assert.equal(manifest.host.minVersion, "25.0.0");
});

test("the release UI does not expose an internal build marker", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  assert.doesNotMatch(html, /id="buildText"|build:\s*\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(main, /BUILD_TIME|\[idphoto-build\]/);
});

test("the retired background replacement module is not shipped", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  const shortcuts = fs.readFileSync(path.join(root, "src", "core", "shortcutService.js"), "utf8");

  assert.doesNotMatch(html, /backgroundSection|backgroundService|bg-btn|R\/B\/W\/T/);
  assert.doesNotMatch(main, /IDPhotoBackgroundService|selectBackgroundByAction|isBackgroundRunning/);
  assert.doesNotMatch(shortcuts, /keyBackgroundMap|selectBackground|clearAction/);
  assert.equal(fs.existsSync(path.join(root, "src", "photoshop", "backgroundService.js")), false);
});

test("automatic crop does not ship Photoshop Select Subject", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cropService = fs.readFileSync(path.join(root, "src", "photoshop", "cropService.js"), "utf8");

  assert.doesNotMatch(html, /subjectDetectionService/);
  assert.doesNotMatch(cropService, /IDPhotoSubjectDetectionService|autoCutout/);
  assert.equal(fs.existsSync(path.join(root, "src", "photoshop", "subjectDetectionService.js")), false);
});

test("main initializes the settings view controller", () => {
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");

  assert.match(main, /IDPhotoSettingsViewController\.create\(/);
  assert.match(main, /settingsViewController\.init\(\)/);
});

test("camera registration actions use the UXP-safe flex layout", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const rule = css.match(/\.settings-actions\s*\{([\s\S]*?)\}/);

  assert.ok(rule);
  assert.match(rule[1], /display:\s*flex/);
  assert.doesNotMatch(rule[1], /display:\s*grid/);
});

test("the centralized layout path applies source eligibility to every information bar", () => {
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, "src", "core", "layoutWorkflow.js"), "utf8");

  assert.match(main, /IDPhotoLayoutWorkflow\.create/);
  assert.match(workflow, /IDPhotoSourceEligibilityService\.getInfoBarDecision/);
  assert.match(workflow, /renderInfoBar\(targetDocument, layoutPlan, template, docInfo, runOptions\)/);
  assert.match(workflow, /runTemplateLayout\(processResult\.document, targetDocument, template, docInfo, runOptions\)/);
  assert.match(workflow, /信息条区域留白/);
});

test("visual acceptance selects every template and disables all export side effects", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");

  assert.match(html, /id="runVisualAcceptance"/);
  assert.match(main, /function runVisualAcceptance\(\)/);
  assert.match(main, /applySelectedTemplateIds\(getTemplateOrder\(\)/);
  assert.match(main, /skipExport:\s*true/);
  assert.match(main, /skipPrint:\s*true/);
  assert.match(main, /debugMode:\s*false/);
});

test("quick print is fixed to DS-RX1 and loads before the layout workflow", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const printService = fs.readFileSync(path.join(root, "src", "photoshop", "printService.js"), "utf8");

  assert.match(html, /data-key="quickPrint"/);
  assert.doesNotMatch(html, /captureQuickPrintProfile|quickPrintProfileStatus|快速打印校准/);
  assert.ok(html.indexOf("src/photoshop/printService.js") < html.indexOf("src/core/layoutWorkflow.js"));
  assert.deepEqual(manifest.requiredPermissions.launchProcess.extensions, [".idprint"]);
  assert.match(printService, /DS-RX1/);
  assert.match(printService, /\(6x4\)/);
  assert.match(printService, /printOneCopy/);
  assert.match(printService, /shell\.openPath/);
  assert.doesNotMatch(printService, /setActivePrintSettings|captureCurrentPrinterProfile|printSettings/);
});

test("the compact layout keeps every template visible and groups visa two-inch correctly", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const regularSection = html.slice(html.indexOf("常规排版"), html.indexOf("签证排版"));
  const visaSection = html.slice(html.indexOf("签证排版"), html.indexOf("特种尺寸"));

  assert.doesNotMatch(regularSection, /签证2寸/);
  assert.match(visaSection, /签证2寸/);
  assert.equal((html.match(/class="[^"]*size-btn/g) || []).length, 11);
  assert.match(html, /class="section-body output-options"/);
  assert.doesNotMatch(html, /quick-print-note/);
});

test("settings use a two-column home and one detail page without retired strips", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const controller = fs.readFileSync(path.join(root, "src", "ui", "settingsViewController.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");

  assert.equal((html.match(/class="section-block settings-card/g) || []).length, 6);
  assert.equal((html.match(/class="[^"]*settings-card-toggle/g) || []).length, 6);
  assert.equal((html.match(/settings-card[^\"]* open/g) || []).length, 0);
  assert.match(html, /id="settingsBackButton"/);
  assert.match(html, /class="settings-grid"/);
  const settingsLayout = css.match(/\.settings-grid\s*\{([\s\S]*?)\}/);
  assert.ok(settingsLayout);
  assert.match(settingsLayout[1], /display:\s*flex/);
  assert.match(settingsLayout[1], /flex-wrap:\s*wrap/);
  assert.doesNotMatch(settingsLayout[1], /display:\s*grid|grid-template-columns/);
  assert.doesNotMatch(html, /设置中心|裁剪与扩图策略|快捷键设置|data-view="debugView"/);
  assert.match(controller, /function initSettingsNavigation\(\)/);
  assert.doesNotMatch(main, /tab\.addEventListener\("mouseenter", openTab\)/);
});
