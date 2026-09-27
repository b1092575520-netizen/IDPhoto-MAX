const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(options = {}) {
  const files = new Map(), memory = new Map(), closed = [], renders = [], canvases = [];
  let window, clock = 0, sequence = 20, active = null;
  class Entry {
    constructor(name, parent, folder = true) { this.name = name; this.parent = parent; this.isFolder = folder; this.nativePath = parent ? parent.nativePath + '/' + name : name; this.children = new Map(); }
    async createFolder(name) { if (this.children.has(name)) throw Error('Folder exists'); const e = new Entry(name, this); this.children.set(name,e); return e; }
    async createFile(name, opts) { if(this.children.has(name) && !opts.overwrite) throw Error('File exists'); const e = new Entry(name,this,false); this.children.set(name,e); return e; }
    async getEntry(name) {
      if(name === 'code-response.json' && options.receipt !== false) {
        const confirmation = JSON.parse(await (await this.getEntry('code-request.json')).read());
        const request = await this.getEntry('request.json'), context = JSON.parse(await (await this.getEntry('context.json')).read());
        return {read:async()=>JSON.stringify({version:2,requestId:options.staleNonce?'old-request':confirmation.requestId,confirmed:options.denied!==true,contextKey:options.foreignContext?'ctx-other':'ctx-test',status:options.terminal||'preparing',accepted:true,taskId:options.foreignReceipt?'other':context.id,manifestFingerprint:window.IDPhotoDeliveryProtocol.sha256(await request.read()),deliveryId:'remote-'+context.id,code:options.changedDuringRender&&renders.length>1?'N7EW8A':'T2EST4'})};
      }
      if(!this.children.has(name))throw Error('Missing '+name); return this.children.get(name);
    }
    async write(value) { this.value=value; files.set(this.nativePath,value); }
    async read() { return this.value; }
    async moveTo(folder, options) { this.parent.children.delete(this.name); this.name=options.newName; this.parent=folder; folder.children.set(this.name,this); }
  }
  const root = new Entry('local');
  const pixels = new Uint8Array([255,216,3,4,5,6,255,217]).buffer;
  function doc(width,height) { const d={id:++sequence,width,height,saveAs:{jpg:async(file,opts)=>{
    if(!options.multi)return file.write(pixels);
    const data=new Uint8Array(500+opts.quality*100);data.set([255,216,255,192,0,11,8,d.height>>8,d.height&255,d.width>>8,d.width&255,1,1,17,0,255,218]);data[data.length-2]=255;data[data.length-1]=217;await file.write(data.buffer);
  }},crop:async()=>{},resizeImage:async(w,h)=>{d.width=w;d.height=h;},duplicate:async()=>doc(d.width,d.height)}; return d; }
  const photo=doc(3000,4000), original=doc(3000,4000);
  const app={documents:[],open:async()=>photo,get activeDocument(){return active},set activeDocument(d){active=d}};
  app.documents.add=async({width,height,name})=>{const d=doc(width,height);d.name=name;canvases.push(d);app.documents.push(d);return d;};
  const filesystem={getDataFolder:async()=>root,createPersistentToken:async entry=>{files.set(entry.nativePath,entry);return entry.nativePath;},getEntryForPersistentToken:async token=>files.get(token)};
  window={localStorage:{getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},
    IDPhotoSourceEligibilityService:{checkSource:()=>({eligible:true})},
    IDPhotoPathService:{getDateFolders:()=>({year:'2026',month:'2026-09',day:'2026-09-27'})},
    IDPhotoDateService:{formatDisplayDate:()=> '2026.9.27'},
    IDPhotoPhotoshopExecution:{executeAsModal:async cb=>cb(),activateDocument:async d=>{active=d},getPhotoshop:()=>({app}),resolveCreatedDocument:(ids,expected)=>{const d=app.documents.filter(d=>!ids.includes(d.id));assert.equal(d.length,1);assert.equal(d[0].name,expected.name);return d[0];}},
    IDPhotoDocumentService:{closeWithoutSaving:async d=>{closed.push(d.id)}},
    IDPhotoCropService:{prepareSinglePhoto:async(d,info,shape,ratio,opts)=>{assert.equal(d,original);assert.equal(opts.preservePixels,true);return {document:photo};}},
    IDPhotoTemplates:{getTemplateById:()=>({infoBar:{x:0,y:100,width:1653,height:555,avatar:{x:20,y:120},texts:[{x:100,y:140}]}})},
    IDPhotoInfoBarRenderer:{renderInfoBar:async(d,bar,settings,opts)=>{renders.push({id:d.id,source:opts.sourceDocument.id,code:opts.pickupCode});if(options.renderFail)throw 'injected Photoshop failure';}},
  };
  class Clock extends Date { static now(){clock+=1500;return clock;} }
  const context=vm.createContext({window,console,Date:Clock,setTimeout:fn=>{fn();},require:name=>{assert.equal(name,'uxp');return {storage:{localFileSystem:filesystem,formats:{binary:'binary',utf8:'utf8'}}};}});
  for(const file of ['core/deliveryProtocol','core/deliverySpecifications','photoshop/deliveryService'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file+'.js'),'utf8'),context);
  return {options,service:window.IDPhotoDeliveryService,original,photo,files,closed,renders,canvases,info:{id:original.id,name:'test',widthPx:3000,heightPx:4000,sourceMetadata:{}}};
}
test('electronic delivery binds original pixels, completion and code; info failure stays independent and records string errors',async()=>{
  for(const renderFail of [false,true]) {
    const h=harness({renderFail}), task=await h.service.electronic(h.original,h.info,{});
    const request=JSON.parse(await(await task.folder.getEntry('request.json')).read());
    const completion=JSON.parse(await(await task.folder.getEntry('complete.json')).read());
    assert.equal(request.sourceDocumentId,String(h.original.id));assert.equal(request.mode,'electronic');
    assert.deepEqual([request.files[0].width,request.files[0].height],[3000,4000]);
    assert.equal(completion.manifestFingerprint,task.fingerprint);assert.ok(completion.processingComplete);
    assert.equal(completion.artifacts.some(f=>f.role==='layout'),false);
    assert.equal(task.status.info,renderFail?'failed':'saved');
    if(renderFail)assert.equal(task.status.infoError,'injected Photoshop failure');
    assert.equal(h.closed.includes(h.original.id),false);assert.ok(h.closed.includes(h.photo.id));
    assert.equal(h.renders[0].source,h.photo.id);assert.equal(h.renders[0].code,'T2EST4');
  }
});
test('late or foreign receipts never borrow a code; unavailable receipt still preserves valid electronic completion',async()=>{
  for(const options of [{receipt:false},{foreignReceipt:true}]) {
    const h=harness(options),task=await h.service.electronic(h.original,h.info,{});
    assert.equal(task.code,'');assert.equal(task.status.codeState,'pending');
    assert.equal(h.renders[0].code,'');assert.equal(JSON.parse(await(await task.folder.getEntry('complete.json')).read()).processingComplete,true);
  }
});
test('regeneration preserves original task/complete signal and selects that photo; tampered photo is rejected',async()=>{
  const h=harness(),task=await h.service.electronic(h.original,h.info,{});
  const completion=await(await task.folder.getEntry('complete.json')).read();
  const output=await h.service.regenerate(task.folder);
  assert.match(output,/info-[a-f0-9]{32}\.jpg$/);assert.equal(await(await task.folder.getEntry('complete.json')).read(),completion);
  const status=JSON.parse(await(await task.folder.getEntry('plugin-status.json')).read());
  assert.equal(status.processing,'complete');assert.equal(status.taskId,task.id);assert.equal(status.info,'saved');
  const extra=JSON.parse(await(await task.folder.getEntry('supplements.json')).read());
  assert.equal(extra.taskId,task.id);assert.equal(extra.manifestFingerprint,task.fingerprint);
  assert.equal(extra.artifacts.length,1);assert.equal(extra.artifacts[0].role,'info');
  assert.ok(output.endsWith(extra.artifacts[0].path));
  await h.service.regenerate(task.folder);
  assert.equal(JSON.parse(await(await task.folder.getEntry('supplements.json')).read()).artifacts.length,2);
  assert.equal(await(await task.folder.getEntry('complete.json')).read(),completion);
  await(await task.folder.getEntry('photo.jpg')).write(new Uint8Array([9]).buffer);
  await assert.rejects(h.service.regenerate(task.folder),/成片已变化/);
});

