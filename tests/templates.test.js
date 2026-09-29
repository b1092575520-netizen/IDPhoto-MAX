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
  for (const relativePath of ["src/core/templateRegistry.js", "src/core/layoutEngine.js",
    "src/core/deliveryProtocol.js", "src/core/pickupStripLayout.js"]) {
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

// Empty rectangles are frozen independently of the new strip planner.
const spaces = {
  'one-inch':[0,1845,3592,555], 'standard-two-inch':[3400,0,200,2400],
  'visa-two-inch':[0,2174,3600,226], 'small-two-inch':[3239,0,361,2400],
  'hongkong-taiwan':[0,1950,3592,450], brazil:[2916,0,284,2400],
  argentina:[0,1945,3600,455], 'us-visa':[2420,1200,1180,1182],
  'us-visa-51':[0,1268,3590,369], graduation:[2943,0,273,2400], wedding:[0,1795,3592,555]
};
test('all eleven delivery bars fit 60mm, preserve photos and contain safe nonoverlapping content', () => {
  const modules = loadTemplateModules();
  for (const raw of modules.IDPhotoTemplates.getAllTemplates()) {
    const t=modules.IDPhotoTemplates.forDelivery(raw,true);
    const outputPlan=modules.IDPhotoLayoutEngine.createLayoutPlan({template:t});
    assert.equal(outputPlan.infoBar.pickupLayout,'v5',t.id+' real layout pipeline keeps renderer selection');
    assert.equal(outputPlan.infoBar.layoutVersion,7);
    assert.equal(outputPlan.infoBar.safeMargin,24);
    const b=t.infoBar, space=spaces[t.id], [x,y,w,h]=space;
    assert.ok(b.enabled && b.width>0 && b.height>0,t.id);
    assert.ok(Math.max(b.width,b.height)*25.4/600<=60,t.id+' long edge');
    assert.ok(Math.min(b.width,b.height)*25.4/600<=50,t.id+' short edge');
    assert.ok(b.x>=x && b.y>=y && b.x+b.width<=x+w && b.y+b.height<=y+h,t.id+' empty space');
    for (const p of t.photoSlots) assert.ok(b.x>=p.x+p.width || b.x+b.width<=p.x || b.y>=p.y+p.height || b.y+b.height<=p.y,t.id+' photo overlap');
    for(const photoRatio of [.35,.74,1,1.5,3]) for(const entryCodeAvailable of [false,true]) {
      const plan=modules.IDPhotoPickupStripLayout.plan(b,{shopName:'福清印象照相馆',shopPhone:'13003825982'},
        {pickupCode:'A2B3C4',dateText:'2026.09.29',entryCodeAvailable},photoRatio);
      const all=[...plan.items,...plan.regions].map(r=>modules.IDPhotoPickupStripLayout.placed(b,plan,r));
      for(const item of all) {
        assert.ok(item.x>=b.x+24 && item.y>=b.y+24 && item.x+item.width<=b.x+b.width-24 && item.y+item.height<=b.y+b.height-24,t.id+' safe content');
        for(const other of all.filter(x=>x!==item)) assert.ok(item.x>=other.x+other.width || item.x+item.width<=other.x || item.y>=other.y+other.height || item.y+item.height<=other.y,t.id+' nonoverlap');
      }
      assert.equal(plan.items.filter(x=>x.key==='pickupCode'&&x.text==='A2B3C4').length,1);
      const qr=plan.regions.find(x=>x.key==='entryCode');
      assert.equal(Boolean(qr),plan.entryCodeShown);
      if(qr) assert.deepEqual([qr.width,qr.height],[425,425]);
      else assert.equal(plan.items.some(x=>/扫码|扫一扫|占位/.test(x.text)),false);
      if(plan.vertical||plan.height<360) {
        assert.equal(plan.items.find(x=>x.key==='pickupLabel').x,plan.items.find(x=>x.key==='steps').x);
        assert.equal(plan.items.find(x=>x.key==='details').x,plan.items.find(x=>x.key==='steps').x);
      }
    }
    assert.equal(b.textLayers,undefined,'one canonical layout source');
    assert.match(t.referencePath,/示例图片/);
  }
});
test('ordinary templates match the v0.5.8 reference; US 5x5 remains five photos with no bar',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','ordinary-v058-bars.json'),'utf8'));
  const templates=loadTemplateModules().IDPhotoTemplates;
  for(const raw of templates.getAllTemplates()) {
    const ordinary=templates.forDelivery(raw,false);
    assert.deepEqual(JSON.parse(JSON.stringify(ordinary.infoBar)),fixture.bars[raw.id],raw.id);
    const delivery=templates.forDelivery(raw,true);
    assert.deepEqual(JSON.parse(JSON.stringify(templates.forDelivery(delivery,false).infoBar)),fixture.bars[raw.id]);
  }
  assert.equal(templates.getTemplateById('us-visa').photoSlots.length,5);
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
