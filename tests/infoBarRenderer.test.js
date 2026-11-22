"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");

const registryPath = path.join(__dirname, "..", "src", "core", "templateRegistry.js");
const rendererPath = path.join(__dirname, "..", "src", "photoshop", "infoBarRenderer.js");

function loadTemplates() {
  const context = { console: { log() {} }, window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(registryPath, "utf8"), context, { filename: registryPath });
  return context.window.IDPhotoTemplates;
}

function makeRendererHarness(options) {
  let nextLayerId = 1;
  let createdTextLayer = null;
  let activateCount = 0;
  let knownLayerSnapshotCount = 0;
  const textKnownLayerIds = [];
  const textCommands = [];
  const duplicateCalls = [];
  const moveCounts = new Map();
  const targetDocument = {
    layers: [],
    async activate() {
      activateCount += 1;
    }
  };
  const sourceLayer = {
    id: 900,
    bounds: { left: 0, top: 0, right: 950, bottom: 950 }
  };
  const sourceDocument = {
    layers: [sourceLayer],
    activeLayers: [sourceLayer]
  };

  const layerService = {
    async duplicateLayerToDocument(sourceDocument, sourceLayer, destinationDocument) {
      duplicateCalls.push({ sourceDocument, sourceLayer, destinationDocument });
      const layer = {
        id: nextLayerId++,
        bounds: { left: 0, top: 0, right: 950, bottom: 950 },
        async resize(percent) {
          this.bounds.right = this.bounds.left + ((this.bounds.right-this.bounds.left) * percent) / 100;
          this.bounds.bottom = this.bounds.top + ((this.bounds.bottom-this.bounds.top) * percent) / 100;
        }
      };
      if (sourceDocument === destinationDocument) {
        const sourceIndex = destinationDocument.layers.indexOf(sourceLayer);
        destinationDocument.layers.splice(sourceIndex < 0 ? 0 : sourceIndex, 0, layer);
      } else {
        destinationDocument.layers.unshift(layer);
      }
      destinationDocument.activeLayers = [layer];
      return layer;
    },
    findLayerByName(layers, name) {
      return (layers || []).find((layer) => layer.name === name) || null;
    },
    getLayerBounds(layer) {
      return layer.bounds;
    },
    getDocumentLayerIds() {
      knownLayerSnapshotCount += 1;
      return {};
    },
    async moveLayerTo(layer, x, y) {
      const count = (moveCounts.get(layer.id) || 0) + 1;
      moveCounts.set(layer.id, count);
      if (options && options.maxTextMoves && layer.kind === "text" && count > options.maxTextMoves) {
        throw new Error("Photoshop rejected an extra text-layer move");
      }
      const width = layer.bounds.right - layer.bounds.left;
      const height = layer.bounds.bottom - layer.bounds.top;
      layer.bounds = { left: x, top: y, right: x + width, bottom: y + height };
      return layer.bounds;
    },
    async runNewLayerOperation(_document, operation, _label, knownLayerIds) {
      textKnownLayerIds.push(knownLayerIds);
      createdTextLayer = null;
      await operation();
      return createdTextLayer;
    }
  };

  const photoshop = {
    app: { activeDocument: targetDocument },
    core: {
      async executeAsModal(callback) {
        await callback();
      }
    },
    action: {
      async batchPlay(commands) {
        const command = commands[0];
        if(command && command._obj==='transform') {
          assert.ok([90,-90].includes(command.angle._value));
          const layer=targetDocument.layers.find(l=>l.id===command._target[0]._id);
          if(layer.visible===false) throw new Error('命令“变换”当前不可用');  // as Photoshop does for hidden layers
          const b=layer.bounds,w=b.right-b.left,h=b.bottom-b.top;
          layer.bounds={left:b.left,top:b.top,right:b.left+h,bottom:b.top+w};
          layer.rotated=command.angle._value;
          return [];
        }
        if (command && command._obj === "move" && command._target[0]._id) {
          const layerIndex = targetDocument.layers.findIndex((layer) => layer.id === command._target[0]._id);
          if (layerIndex === 0) throw new Error('Photoshop: move to front is unavailable for the first layer');
          const [layer] = targetDocument.layers.splice(layerIndex, 1);
          targetDocument.layers.unshift(layer);
          targetDocument.activeLayers = [layer];
          return [];
        }
        if (command && command._obj === "make" && command._target[0]._ref === "textLayer") {
          textCommands.push(command);
          const point = command.using.textClickPoint;
          const x = point.horizontal._value;
          const y = point.vertical._value;
          createdTextLayer = {
            id: nextLayerId++,
            kind: "text",
            bounds: { left: x, top: y, right: x + 240, bottom: y + 60 },
            async resize(widthPercent, heightPercent) {
              this.bounds.right = this.bounds.left + ((this.bounds.right - this.bounds.left) * widthPercent) / 100;
              this.bounds.bottom = this.bounds.top + ((this.bounds.bottom - this.bounds.top) * heightPercent) / 100;
            }
          };
          const activeIndex = targetDocument.layers.indexOf(targetDocument.activeLayers[0]);
          targetDocument.layers.splice(activeIndex < 0 ? 0 : activeIndex, 0, createdTextLayer);
          targetDocument.activeLayers = [createdTextLayer];
        }
        return [];
      }
    }
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.equal(name, "photoshop");
      return photoshop;
    },
    window: { IDPhotoLayerService: layerService }
  };
  const entryCode = { prepared: 0, drawn: [], calls: [] };
  if (options && options.entryCode) {
    context.window.IDPhotoEntryCodeService = {
      async prepare(prepareOptions) {
        if (options.entryCode === "broken") throw new Error("这版 Photoshop 不能直接画小程序码");
        entryCode.prepared += 1;
        entryCode.calls.push(prepareOptions || {});
        const o = prepareOptions || {}, own = !o.fallbackReason && o.allowExclusive !== false &&
          Boolean(o.entryLink && o.entryLink.link && o.entryLink.code === o.pickupCode);
        return { text: own ? o.entryLink.link : "https://mp.weixin.qq.com/a/test", custom: false, logo: null,
          exclusive: own, reason: own ? "" : o.fallbackReason || "没有专属链接" };
      },
      readsBack() { return options.entryCode !== "mismatch"; },
      async draw(doc, prepared, rect, drawOptions) {
        assert.equal(doc, targetDocument);
        const layer = { id: nextLayerId++, name: drawOptions.name,
          bounds: { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height } };
        targetDocument.layers.unshift(layer);
        targetDocument.activeLayers = [layer];
        entryCode.drawn.push({ variant: drawOptions.variant, turn: drawOptions.turn, rect });
        return layer;
      }
    };
  }
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/deliveryProtocol.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/pickupStripLayout.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/classicStripLayout.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: rendererPath });

  return {
    renderer: context.window.IDPhotoInfoBarRenderer,
    entryCode,
    sourceDocument,
    targetDocument,
    get activateCount() {
      return activateCount;
    },
    get knownLayerSnapshotCount() {
      return knownLayerSnapshotCount;
    },
    get textKnownLayerIds() {
      return textKnownLayerIds;
    },
    get textCommands() {
      return textCommands;
    },
    get duplicateCalls() {
      return duplicateCalls;
    }
  };
}

