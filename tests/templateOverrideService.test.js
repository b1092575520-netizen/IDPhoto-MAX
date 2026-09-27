"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const modulePath = path.join(__dirname, "..", "src", "core", "templateOverrideService.js");

function loadService() {
  const storedOverrides = { one: { infoBar: { x: 33 } } };
  const context = {
    window: {
      IDPhotoDebugSettingsStore: {
        getOverride(templateId) {
          return storedOverrides[templateId] || null;
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(modulePath, "utf8"), context, { filename: modulePath });
  return { service: context.window.IDPhotoTemplateOverrideService, storedOverrides };
}

test("clearing all runtime overrides reveals the restored persistent values", () => {
  const loaded = loadService();
  loaded.service.applyRuntimeOverride("one", { infoBar: { x: 88 } });
  assert.equal(loaded.service.getOverride("one").infoBar.x, 88);

  loaded.storedOverrides.one = { infoBar: { x: 44 } };
  loaded.service.clearAllRuntimeOverrides();

  assert.equal(loaded.service.getOverride("one").infoBar.x, 44);
});

test("stage5 retains old overrides without applying them and restores saved code geometry", () => {
  const {service,storedOverrides}=loadService();
  const template={id:'one',infoBar:{layoutVersion:5,x:10,texts:[{key:'pickupCode',x:20,y:30,width:400,height:100,fontSize:13},{key:'shopContact',x:20,y:150,width:400,height:80,fontSize:8}]}};
  assert.equal(service.getEffectiveTemplate(template).infoBar.x,10);
  assert.equal(storedOverrides.one.infoBar.x,33);
  storedOverrides.one={layoutVersion:5,textLayers:{pickupCode:{x:35,y:45,width:500,height:120,fontSize:14},shopContact:{x:35,y:180,width:450,height:90,fontSize:9}}};
  const result=service.getEffectiveTemplate(template);
  assert.deepEqual(JSON.parse(JSON.stringify(result.infoBar.texts)).map(t=>[t.key,t.x,t.y,t.width,t.height,t.fontSize]),[['pickupCode',35,45,500,120,14],['shopContact',35,180,450,90,9]]);
});