test('regeneration refuses cached, terminal, failed and cross-connection confirmations; never creates supplement',async()=>{
 for(const change of [{receipt:false},{staleNonce:true},{terminal:'cancelled'},{terminal:'withdrawn'},{denied:true},{foreignContext:true}]){
  const h=harness(),task=await h.service.electronic(h.original,h.info,{});Object.assign(h.options,change);
  await assert.rejects(h.service.regenerate(task.folder),/待核对/);
  assert.equal(h.renders.length,1);await assert.rejects(task.folder.getEntry('supplements.json'));
 }
});
test('management during rendering refuses export when the new confirmation has a different code',async()=>{
 const h=harness(),task=await h.service.electronic(h.original,h.info,{});h.options.changedDuringRender=true;
 await assert.rejects(h.service.regenerate(task.folder),/状态变化/);
 await assert.rejects(task.folder.getEntry('supplements.json'));assert.equal(h.closed.includes(h.original.id),false);
});


test('multi export uses independent real-dimension encodes and v2 durable unconfirmed draft',async()=>{
 const h=harness({multi:true}),task=await h.service.multi(h.original,h.info,{},[{filename:'高清蓝底.jpg',purpose:'明确用途',background:'蓝底'},{filename:'报名名称.jpg',width:300,height:400,maxBytes:1400,minQuality:8}]);
 const request=JSON.parse(await(await task.folder.getEntry('request.json')).read());
 assert.equal(request.version,2);assert.equal(request.files.length,2);assert.equal(request.files[1].filename,'报名名称.jpg');assert.equal(request.files[1].width,300);assert.equal(request.files[1].height,400);assert.equal(request.files[1].sizeBytes,1400);assert.equal(request.files[1].encodedQuality,9);
 assert.equal(task.status.processing,'draft');assert.equal(h.original.width,3000);assert.equal(h.original.height,4000);assert.equal(h.closed.includes(h.original.id),false);assert.equal(h.renders.length,0);
 await task.folder.getEntry('source-preserved.jpg');await assert.rejects(task.folder.getEntry('code-request.json'));
 assert.ok(JSON.parse(await(await task.folder.getEntry('complete.json')).read()).processingComplete);
 const output=await h.service.regenerate(task.folder);assert.match(output,/info-/);
});