test("information bar text creation reuses one target layer id snapshot", async () => {
  const templates = loadTemplates();
  const template = templates.getTemplateByName("香港台湾 3.0x4.0");
  const harness = makeRendererHarness();

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "测试照相馆", shopPhone: "13000000000", shopTip: "请妥善保存" },
    { dateText: "2026.07.13", template, sourceDocument: harness.sourceDocument }
  );

  assert.equal(harness.knownLayerSnapshotCount, 1);
  assert.ok(harness.textKnownLayerIds.length > 1);
  assert.ok(harness.textKnownLayerIds.every((knownIds) => knownIds === harness.textKnownLayerIds[0]));
});

test("information bar avatar reuses a named photo layer from the target canvas", async () => {
  const templates = loadTemplates();
  const template = templates.getTemplateByName("1寸 2.7x3.8");
  const harness = makeRendererHarness();
  const placedPhoto = {
    id: 700,
    name: template.name + "_照片_1",
    bounds: { left: 0, top: 0, right: template.widthPx, bottom: template.heightPx }
  };
  const activeBackground = {
    id: 701,
    name: "信息条背景",
    bounds: { left: 0, top: 1950, right: 3592, bottom: 2400 }
  };
  harness.targetDocument.layers.unshift(activeBackground, placedPhoto);
  harness.targetDocument.activeLayers = [activeBackground];

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "测试照相馆", shopPhone: "13000000000", shopTip: "请妥善保存" },
    {
      dateText: "2026.07.13",
      template,
      sourceDocument: harness.targetDocument,
      sourceLayerName: placedPhoto.name
    }
  );

  assert.equal(harness.duplicateCalls[0].sourceDocument, harness.targetDocument);
  assert.equal(harness.duplicateCalls[0].sourceLayer, placedPhoto);
  assert.equal(harness.duplicateCalls[0].destinationDocument, harness.targetDocument);
  const backgroundIndex = harness.targetDocument.layers.indexOf(activeBackground);
  const avatarIndex = harness.targetDocument.layers.findIndex((layer) => layer.name === "信息条小头像");
  const textLayers = harness.targetDocument.layers.filter((layer) => layer.kind === "text");
  assert.ok(avatarIndex < backgroundIndex);
  assert.ok(textLayers.every((layer) => harness.targetDocument.layers.indexOf(layer) < backgroundIndex));
});

