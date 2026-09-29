const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(options = {}) {
  const files = new Map(), memory = new Map(), closed = [], renders = [], canvases = [];
  let window, clock = 0, sequence = 20, active = null, modalDepth = 0;
  class Entry {
    constructor(name, parent, folder = true) { this.name = name; this.parent = parent; this.isFolder = folder; this.nativePath = parent ? parent.nativePath + '/' + name : name; this.children = new Map(); }
    async createFolder(name) { if (this.children.has(name)) throw Error('Folder exists'); const e = new Entry(name, this); this.children.set(name,e); return e; }
    async getEntries() { return [...this.children.values()]; }
    async createFile(name, opts) { if(this.children.has(name) && !opts.overwrite) throw Error('File exists'); const e = new Entry(name,this,false); this.children.set(name,e); return e; }
    async getEntry(name) {
      if (name === 'connection-response.json' || name === 'code-response.json') assert.equal(modalDepth, 0, 'Never wait for backend inside Photoshop modal execution');
      if (name === 'connection-response.json' && options.connection !== false) {
        const request = JSON.parse(await (await this.getEntry('connection-request.json')).read());
        return { read: async () => JSON.stringify({ version: 1, requestId: options.staleConnection ? 'old' : request.requestId,
          protocol: options.connectionProtocol || request.protocol, sourceRoot: options.wrongConnectionRoot ? 'elsewhere' : this.nativePath,
          consumerId: options.consumerId || 'test-consumer', sourceIdentity: options.sourceIdentity || 'test-directory', state: options.connectionState || 'running',
          ready: !options.connectionState, cloudChecked: false }) };
      }
      if(name === 'code-response.json' && options.receipt !== false) {
        const confirmation = JSON.parse(await (await this.getEntry('code-request.json')).read());
        const request = await this.getEntry('request.json'), context = JSON.parse(await (await this.getEntry('context.json')).read());
        return {read:async()=>{ clock += options.replyDelay || 0; return JSON.stringify({version:2,requestId:options.staleNonce?'old-request':confirmation.requestId,confirmed:options.denied!==true,contextKey:options.foreignContext?'ctx-other':options.contextKey||'ctx-test',status:options.terminal||'preparing',accepted:true,taskId:options.foreignReceipt?'other':context.id,manifestFingerprint:window.IDPhotoDeliveryProtocol.sha256(await request.read()),deliveryId:options.deliveryId||'remote-'+context.id,errorCode:options.errorCode||'',code:options.invalidCode?'123456':options.changedDuringRender&&renders.length>1?'N7EW8A':'T2EST4'});}};
      }
      if(!this.children.has(name))throw Error('Missing '+name); return this.children.get(name);
    }
    async write(value) {
      if(options.requestWriteFail && this.name.startsWith('request.json.'))throw Error('request disk failure');
      if(options.statusWriteFail && this.name.startsWith('plugin-status.json.') && JSON.parse(value).processing==='blocked-code') throw Error('status disk failure');
      this.value=value; files.set(this.nativePath,value);
    }
    async read() { return this.value; }
    async moveTo(folder, options) {
      if (options.overwrite === false && folder.children.has(options.newName)) throw Error('Destination exists');
      files.delete(this.nativePath); this.parent.children.delete(this.name); this.name=options.newName; this.parent=folder;
      this.nativePath=folder.nativePath+'/'+this.name; folder.children.set(this.name,this); files.set(this.nativePath,this.value);
    }
    async delete() { this.parent.children.delete(this.name); files.delete(this.nativePath); }
  }
  const root = new Entry('local');
  const pixels = new Uint8Array([255,216,3,4,5,6,255,217]).buffer;
  function doc(width,height) { const d={id:++sequence,width,height,saveAs:{jpg:async(file,opts)=>{
    if(!options.multi)return file.write(pixels);
    const data=new Uint8Array(500+opts.quality*100);data.set([255,216,255,192,0,11,8,d.height>>8,d.height&255,d.width>>8,d.width&255,1,1,17,0,255,218]);data[data.length-2]=255;data[data.length-1]=217;await file.write(data.buffer);
  }},crop:async()=>{},resizeImage:async(w,h)=>{d.width=w;d.height=h;},duplicate:async()=>doc(d.width,d.height)}; return d; }
  const photo=doc(3000,4000), original=doc(3000,4000);
  const app={documents:[],open:async()=>{const d=doc(3000,4000);app.documents.push(d);return d;},get activeDocument(){return active},set activeDocument(d){active=d}};
  app.documents.add=async({width,height,name})=>{const d=doc(width,height);d.name=name;canvases.push(d);app.documents.push(d);return d;};
  const filesystem={getDataFolder:async()=>root,createPersistentToken:async entry=>{files.set(entry.nativePath,entry);return entry.nativePath;},getEntryForPersistentToken:async token=>files.get(token)};
  window={localStorage:{getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},
    IDPhotoSourceEligibilityService:{checkSource:()=>({eligible:true})},
    IDPhotoPathService:{getDateFolders:()=>({year:'2026',month:'2026-09',day:'2026-09-27'})},
    IDPhotoDateService:{formatDisplayDate:()=> '2026.9.27'},
    IDPhotoPhotoshopExecution:{executeAsModal:async cb=>{modalDepth++;try{return await cb();}finally{modalDepth--;}},activateDocument:async d=>{active=d},getPhotoshop:()=>({app}),resolveCreatedDocument:(ids,expected)=>{const d=app.documents.filter(d=>!ids.includes(d.id));assert.equal(d.length,1);assert.equal(d[0].name,expected.name);return d[0];}},
    IDPhotoDocumentService:{closeWithoutSaving:async d=>{closed.push(d.id);if(options.cleanupFail&&d===photo)throw Error('close failure');}},
    IDPhotoCropService:{prepareSinglePhoto:async(d,info,shape,ratio,opts)=>{assert.equal(d,original);assert.equal(opts.preservePixels,true);return {document:photo};}},
    IDPhotoTemplates:{getTemplateById:()=>({infoBar:{x:0,y:100,width:1653,height:555,avatar:{x:20,y:120},texts:[{x:100,y:140}]}})},
    IDPhotoSettingsStore:{load:()=>({})},
    IDPhotoInfoBarRenderer:{renderInfoBar:async(d,bar,settings,opts)=>{renders.push({id:d.id,source:opts.sourceDocument.id,code:opts.pickupCode,mode:opts.pickupCodeMode,date:opts.dateText});if(options.renderFail)throw 'injected Photoshop failure';return {ok:true,createdCount:1,message:'rendered'};}},
  };
  class Clock extends Date { static now(){clock+=1500;return clock;} }
  const context=vm.createContext({window,console,Date:Clock,setTimeout:fn=>{if(options.onSleep)options.onSleep(window.IDPhotoDeliveryService);fn();},require:name=>{assert.equal(name,'uxp');return {storage:{localFileSystem:filesystem,formats:{binary:'binary',utf8:'utf8'}}};}});
  for(const file of ['core/sourceEligibilityService','core/deliveryProtocol','core/deliverySpecifications','photoshop/deliveryService'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file+'.js'),'utf8'),context);
  window.IDPhotoSourceEligibilityService.checkSource = () => ({ eligible: options.eligible !== false });
  const reload=()=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/photoshop/deliveryService.js'),'utf8'),context);
  const taskCount=()=>{let count=0;function walk(entry){if(entry.children.has('context.json'))count++;for(const child of entry.children.values())if(child.isFolder)walk(child);}walk(root);return count;};
  const loadWorkflow=()=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core/layoutWorkflow.js'),'utf8'),context);
  return {options,get service(){return window.IDPhotoDeliveryService;},reload,loadWorkflow,taskCount,window,doc,app,original,photo,files,closed,renders,canvases,info:{id:original.id,name:'test',widthPx:3000,heightPx:4000,sourceMetadata:{}}};
}
test('timeout and reload retain one immutable logical task; explicit electronic retry confirms a new attempt without new delivery', async () => {
  const h=harness({receipt:false});
  await assert.rejects(h.service.electronic(h.original,h.info,{}),/超时/);
  const task=h.service.latest(), payload=await(await task.folder.getEntry('request.json')).read();
  const previousAttempt=JSON.parse(await(await task.folder.getEntry('code-request.json')).read()).requestId;
  await assert.rejects(h.service.electronic(h.original,h.info,{}),/尚未完成/);
  assert.equal(h.taskCount(),1);
  h.reload();
  assert.equal((await h.service.pending()).id,task.id);
  await assert.rejects(h.service.electronic(h.original,h.info,{}),/尚未完成/);
  h.options.receipt=true;
  const restored=await h.service.retryPending(task.id);
  assert.equal(restored.id,task.id);assert.equal(h.taskCount(),1);
  assert.equal(await(await task.folder.getEntry('request.json')).read(),payload);
  assert.notEqual(JSON.parse(await(await task.folder.getEntry('code-request.json')).read()).requestId,previousAttempt);
  assert.equal(restored.completionWritten,true);assert.equal(await h.service.pending(),null);
  assert.equal(h.renders.length,1);assert.equal(h.closed.includes(h.original.id),false);
  assert.equal([...h.files.keys()].some(key=>/delivery-retry-temporary\/retry-.*\.jpg$/.test(key)),false);
  await assert.rejects(h.service.retryPending(task.id),/已改变或已有完成/);
  assert.equal(h.renders.length,1,'completed retry must not print/render twice');
});

