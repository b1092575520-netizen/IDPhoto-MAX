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

// Pickup cards (user 10-18): red band to the paper edge, card <= 60 mm, text 2 mm from paper edges.
const bands = {
  'one-inch':[0,1845,3600,555], 'standard-two-inch':[3386,0,214,2400],
  'visa-two-inch':[0,2174,3600,226], 'small-two-inch':[3236,0,364,2400],
  'hongkong-taiwan':[2928,0,672,2400], brazil:[2903,0,697,2400],
  argentina:[2916,0,684,2400], 'us-visa':[2408,1197,1192,600],
  'us-visa-51':[0,1222,1417,470], graduation:[2920,0,680,2400], wedding:[0,1738,3600,662]
};
const apart=(a,b)=>a.x>=b.x+b.width||a.x+a.width<=b.x||a.y>=b.y+b.height||a.y+a.height<=b.y;
const inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;
test('all eleven pickup cards fit 60mm, keep clear of photos and paper bleed, and never overlap', () => {
  const modules = loadTemplateModules(), layout=modules.IDPhotoPickupStripLayout;
  for (const raw of modules.IDPhotoTemplates.getAllTemplates()) {
    const t=modules.IDPhotoTemplates.forDelivery(raw,true);
    const outputPlan=modules.IDPhotoLayoutEngine.createLayoutPlan({template:t});
    assert.equal(outputPlan.infoBar.pickupLayout,'v5',t.id+' real layout pipeline keeps renderer selection');
    assert.equal(outputPlan.infoBar.layoutVersion,7);
    assert.deepEqual({...outputPlan.infoBar.band},{...t.infoBar.band},t.id+' band survives the layout engine');
    const b=t.infoBar, [x,y,w,h]=bands[t.id], band={x,y,width:w,height:h};
    assert.deepEqual({...b.band},band,t.id+' band');
    assert.ok(Math.max(b.width,b.height)*25.4/600<=60,t.id+' long edge');
    assert.ok(inside(b,band),t.id+' card inside band');
    const outline=layout.outline(b);
    assert.ok(inside(outline,{x:0,y:0,width:3600,height:2400}),t.id+' canvas');
    for (const p of t.photoSlots) { assert.ok(apart(band,p),t.id+' band/photo'); assert.ok(apart(outline,p),t.id+' code/photo'); }
    for(const photoRatio of [.6,.74,.8,1]) for(const entryCodeAvailable of [false,true]) {
      const plan=layout.plan(b,{shopName:'福清印象照相馆',shopPhone:'13003825982'},
        {pickupCode:'W8MWQM',dateText:'2026.10.18',entryCodeAvailable},photoRatio);
      const placed=[...plan.items,...plan.regions].map(r=>({key:r.key,...layout.placed(b,plan,r)}));
      for(const item of placed) {
        if(item.key==='entryCode') {
          assert.ok(inside(item,outline),t.id+' code inside outline');
          assert.ok(item.x>=24&&item.y>=24&&item.x+item.width<=3576&&item.y+item.height<=2376,t.id+' code off the bleed');
          assert.ok(item.width>=180&&item.width===item.height,t.id+' code size '+item.width);
        } else {
          assert.ok(inside(item,b),t.id+' '+item.key+' inside card');
          const edge=b.textPadding?Math.min(...b.textPadding):48; // 签证2寸 keeps the agreed 1 mm to fit its 9.6 mm strip
          assert.ok(item.x>=edge&&item.y>=edge&&item.x+item.width<=3600-edge&&item.y+item.height<=2400-edge,t.id+' '+item.key+' clear of the paper edge');
        }
        for(const other of placed.filter(o=>o!==item)) assert.ok(apart(item,other),t.id+' '+item.key+'/'+other.key);
      }
      assert.equal(plan.items.filter(x=>x.key==='pickupCode'&&x.text==='W8MWQM').length,1);
      assert.equal(plan.turn,plan.vertical?'ccw':'',t.id+' heads point to the photos');
      const qr=plan.regions.find(x=>x.key==='entryCode');
      assert.equal(Boolean(qr),entryCodeAvailable);
      if(qr) assert.equal(qr.variant,['visa-two-inch','standard-two-inch'].includes(t.id)?'coarse':'logo',t.id);
      else assert.equal(plan.items.some(x=>/扫/.test(x.text)),false,t.id+' no scan step without a code');
      assert.equal(plan.items.some(x=>/作废|过期/.test(x.text)),false);
      for(const item of plan.items) assert.ok(item.fontSize>=(photoRatio<1?4.5:4),t.id+' '+item.key+' '+item.fontSize+'pt');
      if(b.pickupFamily!=='wide') {
        assert.equal(plan.items.find(x=>x.key==='pickupLabel').x,plan.items.find(x=>x.key==='steps').x);
        assert.equal(plan.items.find(x=>x.key==='details').x,plan.items.find(x=>x.key==='steps').x);
      } else assert.equal(plan.items.find(x=>x.key==='title').text,'请7天内领取电子照片');
    }
    assert.equal(b.textLayers,undefined,'one canonical layout source');
    assert.match(t.referencePath,/示例图片/);
  }
});
test('counter-clockwise placement puts reading top on the photo side and reading left at the sheet bottom', () => {
  const layout=loadTemplateModules().IDPhotoPickupStripLayout, bar={x:3000,y:0,width:600,height:1417,orientation:'vertical'};
  const reading={vertical:true,turn:'ccw',width:1417,height:600};
  assert.deepEqual({...layout.placed(bar,reading,{x:0,y:0,width:100,height:50})},{x:3000,y:1317,width:50,height:100});
  assert.deepEqual({...layout.placed(bar,{...reading,turn:''},{x:0,y:0,width:100,height:50})},{x:3550,y:0,width:50,height:100});
});
test('ordinary bars use the one-inch style on every template; US 5x5 keeps five photos and an upright corner strip',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','ordinary-v058-bars.json'),'utf8'));
  const templates=loadTemplateModules().IDPhotoTemplates;
  for(const raw of templates.getAllTemplates()) {
    const ordinary=templates.forDelivery(raw,false).infoBar;
    assert.equal(ordinary.enabled,true,raw.id);
    assert.equal(ordinary.ordinaryLayout,'classic',raw.id);
    const area=raw.id==='us-visa'?{position:'right',orientation:'vertical',x:2420,y:1200,width:360,height:1181}:fixture.bars[raw.id];
    for(const key of ['position','orientation','x','y','width','height']) assert.equal(ordinary[key],area[key],raw.id+' '+key);
    const delivery=templates.forDelivery(raw,true);
    assert.equal(delivery.infoBar.ordinaryLayout,undefined,'delivery strips keep their own layout');
    assert.deepEqual(JSON.parse(JSON.stringify(templates.forDelivery(delivery,false).infoBar)),JSON.parse(JSON.stringify(ordinary)));
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

test('the layout plan Photoshop actually draws keeps the one-inch style marker for every ordinary bar',()=>{
  const modules=loadTemplateModules(), templates=modules.IDPhotoTemplates;
  for(const raw of templates.getAllTemplates()) {
    const ordinary=templates.forDelivery(raw,false);
    const plan=modules.IDPhotoLayoutEngine.createLayoutPlan({template:ordinary});
    assert.equal(plan.infoBar.ordinaryLayout,'classic',raw.id);
    const delivery=modules.IDPhotoLayoutEngine.createLayoutPlan({template:templates.forDelivery(raw,true)});
    assert.equal(delivery.infoBar.ordinaryLayout,undefined,raw.id+' delivery');
  }
});

test("saved photos use the largest pixels among the same or nearly the same shape (within 1%)", () => {
  const registry = { window: {} };
  vm.createContext(registry);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/templateRegistry.js"), "utf8"), registry);
  const templates = registry.window.IDPhotoTemplates;
  const save = (id) => { const size = templates.getSaveSize(templates.getTemplateById(id)); return size.widthPx + "x" + size.heightPx; };
  assert.equal(save("one-inch"), "827x1157");
  assert.equal(save("standard-two-inch"), "827x1157");
  for (const id of ["argentina", "us-visa", "us-visa-51"]) assert.equal(save(id), "1205x1205");
  for (const template of templates.getAllTemplates()) {
    if (["one-inch", "standard-two-inch", "argentina", "us-visa", "us-visa-51"].includes(template.id)) continue;
    assert.equal(save(template.id), template.widthPx + "x" + template.heightPx, template.id);
  }
  assert.equal(templates.getSaveSize({ widthPx: 0, heightPx: 10 }), null);
});