for (const templateName of ["香港台湾 3.0x4.0", "阿根廷 4.0x4.0"]) {
  test(`${templateName} places each one-inch style line with a single move`, async () => {
    const templates = loadTemplates();
    const template = templates.getTemplateByName(templateName);
    const harness = makeRendererHarness({ maxTextMoves: 2 });

    await harness.renderer.renderInfoBar(
      harness.targetDocument,
      template.infoBar,
      { shopName: "测试照相馆", shopPhone: "13000000000", shopTip: "请妥善保存" },
      { dateText: "2026.07.13", template, sourceDocument: harness.sourceDocument }
    );

    assert.equal(harness.activateCount, 0);
  });
}

for (const raw of loadTemplates().getAllTemplates()) {
  const template=loadTemplates().forDelivery(raw,true);
  for (const entryCode of [false,true,'broken']) test(template.id + ' renders the pickup card inside its band' + (entryCode===true?' with the code':entryCode?' when the code image is broken':''), async () => {
    const harness=makeRendererHarness({entryCode});
    const result=await harness.renderer.renderInfoBar(harness.targetDocument,template.infoBar,
      {shopName:'福清印象照相馆',shopPhone:'电话未填写'},
      {dateText:'2026.10.18',pickupCodeMode:true,pickupCode:'A2B3C4',template,sourceDocument:harness.sourceDocument});
    const text=harness.textCommands.map(c=>c.using.textKey), r=template.infoBar, shown=entryCode===true;
    assert.equal(result.entryCodeShown,shown);
    assert.ok(text.includes('A2B3C4'));
    assert.ok(text.some(t=>/取件码/.test(t)));
    assert.ok(text.some(t=>/7天内/.test(t)));
    assert.equal(text.some(t=>/扫/.test(t)),shown,template.id+' scan step only with a printed code');
    assert.deepEqual(harness.entryCode.drawn.map(d=>d.variant),shown?[r.codeVariant||'logo']:[]);
    if(shown) assert.equal(harness.entryCode.drawn[0].turn,r.orientation==='vertical'?'ccw':'',template.id+' code turns with the card');
    const code=harness.targetDocument.layers.filter(l=>l.name==='完整小程序码');
    assert.equal(code.length,shown?1:0);
    for(const layer of harness.targetDocument.layers) {
      const b=layer.bounds, box=layer.name==='完整小程序码'?{x:r.x-(r.orientation==='vertical'?r.codeReach||0:0),
        y:r.y-(r.orientation==='vertical'?0:r.codeReach||0),width:r.width+(r.codeReach||0),height:r.height+(r.codeReach||0)}:r;
      assert.ok(b.left>=box.x && b.top>=box.y && b.right<=box.x+box.width+0.001 && b.bottom<=box.y+box.height+0.001,template.id+' '+layer.name+' overflow');
      if(layer.name!=='完整小程序码') assert.equal(layer.rotated||0,r.orientation==='vertical'?-90:0,template.id+' heads point to the photos');
      else assert.equal(layer.rotated,undefined,'the code is drawn already turned');
      assert.notEqual(layer.visible,false,template.id+' '+layer.name+' visible once placed');
    }
    if(shown) { const b=code[0].bounds; assert.ok(Math.abs((b.right-b.left)-(b.bottom-b.top))<1 && b.right-b.left>=179,template.id+' code is a full square'); }
  });
}
test('invalid or missing code is rejected before any information-bar layers are created',async()=>{
  for(const pickupCode of ['', '123456', 'ABCDEF', 'I2B3C4', 'A2B3C4-stale']) {
    const template=loadTemplates().getTemplateById('one-inch'),harness=makeRendererHarness();
    await assert.rejects(harness.renderer.renderInfoBar(harness.targetDocument,template.infoBar,{},
      {pickupCodeMode:true,pickupCode,template,sourceDocument:harness.sourceDocument}),error=>error.code==='PICKUP_CODE_REQUIRED');
    assert.equal(harness.targetDocument.layers.length,0);
    assert.equal(harness.textCommands.length,0);
  }
});