test('a failed request write resumes the same independently verified prepared photo, without recropping or replacing task identity', async () => {
  const h=harness({requestWriteFail:true});
  await assert.rejects(h.service.electronic(h.original,h.info,{}),/request disk failure/);
  const task=h.service.latest();
  await assert.rejects(task.folder.getEntry('request.json'));
  await task.folder.getEntry('photo-prepared.json');
  h.options.requestWriteFail=false;h.reload();
  const restored=await h.service.retryPending(task.id);
  assert.equal(restored.id,task.id);assert.equal(h.taskCount(),1);assert.equal(h.renders.length,1);
  assert.equal(restored.completionWritten,true);
});

test('retry refuses changed photo, changed snapshot, consumer, directory identity, or prior output; no completion is invented', async () => {
  for (const failure of ['photo','context','consumer','directory','output']) {
    const h=harness({receipt:false});
    await assert.rejects(h.service.electronic(h.original,h.info,{}));
    const task=h.service.latest();h.options.receipt=true;
    if(failure==='photo')await(await task.folder.getEntry('photo.jpg')).write(new Uint8Array([9]).buffer);
    if(failure==='context'){
      const contextFile=await task.folder.getEntry('context.json'),value=JSON.parse(await contextFile.read());value.dateText='fake';await contextFile.write(JSON.stringify(value));
    }
    if(failure==='consumer')h.options.consumerId='other';
    if(failure==='directory')h.options.sourceIdentity='other';
    if(failure==='output')await(await task.folder.createFile('output-started.json',{overwrite:false})).write('{}');
    await assert.rejects(h.service.retryPending(task.id),/已变化|已改变|不同|输出痕迹/);
    assert.equal(h.taskCount(),1);assert.equal(h.canvases.length,0);
    await assert.rejects(task.folder.getEntry('complete.json'));
  }
});