test('multi rejects impossible bytes, upscaling, changed ratio and duplicate paths without publishing',async()=>{
 for(const spec of [{filename:'a.jpg',width:6000,height:8000},{filename:'a.jpg',width:300,height:300}]){const h=harness({multi:true});await assert.rejects(h.service.multi(h.original,h.info,{},[spec]));assert.equal(h.closed.includes(h.original.id),false);}
 const h=harness({multi:true});await assert.rejects(h.service.multi(h.original,h.info,{},[{filename:'a.jpg',maxBytes:100,minQuality:10}]),/无法生成/);const task=h.service.latest();await assert.rejects(task.folder.getEntry('request.json'));await assert.rejects(task.folder.getEntry('complete.json'));await task.folder.getEntry('source-preserved.jpg');assert.equal(task.status.processing,'failed');
});

test('multi explicit target binds only this request and never sticks to the following customer',async()=>{
 const h=harness({multi:true}),target={version:1,deliveryId:'a'.repeat(64),contextKey:'b'.repeat(64),groupVersion:3,code:'T2EST4',title:'明确同行'};
 const task=await h.service.multi(h.original,h.info,{},[{filename:'new.jpg'}],target),request=JSON.parse(await(await task.folder.getEntry('request.json')).read());assert.equal(request.newMember,true);assert.equal(request.targetDeliveryId,target.deliveryId);
 const next=await h.service.multi(h.original,h.info,{},[{filename:'next.jpg'}]);assert.equal(JSON.parse(await(await next.folder.getEntry('request.json')).read()).targetDeliveryId,undefined);
});