test('ordinary mode never renders a pickup code, including one left in caller options',async()=>{
  for(const template of loadTemplates().getAllTemplates()) {
    const harness=makeRendererHarness();
    await harness.renderer.renderInfoBar(harness.targetDocument,template.infoBar,{},
      {pickupCodeMode:false,pickupCode:'A2B3C4',template,sourceDocument:harness.sourceDocument});
    assert.equal(harness.textCommands.some(c=>/取件码|待补码/.test(c.using.textKey)),false,template.id);
    assert.ok(harness.textCommands.some(c=>c.using.textKey.includes('电话未填写')),template.id);
  }
});

test("debug mode gives v5 layers unique DEBUG names", async () => {
  const templates = loadTemplates();
  const template = templates.forDelivery(templates.getTemplateById("standard-two-inch"),true);
  const harness = makeRendererHarness();

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "\u798f\u6e05\u5370\u8c61\u7167\u76f8\u9986", shopPhone: "13003825982" },
    { dateText: "2026. 1.", pickupCodeMode: true, pickupCode: "A2B3C4", template, sourceDocument: harness.sourceDocument, debugMode: true }
  );

  assert.deepEqual(
    harness.textCommands.map((command) => command.using.name),
    ["DEBUG_text_pickupLabel", "DEBUG_text_pickupCode", "DEBUG_text_date", "DEBUG_text_steps", "DEBUG_text_details"]
  );
});

test("every ordinary strip stays inside its bar, and vertical strips turn the whole block", async () => {
  const templates = loadTemplates();
  for (const raw of templates.getAllTemplates()) {
    const template = templates.forDelivery(raw, false);
    const bar = template.infoBar;
    const harness = makeRendererHarness();
    const result = await harness.renderer.renderInfoBar(harness.targetDocument, bar,
      { shopName: "福清印象照相馆", shopPhone: "13003825982" },
      { dateText: "2026.10.7", template, sourceDocument: harness.sourceDocument });
    assert.ok(result.createdCount >= 2, raw.id);
    const drawn = harness.targetDocument.layers.filter((layer) => layer.kind === "text" || layer.name === "信息条小头像");
    for (const layer of drawn) {
      const b = layer.bounds;
      assert.ok(b.left >= bar.x + 24 && b.top >= bar.y + 24 && b.right <= bar.x + bar.width - 24 && b.bottom <= bar.y + bar.height - 24,
        raw.id + " " + (layer.name || layer.id) + " " + JSON.stringify(b));
      assert.equal(Boolean(layer.rotated), bar.orientation === "vertical", raw.id);
    }
  }
});