test('stopping local wait and late valid receipts never auto-output; a different customer requires explicit deferral', async () => {
  const h=harness({receipt:false,onSleep:service=>service.stopWaiting()});
  await assert.rejects(h.service.electronic(h.original,h.info,{}),/停止本机等待/);
  const task=h.service.latest();h.options.receipt=true;h.options.onSleep=null;
  assert.equal(await h.service.readCode(task),'T2EST4');
  assert.equal(h.renders.length,0);await assert.rejects(task.folder.getEntry('complete.json'));
  await assert.rejects(h.service.deferPending('other'),/已改变/);
  await h.service.deferPending(task.id);assert.equal(await h.service.pending(),null);
  const next=await h.service.electronic(h.original,{...h.info,id:99,name:'next'}, {});
  assert.notEqual(next.id,task.id);assert.equal(h.taskCount(),2);
  await assert.rejects(task.folder.getEntry('complete.json'));
});

test('bound authentication diagnostics differ from timeout; stale/cross-task errors cannot become this task diagnosis', async () => {
  for(const invalid of [false,'staleNonce','foreignReceipt']) {
    const h=harness({denied:true,errorCode:'UNAUTHENTICATED',...(invalid?{[invalid]:true}:{})});
    await assert.rejects(h.service.electronic(h.original,h.info,{}),invalid?/超时/:/云端认证失败/);
    assert.equal(h.canvases.length,0);
  }
  const late=harness({replyDelay:61000});
  await assert.rejects(late.service.electronic(late.original,late.info,{}),/超时/);
  assert.equal(late.canvases.length,0,'response read after deadline cannot authorize output');
});

test('a slow but bounded cloud confirmation completes once, outside Photoshop modal execution', async () => {
  const h=harness({replyDelay:45000});
  const task=await h.service.electronic(h.original,h.info,{});
  assert.equal(task.completionWritten,true);
  assert.equal(h.taskCount(),1);
  assert.equal(h.renders.length,1);
  assert.equal(await h.service.pending(),null);
});

