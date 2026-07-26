"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const plannerPath = path.join(__dirname, "..", "src", "core", "smartCropPlanner.js");

function loadPlanner() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(plannerPath, "utf8"), context, { filename: plannerPath });
  return context.window.IDPhotoSmartCropPlanner;
}

test("portrait crop preserves headroom and removes excess mostly from the bottom", () => {
  const planner = loadPlanner();
  const plan = planner.plan({
    width: 2000,
    height: 3000,
    targetRatio: 350 / 490,
    subjectBounds: { left: 480, top: 100, right: 1520, bottom: 2960 }
  });

  assert.equal(plan.mode, "crop");
  assert.equal(plan.bounds.top, 0);
  assert.equal(plan.bounds.bottom, 2800);
  assert.equal(plan.reason, "fast-composition");
  assert.equal(plan.headroomPx, null);
  assert.equal(plan.subjectDetected, false);
});

test("a 6960x4640 landscape portrait crops empty sides around the subject", () => {
  const planner = loadPlanner();
  const plan = planner.plan({
    width: 6960,
    height: 4640,
    targetRatio: 3.5 / 4.5,
    subjectBounds: { left: 2200, top: 280, right: 4700, bottom: 4640 }
  });

  assert.equal(plan.mode, "crop");
  assert.equal(plan.bounds.height, 4640);
  assert.equal(plan.bounds.width, 3609);
  assert.ok(plan.bounds.left > 1500 && plan.bounds.left < 1800);
  assert.ok(plan.bounds.left < 2200);
  assert.ok(plan.bounds.right > 4700);
});

test("a wide foreground still crops the landscape background without automatic expansion", () => {
  const planner = loadPlanner();
  const plan = planner.plan({
    width: 6960,
    height: 4640,
    targetRatio: 2.7 / 3.8,
    subjectBounds: { left: 900, top: 250, right: 6100, bottom: 4640 }
  });

  assert.equal(plan.mode, "crop");
  assert.equal(plan.reason, "fast-composition");
  assert.equal(plan.bounds.top, 0);
  assert.equal(plan.bounds.bottom, 4640);
  assert.equal(plan.bounds.width, 3297);
  assert.equal(plan.bounds.left, Math.round((6960 - 3297) / 2));
});

test("fast composition crops without requiring subject detection", () => {
  const planner = loadPlanner();
  const plan = planner.plan({
    width: 6960,
    height: 4640,
    targetRatio: 3.5 / 4.5,
    subjectBounds: null
  });

  assert.equal(plan.mode, "crop");
  assert.equal(plan.reason, "fast-composition");
  assert.equal(plan.bounds.left, Math.round((6960 - 3609) / 2));
});

test("a 1:1 target is marked for the square-template expansion policy", () => {
  const planner = loadPlanner();
  const plan = planner.plan({
    width: 2000,
    height: 3000,
    targetRatio: 1
  });

  assert.equal(plan.squareTarget, true);
  assert.equal(plan.bounds.left, 0);
  assert.equal(plan.bounds.top, 0);
  assert.equal(plan.bounds.right, 2000);
  assert.equal(plan.bounds.bottom, 2000);
});