// 10-28: the order's own code (delivery manager candidate 38).
const ORDER_LINK='https://mp.weixin.qq.com/a/~~WdSuO5i0uQ4~WhUnbj16GNTjF-XyoACd7A~~';
for (const raw of loadTemplates().getAllTemplates()) {
  const template=loadTemplates().forDelivery(raw,true);
  test(template.id+' prints the per-order code with its wording, and the store code when it does not read back',async()=>{
    const render=async(entryCode,entryLink)=>{
      const harness=makeRendererHarness({entryCode});
      const result=await harness.renderer.renderInfoBar(harness.targetDocument,template.infoBar,{shopName:'福清印象照相馆',shopPhone:'电话未填写'},
        {dateText:'2026.10.28',pickupCodeMode:true,pickupCode:'CKCJW7',entryLink,template,sourceDocument:harness.sourceDocument});
      return {harness,result,text:harness.textCommands.map(c=>c.using.textKey).join('|')};
    };
    const own=await render('exclusive',{code:'CKCJW7',link:ORDER_LINK,reason:''});
    assert.equal(own.result.entryCodeExclusive,true);assert.equal(own.harness.entryCode.drawn.length,1);
    assert.match(own.text,/扫码领取|直接领取/);assert.match(own.text,/“福清印象照相馆”/,'no scan: search the mini-program');assert.doesNotMatch(own.text,/保存照片/);
    assert.equal(own.harness.entryCode.calls[0].allowExclusive,true);assert.equal(own.harness.entryCode.calls[0].pickupCode,'CKCJW7');
    const mismatch=await render('mismatch',{code:'CKCJW7',link:ORDER_LINK,reason:''});
    assert.equal(mismatch.result.entryCodeExclusive,false);assert.equal(mismatch.result.entryCodeReason,'专属码回读和链接不一致');
    assert.equal(mismatch.harness.entryCode.calls[1].fallbackReason,'专属码回读和链接不一致');
    assert.equal(mismatch.harness.entryCode.drawn.length,1,'one code is drawn: the store code');
    assert.doesNotMatch(mismatch.text,/直接领取|“福清印象照相馆”/);assert.match(mismatch.text,/输入/);
    const other=await render('exclusive',{code:'A2B3C4',link:ORDER_LINK,reason:''});
    assert.equal(other.result.entryCodeExclusive,false,'a link for another code is never used');
    assert.doesNotMatch(other.text,/直接领取|“福清印象照相馆”/);
  });
}