test('concurrent starts and retries have one owner, one task and one output', async () => {
  const first=harness();
  const outcomes=await Promise.allSettled([first.service.electronic(first.original,first.info,{}),first.service.electronic(first.original,first.info,{})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(first.taskCount(),1);assert.equal(first.renders.length,1);
  const h=harness({receipt:false});await assert.rejects(h.service.electronic(h.original,h.info,{}));const task=h.service.latest();
  h.options.receipt=true;
  const retries=await Promise.allSettled([h.service.retryPending(task.id),h.service.retryPending(task.id)]);
  assert.equal(retries.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.taskCount(),1);assert.equal(h.renders.length,1);
});

test('print retry runs the real workflow on saved pixels and frozen template/options; no new prepare or task', async () => {
  const h=harness({receipt:false}), actions=[];
  const template={...h.window.IDPhotoTemplates.getTemplateById(),id:'one',name:'原模板',widthPx:600,heightPx:800};
  const originalVariant={sourceKey:'original-source',background:'blue'};
  h.info.sourceVariant=originalVariant;
  const task=await h.service.begin(h.info,'print',template,{shopName:'原店铺'},null,{
    exportJpg:true,nasArchive:true,quickPrint:true,skipPrint:false,rowGap:10,colGap:12,cropStrategy:'auto'
  });
  await assert.rejects(h.service.prepare(task,h.photo),/超时/);
  const payload=await(await task.folder.getEntry('request.json')).read();
  h.options.receipt=true;
  h.window.IDPhotoTemplateOverrideService={getEffectiveTemplateByName:()=>{throw Error('must use original template snapshot');}};
  h.window.IDPhotoRatioChecker={checkDocumentRatio:()=>({canCheck:true,ok:true,errorPercent:0})};
  h.window.IDPhotoCropService={prepareSinglePhoto:async(source,info,t,ratio,options)=>{
    assert.notEqual(source.id,h.original.id);assert.equal(options.keepHighResolution,false);assert.equal(t.name,'原模板');
    actions.push('crop-saved');return {document:h.doc(600,800)};
  }};
  h.window.IDPhotoCanvasService={createSixInchCanvas:async()=>({document:h.doc(3600,2400)})};
  h.window.IDPhotoLayoutEngine={createLayoutPlan:({template:t})=>({positions:[{x:0,y:0}],infoBar:t.infoBar})};
  h.window.IDPhotoLayerService={placePhotoCopies:async()=>({placedCount:1})};
  h.window.IDPhotoExportService={exportSingleJpg:async(doc,options)=>{
    assert.deepEqual(JSON.parse(JSON.stringify(options.docInfo.sourceVariant)),originalVariant);
    assert.equal(options.nasArchive,true);actions.push('archive');return {ok:true};
  }};
  h.window.IDPhotoPrintService={printOneCopy:async()=>{actions.push('print-substitute');return {ok:true,printed:true};}};
  h.window.IDPhotoVariantService={analyzeDocument:async()=>{throw Error('must retain pre-crop identity');}};
  h.loadWorkflow();
  const restored=await h.service.retryPending(task.id);
  assert.equal(restored.id,task.id);assert.equal(restored.completionWritten,true);assert.equal(h.taskCount(),1);
  assert.deepEqual(actions,['crop-saved','archive','print-substitute']);
  assert.equal(h.renders.length,1);assert.equal(await(await task.folder.getEntry('request.json')).read(),payload);
  assert.equal(h.closed.includes(h.original.id),false);
  await assert.rejects(h.service.retryPending(task.id),/已有完成/);
  assert.equal(actions.filter(x=>x==='print-substitute').length,1);
  const completion=await(await task.folder.getEntry('complete.json')).read();
  h.window.IDPhotoPrintService.printOneCopy=async()=>{actions.push('print-cancel-substitute');return {ok:false,cancelled:true};};
  await assert.rejects(h.service.reprintCurrent(task.id,true),/取消/);
  assert.equal(h.taskCount(),1);assert.equal((await h.service.current()).id,task.id);
  h.reload();
  h.window.IDPhotoPrintService.printOneCopy=async()=>{actions.push('print-substitute');return {ok:true,printed:true};};
  const repeats=await Promise.allSettled([h.service.reprintCurrent(task.id,true),h.service.reprintCurrent(task.id,true)]);
  assert.equal(repeats.filter(r=>r.status==='fulfilled').length,1,'double activation must have one output owner');
  assert.equal(h.taskCount(),1);assert.equal(actions.filter(x=>x==='print-substitute').length,2);
  assert.equal(await(await task.folder.getEntry('request.json')).read(),payload);
  assert.equal(await(await task.folder.getEntry('complete.json')).read(),completion);
});
function historicalIntent(info) {
  return { type: "historical-shop", confirmed: true, noExistingDelivery: true, sourceDocumentId: String(info.id),
    sourceName: String(info.name || ""), sourceMetadata: JSON.stringify(info.sourceMetadata || {}) };
}
test('connection requires this nonce and directory; local readiness creates no delivery or code', async () => {
  const h = harness();
  const response = await h.service.connection();
  assert.equal(response.cloudChecked, false);
  assert.equal(h.service.latest(), null);
  assert.equal(Array.from(h.files.keys()).some(key => key.endsWith('photo.jpg') || key.includes('/code-request.json')), false);
  for (const options of [{ connection: false }, { staleConnection: true }, { wrongConnectionRoot: true },
    { connectionState: 'isolated' }, { connectionState: 'stopping' }, { connectionState: 'stopped' }, { connectionProtocol: 'old' }]) {
    const blocked = harness(options);
    await assert.rejects(blocked.service.electronic(blocked.original, blocked.info, {}), error => error.code === 'PICKUP_CODE_REQUIRED');
    assert.equal(blocked.service.latest(), null);
    assert.equal(blocked.canvases.length, 0);
    assert.equal(blocked.renders.length, 0);
    assert.equal(Array.from(blocked.files.keys()).some(key => key.endsWith('photo.jpg') || key.includes('/request.json')), false);
  }
});
test('historical electronic delivery requires this-photo confirmation; unknown dates stay empty and next photos remain blocked', async () => {
  for (const captureDate of [undefined, "2000:01:02 12:00:00", "invalid"]) {
    const h = harness({ eligible: false });
    if (captureDate) h.info.sourceMetadata.captureDate = captureDate;
    await assert.rejects(h.service.electronic(h.original, h.info, {}), /明确确认/);
    assert.equal(h.service.latest(), null);
    const intent = historicalIntent(h.info);
    const task = await h.service.electronic(h.original, h.info, {}, intent);
    const request = JSON.parse(await (await task.folder.getEntry("request.json")).read());
    assert.equal(request.sourceConfirmation.kind, "historical-shop");
    assert.equal(request.sourceConfirmation.sourceDocumentId, String(h.info.id));
    assert.equal(request.sourceConfirmation.captureDate, captureDate && captureDate.startsWith("2000") ? "2000.01.02" : "");
    assert.equal(h.renders[0].date, request.sourceConfirmation.captureDate);
    await task.folder.getEntry("complete.json");
    h.info.id++;
    await assert.rejects(h.service.electronic(h.original, h.info, {}, intent), /开始下一位/);
    await h.service.nextCustomer(task.id);
    await assert.rejects(h.service.electronic(h.original, h.info, {}, intent), /明确确认/);
    await assert.rejects(h.service.electronic(h.original, h.info, {}), /明确确认/);
  }
});
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
    assert.equal(h.renders[0].source,h.photo.id);assert.equal(h.renders[0].code,'T2EST4');assert.equal(h.renders[0].mode,true);
  }
});
test('missing, stale, foreign, terminal or invalid code blocks electronic output and preserves the uncompleted handoff',async()=>{
  for(const options of [{receipt:false},{foreignReceipt:true},{staleNonce:true},{terminal:'cancelled'},{terminal:'withdrawn'},{denied:true},{invalidCode:true}]) {
    const h=harness(options);
    await assert.rejects(h.service.electronic(h.original,h.info,{}),error=>error.code==='PICKUP_CODE_REQUIRED');
    const task=h.service.latest();
    assert.equal(task.code,'');assert.equal(task.status.codeState,'unconfirmed');
    assert.equal(h.renders.length,0);assert.equal(h.canvases.length,0);
    await assert.rejects(task.folder.getEntry('complete.json'));
    await assert.rejects(task.folder.getEntry('info.jpg'));
    await task.folder.getEntry('photo.jpg');await task.folder.getEntry('request.json');
    assert.ok(h.closed.includes(h.photo.id));assert.equal(h.closed.includes(h.original.id),false);
    h.options.receipt=true;h.options.foreignReceipt=false;h.options.staleNonce=false;h.options.terminal=null;h.options.denied=false;h.options.invalidCode=false;
    assert.equal(await h.service.readCode(task),'T2EST4');
    await assert.rejects(task.folder.getEntry('complete.json'),'a late code must not finish the aborted operation');
  }
});

