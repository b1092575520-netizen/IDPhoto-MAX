"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadTemplateModules() {
  const context = {
    console: {
      log() {},
      warn() {},
      error() {}
    },
    window: {}
  };
  vm.createContext(context);
  for (const relativePath of ["src/core/templateRegistry.js", "src/core/layoutEngine.js"]) {
    const filePath = path.join(__dirname, "..", relativePath);
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
      filename: filePath
    });
  }
  return context.window;
}

test("all reference templates have unique in-bounds slots", () => {
  const modules = loadTemplateModules();
  const templates = modules.IDPhotoTemplates.getAllTemplates();

  assert.equal(templates.length, 11);

  for (const template of templates) {
    const plan = modules.IDPhotoLayoutEngine.createLayoutPlan({
      template,
      rowGap: 10,
      colGap: 10
    });
    const slotKeys = plan.positions.map((position) =>
      [position.x, position.y, position.width, position.height, position.rotate].join(":")
    );

    assert.equal(plan.positions.length, template.photoSlots.length, template.id);
    assert.equal(new Set(slotKeys).size, plan.positions.length, template.id);
    for (const position of plan.positions) {
      assert.ok(position.x >= 0 && position.y >= 0, template.id);
      assert.ok(position.x + position.width <= plan.canvas.widthPx, template.id);
      assert.ok(position.y + position.height <= plan.canvas.heightPx, template.id);
    }
  }
});

// Stage 5 supersedes the full-length bars. The bounds below are the original
// unoccupied rectangles, with only the explicitly authorized US fifth slot changed.
const spaces = {
  'one-inch':[0,1845,3592,555], 'standard-two-inch':[3400,0,200,2400],
  'visa-two-inch':[0,2174,3600,226], 'small-two-inch':[3239,0,361,2400],
  'hongkong-taiwan':[0,1950,3592,450], brazil:[2916,0,284,2400],
  argentina:[0,1945,3600,455], 'us-visa':[2420,1200,1180,1182],
  'us-visa-51':[0,1268,3590,369], graduation:[2943,0,273,2400], wedding:[0,1795,3592,555]
};
test('all eleven detachable bars fit the bag, old spaces, photos, avatar and code', () => {
  for (const t of loadTemplateModules().IDPhotoTemplates.getAllTemplates()) {
    const b=t.infoBar, space=spaces[t.id], [x,y,w,h]=space;
    assert.ok(b.enabled && b.width>0 && b.height>0,t.id);
    assert.ok(Math.max(b.width,b.height)*25.4/600<=70,t.id+' long edge');
    assert.ok(Math.min(b.width,b.height)*25.4/600<=50,t.id+' short edge');
    assert.ok(b.x>=x && b.y>=y && b.x+b.width<=x+w && b.y+b.height<=y+h,t.id+' empty space');
    for (const p of t.photoSlots) assert.ok(b.x>=p.x+p.width || b.x+b.width<=p.x || b.y>=p.y+p.height || b.y+b.height<=p.y,t.id+' photo overlap');
    for(const item of [b.avatar,...b.texts]) assert.ok(item.x>=b.x && item.y>=b.y && item.x+item.width<=b.x+b.width && item.y+item.height<=b.y+b.height,t.id+' clipped content');
    assert.equal(b.texts.filter(x=>x.key==='pickupCode').length,1);
    assert.equal(b.textLayers,undefined,'one canonical layout source');
    assert.match(t.referencePath,/示例图片/);
  }
});
test('only US 5x5 loses its lower-right photo; all other slots match the frozen pre-stage5 baseline',()=>{
  const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','stage5-original-slots.json'),'utf8'));
  for(const t of loadTemplateModules().IDPhotoTemplates.getAllTemplates()) {
    const expected=baseline[t.id]; if(t.id==='us-visa') expected.pop();
    assert.deepEqual(JSON.parse(JSON.stringify(t.photoSlots)),expected,t.id);
  }
  const t=loadTemplateModules().IDPhotoTemplates.getTemplateById('us-visa-51');
  assert.equal(t.widthCm,5.1); assert.equal(t.heightCm,5.1);
});