function makeImagingRendererHarness(options = {}) {
  let nextLayerId = 1;
  let createdTextLayer = null;
  let deletedPixelLayers = 0;
  let modalDepth = 0;
  const textKnownLayerIds = [];
  const textCommands = [];
  const duplicateCalls = [];
  const getPixelsCalls = [];
  const putPixelsCalls = [];
  const disposed = [];
  let sourceSizePx = options.sourceSize || { width: 600, height: 900 };

  const targetDocument = {
    id: 200,
    width: 3600,
    height: 2400,
    layers: [],
    activeLayers: [],
    async activate() {},
    async createLayer(kind, layerOptions) {
      assert.equal(kind, "pixel");
      const layer = {
        id: nextLayerId++,
        kind: "pixel",
        name: layerOptions && layerOptions.name,
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
        async delete() {
          assert.ok(modalDepth > 0, "infoBar pixel delete must run inside executeAsModal");
          deletedPixelLayers += 1;
          const idx = targetDocument.layers.indexOf(this);
          if (idx >= 0) targetDocument.layers.splice(idx, 1);
        }
      };
      targetDocument.layers.unshift(layer);
      targetDocument.activeLayers = [layer];
      return layer;
    }
  };
  const sourceLayer = {
    id: 900,
    bounds: { left: 0, top: 0, right: sourceSizePx.width, bottom: sourceSizePx.height }
  };
  const sourceDocument = {
    id: 100,
    width: sourceSizePx.width,
    height: sourceSizePx.height,
    layers: [sourceLayer],
    activeLayers: [sourceLayer]
  };

  const photoshop = {
    app: { activeDocument: targetDocument },
    core: { async executeAsModal(callback) { modalDepth += 1; try { await callback(); } finally { modalDepth -= 1; } } },
    imaging: {
      async getPixels(opts) {
        getPixelsCalls.push(opts);
        const w = opts.targetSize.width;
        const h = opts.targetSize.height;
        const buf = new Uint8Array(w * h * 3);
        buf.fill(180);
        // Mark 4 corners distinctly so rotation orientation can be checked deterministically.
        const setPx = (x, y, r, g, b) => {
          const off = (y * w + x) * 3;
          buf[off] = r; buf[off + 1] = g; buf[off + 2] = b;
        };
        setPx(0, 0, 11, 22, 33);         // src top-left
        setPx(w - 1, 0, 44, 55, 66);     // src top-right
        setPx(0, h - 1, 77, 88, 99);     // src bottom-left
        setPx(w - 1, h - 1, 111, 122, 133); // src bottom-right
        return {
          imageData: {
            width: w,
            height: h,
            components: 3,
            async getData() { return buf; },
            dispose() { disposed.push("src"); }
          }
        };
      },
      async createImageDataFromBuffer(buffer, opts) {
        return {
          width: opts.width,
          height: opts.height,
          components: opts.components,
          colorProfile: opts.colorProfile,
          _buffer: new Uint8Array(buffer),
          dispose() { disposed.push("out"); }
        };
      },
      async putPixels(opts) {
        if (options.failPutPixels) throw new Error("portrait putPixels failure");
        putPixelsCalls.push(opts);
        const layer = targetDocument.layers.find((item) => item.id === opts.layerID);
        if (layer) {
          layer.bounds = {
            left: opts.targetBounds.left,
            top: opts.targetBounds.top,
            right: opts.targetBounds.left + opts.imageData.width,
            bottom: opts.targetBounds.top + opts.imageData.height
          };
        }
      }
    },
    action: {
      async batchPlay(commands) {
        const command = commands[0];
        if (command && command._obj === "transform") {
          const layer = targetDocument.layers.find((l) => l.id === command._target[0]._id);
          const b = layer.bounds, w = b.right - b.left, h = b.bottom - b.top;
          layer.bounds = { left: b.left, top: b.top, right: b.left + h, bottom: b.top + w };
          layer.rotated = command.angle._value;
          return [];
        }
        if (command && command._obj === "move" && command._target[0]._id) {
          const idx = targetDocument.layers.findIndex((l) => l.id === command._target[0]._id);
          if (idx === 0) throw new Error("already at front");
          const [layer] = targetDocument.layers.splice(idx, 1);
          targetDocument.layers.unshift(layer);
          targetDocument.activeLayers = [layer];
          return [];
        }
        if (command && command._obj === "make" && command._target[0]._ref === "textLayer") {
          textCommands.push(command);
          const pt = command.using.textClickPoint;
          const x = pt.horizontal._value, y = pt.vertical._value;
          createdTextLayer = {
            id: nextLayerId++,
            kind: "text",
            bounds: { left: x, top: y, right: x + 120, bottom: y + 40 },
            async resize(wp, hp) {
              this.bounds.right = this.bounds.left + ((this.bounds.right - this.bounds.left) * wp) / 100;
              this.bounds.bottom = this.bounds.top + ((this.bounds.bottom - this.bounds.top) * hp) / 100;
            }
          };
          targetDocument.layers.unshift(createdTextLayer);
          targetDocument.activeLayers = [createdTextLayer];
        }
        return [];
      }
    }
  };

  const context = {
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.equal(name, "photoshop");
      return photoshop;
    },
    window: {}
  };
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/photoshop/layerService.js"), "utf8"), context);
  const realLayerService = context.window.IDPhotoLayerService;
  context.window.IDPhotoLayerService = {
    stampPhotoIntoBuffer: realLayerService.stampPhotoIntoBuffer,
    async duplicateLayerToDocument(srcDoc, _srcLayer, dstDoc) {
      duplicateCalls.push({ srcDoc, dstDoc });
      const layer = {
        id: nextLayerId++,
        bounds: { left: 0, top: 0, right: sourceSizePx.width, bottom: sourceSizePx.height },
        async resize(percent) {
          this.bounds.right = this.bounds.left + ((this.bounds.right - this.bounds.left) * percent) / 100;
          this.bounds.bottom = this.bounds.top + ((this.bounds.bottom - this.bounds.top) * percent) / 100;
        }
      };
      dstDoc.layers.unshift(layer);
      dstDoc.activeLayers = [layer];
      return layer;
    },
    findLayerByName: realLayerService.findLayerByName,
    getLayerBounds: (layer) => layer.bounds,
    getDocumentLayerIds: () => ({}),
    async moveLayerTo(layer, x, y) {
      const w = layer.bounds.right - layer.bounds.left;
      const h = layer.bounds.bottom - layer.bounds.top;
      layer.bounds = { left: x, top: y, right: x + w, bottom: y + h };
      return layer.bounds;
    },
    async runNewLayerOperation(_doc, op, _lbl, knownIds) {
      textKnownLayerIds.push(knownIds);
      createdTextLayer = null;
      await op();
      return createdTextLayer;
    }
  };
  context.window.IDPhotoEntryCodeService = {
    async prepare() { return { text: "https://mp.weixin.qq.com/a/test", custom: false, logo: null, exclusive: false, reason: "" }; },
    readsBack() { return true; },
    async draw(doc, _prep, rect, opts) {
      const layer = { id: nextLayerId++, name: opts.name, bounds: { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height } };
      doc.layers.unshift(layer);
      doc.activeLayers = [layer];
      return layer;
    }
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/deliveryProtocol.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/pickupStripLayout.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/classicStripLayout.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: rendererPath });

  return {
    renderer: context.window.IDPhotoInfoBarRenderer,
    sourceDocument,
    targetDocument,
    duplicateCalls,
    getPixelsCalls,
    putPixelsCalls,
    disposed,
    get deletedPixelLayers() { return deletedPixelLayers; }
  };
}