test('complete cannot export artifacts or publish with an empty code',async()=>{
  const h=harness(),task=await h.service.begin(h.info,'print',{},{});
  task.fingerprint='saved-photo';
  await assert.rejects(h.service.complete(task,h.photo,{}),error=>error.code==='PICKUP_CODE_REQUIRED');
  await assert.rejects(task.folder.getEntry('layout.jpg'));
  await assert.rejects(task.folder.getEntry('complete.json'));
});

test('electronic pickup error survives secondary status and cleanup failures for the native popup',async()=>{
  for(const fault of [{statusWriteFail:true},{cleanupFail:true},{statusWriteFail:true,cleanupFail:true}]) {
    const h=harness({receipt:false,...fault});
    await assert.rejects(h.service.electronic(h.original,h.info,{}),error=>{
      assert.equal(error.code,'PICKUP_CODE_REQUIRED');
      if(fault.statusWriteFail)assert.match(error.message,/status disk failure/);
      if(fault.cleanupFail)assert.match(error.message,/close failure/);
      return true;
    });
    const task=h.service.latest();
    await assert.rejects(task.folder.getEntry('complete.json'));
    assert.equal(h.canvases.length,0);assert.equal(h.renders.length,0);
    assert.equal(h.closed.includes(h.original.id),false);
    assert.ok(h.closed.includes(h.photo.id),'attempt owned-copy cleanup even when status writing fails');
  }
});

