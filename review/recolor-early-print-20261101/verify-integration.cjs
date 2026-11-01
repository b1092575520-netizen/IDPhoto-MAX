'use strict';
// Real Windows QueueWorker + production service over the existing local stdio
// fixture. Only Photoshop pixels and shell.openPath are doubles. Never installed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const [pluginRoot, desktopRoot, probe, area] = process.argv.slice(2).map(x => path.resolve(x));
assert.ok(area.startsWith(path.join(pluginRoot, 'review', 'recolor-early-print-20261101') + path.sep));
assert.ok(!fs.existsSync(area), 'fresh independent queue/source required');
fs.mkdirSync(area, {recursive:true});
const bridge = path.join(desktopRoot, 'tests/desktop/stage6-service.js');
const setup = cp.spawnSync(probe, ['setup',area,process.execPath,bridge], {encoding:'utf8',windowsHide:true});
assert.equal(setup.status, 0, setup.stderr);
const settings = JSON.parse(setup.stdout.trim());
fs.writeFileSync(path.join(area,'setup.json'), JSON.stringify(settings,null,2));
const events = [], errors = [], sleep = ms => new Promise(r => setTimeout(r,ms));
let worker, workerExit, holdFirst = true, permissions = 0, denied = false;
function event(action, details={}) { const value={at:new Date().toISOString(),action,...details}; events.push(value); fs.appendFileSync(path.join(area,'events.jsonl'),JSON.stringify(value)+'\n'); }
function startWorker() {
  const log = fs.openSync(path.join(area,'worker.log'),'a');
  worker = cp.spawn(probe,['worker-loop',area,process.execPath,bridge],{stdio:['ignore',log,log],windowsHide:true});
  workerExit = new Promise(resolve=>worker.once('exit',(code,signal)=>resolve({code,signal})));
  event('worker-start',{pid:worker.pid});
}
async function until(run, limit=45000) {
  const end=Date.now()+limit; while(Date.now()<end) { const result=await run(); if(result)return result; await sleep(200); }
  throw Error('isolated fixture deadline exceeded');
}
function json(file) {
  const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  return value&&typeof value.payload==='string'&&value.checksum?JSON.parse(value.payload):value;
}
function inside(value) { const resolved=path.resolve(value); assert.ok(resolved===area||resolved.startsWith(area+path.sep),'fixture path escaped'); return resolved; }
class Entry {
  constructor(value) { this.nativePath=inside(value); this.name=path.basename(value); this.isFolder=fs.statSync(value).isDirectory(); }
  async getEntries() { return fs.readdirSync(this.nativePath).map(x=>new Entry(path.join(this.nativePath,x))); }
  async getEntry(name) { return new Entry(path.join(this.nativePath,name)); }
  async createFolder(name) { const value=inside(path.join(this.nativePath,name)); fs.mkdirSync(value); return new Entry(value); }
  async createFile(name,options={}) { const value=inside(path.join(this.nativePath,name)); fs.writeFileSync(value,'',{flag:options.overwrite?'w':'wx'}); return new Entry(value); }
  async read(options={}) { const bytes=fs.readFileSync(this.nativePath); return options.format==='binary'?Uint8Array.from(bytes).buffer:bytes.toString('utf8').replace(/^\uFEFF/,''); }
  async write(value) { fs.writeFileSync(this.nativePath,typeof value==='string'?value:Buffer.from(value)); }
  async moveTo(folder,options) {
    let name=options.newName;
    // Hold only this test's first completion to reproduce the measured narrow
    // preparing window, without changing any production backend/source code.
    if(holdFirst&&name==='complete.json') { holdFirst=false; name='held-complete.json'; event('hold-first-completion',{task:folder.name}); }
    const target=inside(path.join(folder.nativePath,name));
    if(!options.overwrite&&fs.existsSync(target))throw Error('destination exists');
    fs.renameSync(this.nativePath,target); this.nativePath=target; this.name=name;
    if(name==='complete.json')event('file-completion',{task:folder.name});
  }
  async delete() { assert.equal(this.isFolder,false); fs.unlinkSync(this.nativePath); }
}
const data=path.join(area,'plugin-data'); fs.mkdirSync(data);
const memoryFile=path.join(area,'plugin-local-storage.json');
const counters={opens:0,renders:0,psSaves:0,exports:0,activates:0};
const fixtures=path.join(path.dirname(probe),'images');
let serial=0;
function document(width,height) {
  const doc={id:++serial,width,height,name:'fixture-'+serial,activate:async()=>{counters.activates++;},
    saveAs:{jpg:async file=>{counters.psSaves++; await file.write(fs.readFileSync(path.join(fixtures,`${doc.width}x${doc.height}.jpg`)));}},
    duplicate:async()=>document(doc.width,doc.height),crop:async box=>{doc.width=box.right-box.left;doc.height=box.bottom-box.top;}};
  return doc;
}
const template={id:'fixture',name:'Fixture',widthPx:80,heightPx:100,infoBar:{x:0,y:0,width:200,height:60}};
function runtime() {
  let memory=fs.existsSync(memoryFile)?json(memoryFile):{};
  const persist=()=>fs.writeFileSync(memoryFile,JSON.stringify(memory));
  memory['idphoto-delivery-root-v1']=settings.sourceRoot;persist();
  const sourceRoot=new Entry(settings.sourceRoot);
  const app={documents:[],open:async()=>{counters.opens++;throw Error('background must never open Photoshop');}};
  const window={localStorage:{getItem:k=>memory[k]||null,setItem:(k,v)=>{memory[k]=v;persist();}},
    IDPhotoSettingsProfile:{load:()=>({cameras:[{serialNumber:'ISOLATED-CAMERA'}]})},IDPhotoSettingsStore:{load:()=>({})},
    IDPhotoDateService:{formatDisplayDate:()=> '2026.11.1'},IDPhotoPathService:{getDateFolders:()=>({year:'2026',month:'2026-11',day:'2026-11-01'})},
    IDPhotoTemplates:{getTemplateByName:()=>template,getTemplateById:()=>template},
    IDPhotoPhotoshopExecution:{executeAsModal:async run=>run(),activateDocument:async()=>{counters.activates++;},getPhotoshop:()=>({app})},
    IDPhotoDocumentService:{closeWithoutSaving:async()=>{},getActiveDocument:()=>null},
    IDPhotoCropService:{prepareSinglePhoto:async()=>({document:document(80,100)})},
    IDPhotoRatioChecker:{checkDocumentRatio:()=>({canCheck:true,ok:true})},
    IDPhotoCanvasService:{createSixInchCanvas:async()=>({document:document(3600,2400)})},
    IDPhotoLayoutEngine:{createLayoutPlan:()=>({positions:[{x:0,y:0}],infoBar:template.infoBar})},
    IDPhotoLayerService:{placePhotoCopies:async()=>({placedCount:1})},
    IDPhotoInfoBarRenderer:{renderInfoBar:async(_doc,_bar,_settings,values)=>{counters.renders++;event('render',{code:values.pickupCode,link:values.entryLink});return {ok:true};}},
    IDPhotoExportService:{exportSingleJpg:async()=>{counters.exports++;return {ok:true};}}
  };
  const filesystem={getDataFolder:async()=>new Entry(data),getFolder:async()=>sourceRoot,
    createPersistentToken:async entry=>entry.nativePath,getEntryForPersistentToken:async value=>new Entry(value)};
  const context=vm.createContext({window,console,setTimeout,require:name=>{
    assert.equal(name,'uxp');return {storage:{localFileSystem:filesystem,formats:{utf8:'utf8',binary:'binary'}},shell:{openPath:async value=>{
      inside(value);assert.equal(path.extname(value),'.idprint');permissions++;
      const job=json(value);event('permission',{jobId:job.jobId,denied});
      if(denied)throw Error('Permission denied');
      // This is deliberately a receipt double. No Windows association, GDI,
      // printer spooler, or the installed bridge is invoked.
      fs.writeFileSync(value.replace(/\.idprint$/,'.result.json'),JSON.stringify({schemaVersion:1,jobId:job.jobId,ok:true,printed:true,printerName:'DS-RX1',paperName:'(6x4)',copies:1}));return '';
    }}};
  }});
  for(const name of ['core/sourceEligibilityService','core/deliveryIdentity','core/deliveryProtocol','core/deliveryAutomationStore','core/deliverySpecifications','core/layoutWorkflow','photoshop/deliveryAutomationService','photoshop/deliveryService','photoshop/printService'])
    vm.runInContext(fs.readFileSync(path.join(pluginRoot,'src',name+'.js'),'utf8'),context,{filename:name});
  return window;
}
async function main() {
  startWorker();let w=runtime();const source=document(3000,4000);
  const info={id:source.id,name:'ISOLATED-test.jpg',widthPx:3000,heightPx:4000,
    sourceMetadata:{serialNumber:'ISOLATED-CAMERA',captureDate:'2026:11:01 12:34:56',captureSubsecond:'1',originalDocumentId:'a'.repeat(32)},sourceVariant:{backgroundColor:'red'}};
  const run=()=>w.IDPhotoLayoutWorkflow.create().run({templateNames:[template.name],sourceDocument:source,docInfo:info,delivery:true,quickPrint:true,exportJpg:true,rowGap:10,colGap:10});
  let result=await run();assert.equal(result.ok,true,result.failures.map(x=>x.error.message).join(';'));
  const red=w.IDPhotoDeliveryService.latest();event('red-printed',{task:red.id,code:red.code});
  info.sourceVariant.backgroundColor='white';const clickAt=Date.now();result=await run();
  assert.equal(result.ok,true,result.failures.map(x=>x.error.message).join(';'));const white=w.IDPhotoDeliveryService.latest();
  event('white-printed',{task:white.id,code:white.code,clickElapsedMs:Date.now()-clickAt});assert.equal(white.code,red.code);
  assert.equal(permissions,2);assert.equal(fs.existsSync(path.join(white.folder.nativePath,'request.json')),false);
  result=await run();assert.equal(result.ok,true);assert.equal(permissions,3);assert.equal(w.IDPhotoDeliveryAutomationService.store().tasks().length,2);
  // A denied reprint of the already printed white does not cancel that photo;
  // a newly early-printed blue is cancelled and must never be handed off.
  denied=true;result=await run();assert.equal(result.cancelled,true);denied=false;
  info.sourceVariant.backgroundColor='blue';denied=true;result=await run();assert.equal(result.cancelled,true);denied=false;
  const blue=w.IDPhotoDeliveryService.latest();assert.equal(w.IDPhotoDeliveryAutomationService.store().tasks().find(x=>x.id===blue.id).state,'stopped');
  const deniedAt=w.IDPhotoPrintService.lastDeniedAt();assert.ok(Date.now()-deniedAt<600000);
  const hold=path.join(red.folder.nativePath,'held-complete.json');fs.renameSync(hold,path.join(red.folder.nativePath,'complete.json'));
  const releasedAt=Date.now();event('release-red-completion');
  await until(()=>{try{return json(path.join(settings.queueRoot,red.id,'state.json')).Status==='ready';}catch(_){return false;}});
  // Preserve the denial in this runtime: silent work must bypass its pause.
  const before={...counters,permissions};let pending;
  await until(async()=>{pending=await w.IDPhotoDeliveryService.primeRecovery();if(pending&&typeof pending==='object')throw Error(pending.text);return pending===white.id;});
  assert.ok(Date.now()-deniedAt<600000);event('white-code-confirmed',{task:white.id});
  // Recreate the entire VM from disk before completion, not just the service.
  w=runtime();event('plugin-runtime-restart');
  await until(async()=>{pending=await w.IDPhotoDeliveryService.primeRecovery();if(pending&&typeof pending==='object')throw Error(pending.text);return pending===white.id;});
  assert.equal(await w.IDPhotoDeliveryService.recoverNext(white.id),null);
  assert.deepEqual({...counters,permissions},before);
  await until(()=>{try{return json(path.join(settings.queueRoot,white.id,'state.json')).Status==='ready';}catch(_){return false;}});
  const state=json(path.join(settings.queueRoot,white.id,'state.json'));assert.equal(state.Code,red.code);
  assert.equal(fs.existsSync(path.join(blue.folder.nativePath,'request.json')),false);
  assert.equal(w.IDPhotoDeliveryAutomationService.store().tasks().length,3);
  const request=json(path.join(white.folder.nativePath,'request.json'));assert.equal(request.targetDeliveryId,red.deliveryId);
  const detail=cp.spawnSync(process.execPath,[bridge,path.join(area,'server')],{input:JSON.stringify({action:'staffDetail',input:{deliveryId:red.deliveryId},owner:'r2-owner'}),encoding:'utf8',windowsHide:true});
  assert.equal(detail.status,0,detail.stderr);const response=JSON.parse(detail.stdout);assert.equal(response.ok,true);
  const photos=response.data.files; // Current collection includes committed batches.
  assert.equal(photos.length,2,'one red and exactly one white, no blue or duplicate white');
  const elapsed=Date.now()-releasedAt;event('white-published',{elapsedMs:elapsed,task:white.id,permissions});
  const report={passed:true,boundary:'real Windows QueueWorker / disk queue and source / production JS service with isolated stdio storage; Photoshop and print-bridge doubles; no cloud, no actual printing',
    permissions,readyToPublishedMs:elapsed,red:red.id,white:white.id,cancelledBlue:blue.id,code:red.code,psBeforeUpload:before,psAfterUpload:{...counters,permissions},publishedPhotos:photos.length,events};
  fs.writeFileSync(path.join(area,'result.json'),JSON.stringify(report,null,2));
}
main().catch(error=>{errors.push(String(error.stack||error));fs.writeFileSync(path.join(area,'failure.json'),JSON.stringify({errors,events},null,2));process.exitCode=1;console.error(error);}).finally(async()=>{
  if(worker){fs.writeFileSync(path.join(settings.queueRoot,'stop-worker.request'),'owned fixture complete');
    let stopTimer;
    const stopped=await Promise.race([workerExit,new Promise(resolve=>{stopTimer=setTimeout(()=>resolve(null),25000);})]);
    clearTimeout(stopTimer);
    if(!stopped){worker.kill();process.exitCode=1;event('owned-worker-timeout');}else event('worker-stop',stopped);
  }
});