test("renderPickupStrip draws vertical (-90 CCW) and horizontal (0) portraits via imaging without duplicating layers", async () => {
  const templates = loadTemplates();
  for (const [templateId, expectedAngle] of [["standard-two-inch", -90], ["one-inch", 0]]) {
    const template = templates.forDelivery(templates.getTemplateById(templateId), true);
    const harness = makeImagingRendererHarness();
    const res = await harness.renderer.renderInfoBar(
      harness.targetDocument,
      template.infoBar,
      { shopName: "福清印象照相馆", shopPhone: "13003825982" },
      {
        dateText: "2026.11.22",
        pickupCodeMode: true,
        pickupCode: "A2B3C4",
        template,
        sourceDocument: harness.sourceDocument,
        sourceSize: { width: 600, height: 900 }
      }
    );
    assert.equal(res.ok, true, templateId);
    assert.equal(harness.duplicateCalls.length, 0, templateId + " should avoid DOM duplicateLayer");
    assert.equal(harness.getPixelsCalls.length, 1);
    assert.equal(harness.getPixelsCalls[0].colorProfile, "sRGB IEC61966-2.1");
    assert.equal(harness.getPixelsCalls[0].applyAlpha, false);
    assert.equal(harness.putPixelsCalls.length, 1);
    assert.deepEqual(harness.disposed, ["src", "out"]);
    const img = harness.putPixelsCalls[0].imageData;
    const px = (x, y) => {
      const off = (y * img.width + x) * 3;
      return [img._buffer[off], img._buffer[off + 1], img._buffer[off + 2]];
    };
    if (expectedAngle === -90) {
      // -90 CCW: src top-left (0,0) -> dst bottom-left (0, img.height-1); src top-right -> dst top-left (0,0)
      assert.deepEqual(px(0, img.height - 1), [11, 22, 33]);
      assert.deepEqual(px(0, 0), [44, 55, 66]);
    } else {
      assert.deepEqual(px(0, 0), [11, 22, 33]);
      assert.deepEqual(px(img.width - 1, img.height - 1), [111, 122, 133]);
    }
  }
});