test('cleanup failure after successful electronic completion is not mislabeled as a pickup rejection',async()=>{
  const h=harness({cleanupFail:true});
  await assert.rejects(h.service.electronic(h.original,h.info,{}),error=>{
    assert.notEqual(error.code,'PICKUP_CODE_REQUIRED');
    assert.match(error.message,/close failure/);
    return true;
  });
  const task=h.service.latest();
  assert.equal(JSON.parse(await(await task.folder.getEntry('complete.json')).read()).processingComplete,true);
  assert.equal(task.code,'T2EST4');
  assert.equal(h.closed.includes(h.original.id),false);
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
 await h.service.nextCustomer(task.id);
 const next=await h.service.multi(h.original,h.info,{},[{filename:'next.jpg'}]);assert.equal(JSON.parse(await(await next.folder.getEntry('request.json')).read()).targetDeliveryId,undefined);
});
test('multi local archives bind each exact file ordinal and retry local failure without recreating or completing the batch',async()=>{
 const h=harness({multi:true}),exports=[];
 h.window.IDPhotoVariantService={analyzeDocument:async()=>({identityMarker:'original-only',backgroundColor:'blue'})};
 let fail=true;
 h.window.IDPhotoExportService={exportSingleJpg:async(doc,options)=>{
   exports.push(options);
   if(fail)throw Error('archive offline');
   return {ok:true};
 }};
 const task=await h.service.multi(h.original,h.info,{},[{filename:'one.jpg'},{filename:'two.jpg'}],null,{exportJpg:true,nasArchive:true});
 assert.equal(task.status.processing,'draft');assert.equal(task.status.archive,'pending');
 const request=await(await task.folder.getEntry('request.json')).read(),complete=await(await task.folder.getEntry('complete.json')).read();
 assert.equal(exports.length,1);assert.equal(exports[0].deliveryTask.archiveOrdinal,0);
 assert.equal(exports[0].deliveryTask.fingerprint,h.window.IDPhotoDeliveryProtocol.sha256(request));
 assert.equal(exports[0].docInfo.sourceVariant.identityMarker,'original-only');
 h.reload();fail=false;
 assert.equal((await h.service.current()).batch,true);
 assert.match(await h.service.currentPreview(task.id),/^data:image\/jpeg;base64,/);
 await h.service.retryCurrentArchives(task.id);
 assert.deepEqual(exports.slice(1).map(o=>o.deliveryTask.archiveOrdinal),[0,1]);
 assert.equal(h.taskCount(),1);assert.equal(h.renders.length,0);
 assert.equal(await(await task.folder.getEntry('request.json')).read(),request);
 assert.equal(await(await task.folder.getEntry('complete.json')).read(),complete);
 assert.equal(h.closed.includes(h.original.id),false);
});

test('completed electronic task survives reload; deliberate repeat keeps request/code and never creates a customer', async()=>{
  const h=harness(),first=await h.service.electronic(h.original,h.info,{});
  const request=await(await first.folder.getEntry('request.json')).read();
  const complete=await(await first.folder.getEntry('complete.json')).read();
  const marker=await(await first.folder.getEntry('output-started.json')).read();
  const before=JSON.parse(await(await first.folder.getEntry('code-request.json')).read()).requestId;
  h.reload();
  assert.equal((await h.service.current()).id,first.id);
  assert.match(await h.service.currentPreview(first.id),/^data:image\/jpeg;base64,/);
  await assert.rejects(h.service.electronic(h.original,h.info,{}),/开始下一位/);
  await assert.rejects(h.service.reprintCurrent(first.id,false),/核对原照片/);
  const repeated=await h.service.reprintCurrent(first.id,true);
  assert.equal(repeated.id,first.id);assert.equal(repeated.code,first.code);assert.equal(h.taskCount(),1);
  assert.equal(h.renders.length,2);assert.equal(h.closed.includes(h.original.id),false);
  assert.notEqual(JSON.parse(await(await first.folder.getEntry('code-request.json')).read()).requestId,before);
  assert.equal(await(await first.folder.getEntry('request.json')).read(),request);
  assert.equal(await(await first.folder.getEntry('complete.json')).read(),complete);
  assert.equal(await(await first.folder.getEntry('output-started.json')).read(),marker);
  await first.folder.getEntry('output-complete-'+repeated.outputAttemptId+'.json');
  await assert.rejects(h.service.nextCustomer('other'),/已改变/);
  await h.service.nextCustomer(first.id);
  // Same filename, same pixels, even same document id still means a new customer
  // after the explicit next-customer action.
  const next=await h.service.electronic(h.original,h.info,{});
  assert.notEqual(next.id,first.id);assert.equal(h.taskCount(),2);
});

test('repeat refuses replaced photo, root, consumer, terminal status and stale replies without new outputs',async()=>{
  for(const failure of ['photo','directory','consumer','cancelled','withdrawn','frozen','nonce','network']) {
    const h=harness(),first=await h.service.electronic(h.original,h.info,{});
    if(failure==='photo') await(await first.folder.getEntry('photo.jpg')).write(new Uint8Array([9]).buffer);
    if(failure==='directory') h.options.sourceIdentity='other';
    if(failure==='consumer') h.options.consumerId='other';
    if(['cancelled','withdrawn','frozen'].includes(failure))h.options.terminal=failure;
    if(failure==='nonce')h.options.staleNonce=true;
    if(failure==='network')h.options.receipt=false;
    await assert.rejects(h.service.reprintCurrent(first.id,true),undefined,failure);
    assert.equal(h.taskCount(),1);assert.equal(h.renders.length,1,failure);
    assert.equal([...h.files.keys()].some(p=>/output-started-[a-f0-9]+.json$/.test(p)),false);
  }
});

test('a changed code after rendering stops repeat completion; another deliberate attempt can use the new code',async()=>{
  const h=harness(),first=await h.service.electronic(h.original,h.info,{});
  h.options.changedDuringRender=true;
  await assert.rejects(h.service.reprintCurrent(first.id,true),/取件码已变化/);
  assert.equal(h.taskCount(),1);
  assert.equal([...h.files.keys()].filter(p=>/output-complete-[a-f0-9]+.json$/.test(p)).length,0);
  const next=await h.service.reprintCurrent(first.id,true);
  assert.equal(next.id,first.id);assert.equal(next.code,'N7EW8A');assert.equal(h.taskCount(),1);
});