test("renderClassicStrip draws vertical (+90 CW) and horizontal (0) portraits via imaging without duplicating layers", async () => {
  const templates = loadTemplates();
  for (const [templateId, vertical] of [["standard-two-inch", true], ["one-inch", false]]) {
    const template = templates.forDelivery(templates.getTemplateById(templateId), false);
    const harness = makeImagingRendererHarness();
    const res = await harness.renderer.renderInfoBar(
      harness.targetDocument,
      template.infoBar,
      { shopName: "福清印象照相馆", shopPhone: "13003825982" },
      {
        dateText: "2026.11.22",
        pickupCodeMode: false,
        template,
        sourceDocument: harness.sourceDocument,
        sourceSize: { width: 600, height: 900 }
      }
    );
    assert.equal(res.ok, true, templateId);
    assert.equal(harness.duplicateCalls.length, 0);
    assert.equal(harness.getPixelsCalls.length, 1);
    assert.equal(harness.putPixelsCalls.length, 1);
    assert.deepEqual(harness.disposed, ["src", "out"]);
    const img = harness.putPixelsCalls[0].imageData;
    const px = (x, y) => {
      const off = (y * img.width + x) * 3;
      return [img._buffer[off], img._buffer[off + 1], img._buffer[off + 2]];
    };
    if (vertical) {
      // +90 CW: src top-left (0,0) -> dst top-right (img.width-1, 0); src bottom-left -> dst top-left (0,0)
      assert.deepEqual(px(img.width - 1, 0), [11, 22, 33]);
      assert.deepEqual(px(0, 0), [77, 88, 99]);
    } else {
      assert.deepEqual(px(0, 0), [11, 22, 33]);
      assert.deepEqual(px(img.width - 1, 0), [44, 55, 66]);
    }
  }
});

test("imaging portrait respects debugMode=true and falls back cleanly on putPixels error (deleting orphan layer)", async () => {
  const templates = loadTemplates();
  const template = templates.forDelivery(templates.getTemplateById("one-inch"), true);

  // debugMode: skips imaging, runs DOM duplicate
  const debugHarness = makeImagingRendererHarness();
  await debugHarness.renderer.renderInfoBar(
    debugHarness.targetDocument,
    template.infoBar,
    { shopName: "福清印象照相馆", shopPhone: "13003825982" },
    {
      dateText: "2026.11.22",
      pickupCodeMode: true,
      pickupCode: "A2B3C4",
      template,
      sourceDocument: debugHarness.sourceDocument,
      sourceSize: { width: 600, height: 900 },
      debugMode: true
    }
  );
  assert.equal(debugHarness.getPixelsCalls.length, 0);
  assert.equal(debugHarness.duplicateCalls.length, 1);

  // putPixels fails: deletes empty pixel layer, disposes buffers, falls back to DOM duplicate
  const failHarness = makeImagingRendererHarness({ failPutPixels: true });
  const res = await failHarness.renderer.renderInfoBar(
    failHarness.targetDocument,
    template.infoBar,
    { shopName: "福清印象照相馆", shopPhone: "13003825982" },
    {
      dateText: "2026.11.22",
      pickupCodeMode: true,
      pickupCode: "A2B3C4",
      template,
      sourceDocument: failHarness.sourceDocument,
      sourceSize: { width: 600, height: 900 }
    }
  );
  assert.equal(res.ok, true);
  assert.equal(failHarness.deletedPixelLayers, 1);
  assert.deepEqual(failHarness.disposed, ["src", "out"]);
  assert.equal(failHarness.duplicateCalls.length, 1);
});