async function informationFixture() {
  const h=harness({contextKey:'a'.repeat(64),deliveryId:'b'.repeat(64)});
  const task=await h.service.electronic(h.original,h.info,{});
  const request=JSON.parse(await(await task.folder.getEntry('request.json')).read());
  Object.assign(request,{version:2,informationOnly:true,referenceDeliveryId:h.options.deliveryId,
    referenceContextKey:h.options.contextKey,referenceFileId:'c'.repeat(64),referenceRevision:3});
  delete request.contextFingerprint;
  const payload=JSON.stringify(request),fingerprint=h.window.IDPhotoDeliveryProtocol.sha256(payload);
  await(await task.folder.getEntry('request.json')).write(payload);
  await(await task.folder.getEntry('context.json')).delete();
  await(await task.folder.getEntry('code-binding.json')).write(JSON.stringify({version:2,taskId:task.id,
    manifestFingerprint:fingerprint,contextKey:h.options.contextKey,deliveryId:h.options.deliveryId}));
  const root=await h.service.root(),inbox=await root.createFolder('information-requests');
  const input={version:1,taskId:task.id,relativePath:task.folder.nativePath.slice(root.nativePath.length+1),
    manifestFingerprint:fingerprint,contextKey:h.options.contextKey,deliveryId:h.options.deliveryId,
    code:'T2EST4',signature:'d'.repeat(64),dateText:'2026.9.29'};
  const enqueue=async()=>{await(await inbox.createFile(task.id+'.json',{overwrite:true})).write(JSON.stringify(input));};
  await enqueue();
  return {h,task,input,enqueue,inbox,request,payload};
}

test('backend information pickup uses the original generator and binds result without completing or uploading again',async()=>{
  const {h,task,input,payload}=await informationFixture();
  const complete=await(await task.folder.getEntry('complete.json')).read(),before=h.renders.length;
  const result=await h.service.receiveInformationTasks();
  assert.equal(result.completed,1,JSON.stringify(result));assert.equal(result.failures.length,0);
  assert.equal(h.renders.length,before+1);
  assert.equal(h.renders.at(-1).date,'2026.9.29');
  assert.equal(await(await task.folder.getEntry('request.json')).read(),payload);
  assert.equal(await(await task.folder.getEntry('complete.json')).read(),complete);
  const receipt=JSON.parse(await(await task.folder.getEntry('information-result.json')).read());
  assert.equal(receipt.code,input.code);assert.equal(receipt.signature,input.signature);
  assert.equal(receipt.fileId,'c'.repeat(64));assert.equal(receipt.revision,3);
  assert.equal(receipt.contextKey,input.contextKey);assert.equal(receipt.deliveryId,input.deliveryId);
  assert.match(receipt.artifact.path,/^info-[a-f0-9]{32}\.jpg$/);
  assert.equal(h.taskCount(),1);
});

test('information pickup recovers acknowledgement loss without rerendering, and explicitly repairs a missing image',async()=>{
  const {h,task,enqueue}=await informationFixture();
  await h.service.receiveInformationTasks();const count=h.renders.length;
  await enqueue();await h.service.receiveInformationTasks();
  assert.equal(h.renders.length,count);
  const receipt=JSON.parse(await(await task.folder.getEntry('information-result.json')).read());
  await(await task.folder.getEntry(receipt.artifact.path)).delete();
  await enqueue();const repaired=await h.service.receiveInformationTasks();
  assert.equal(repaired.completed,1);assert.equal(h.renders.length,count+1);
});

test('information pickup rejects cross-task, traversal, foreign connection and changed photo without a result',async()=>{
  for(const scenario of ['task','traversal','connection','photo','code']) {
    const {h,task,input,enqueue}=await informationFixture();
    if(scenario==='task')input.deliveryId='f'.repeat(64);
    if(scenario==='traversal')input.relativePath='../'+input.relativePath;
    if(scenario==='connection')h.options.foreignContext=true;
    if(scenario==='photo')await(await task.folder.getEntry('photo.jpg')).write(new Uint8Array([9]).buffer);
    if(scenario==='code')input.code='A3BC4D';
    await enqueue();const before=h.renders.length,result=await h.service.receiveInformationTasks();
    assert.equal(result.completed,0,scenario);assert.equal(result.failures.length,1,scenario);
    assert.equal(h.renders.length,before,scenario);
    await assert.rejects(task.folder.getEntry('information-result.json'));
  }
});

test('information pickup preserves a failed task for explicit retry and never treats rendering-time rotation as success',async()=>{
  const {h,task}=await informationFixture();
  h.options.changedDuringRender=true;
  const failed=await h.service.receiveInformationTasks();
  assert.equal(failed.completed,0);assert.equal(failed.failures.length,1);
  await assert.rejects(task.folder.getEntry('information-result.json'));
  const error=JSON.parse(await(await task.folder.getEntry('information-error.json')).read());
  assert.equal(error.taskId,task.id);
  h.options.changedDuringRender=false;
  const retry=await h.service.receiveInformationTasks();
  assert.equal(retry.completed,1,JSON.stringify(retry));
});
