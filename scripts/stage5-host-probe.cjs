// Builds a real Photoshop UXP probe from the current production modules.
// Fixture camera registration/date are explicitly isolated substitutions; NAS bytes,
// Photoshop processing, handoff, worker and cloud transport are not mocked.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || 'C:/Users/Administrator/.cache/yx-stage5/host');
fs.mkdirSync(output,{recursive:true});
const modules = ['core/errorService','core/deliveryProtocol','core/templateRegistry','core/ratioChecker','core/dateService','core/pathService','core/settingsProfile','core/sourceEligibilityService','core/smartCropPlanner','photoshop/photoshopExecution','photoshop/documentService','photoshop/contentAwareService','photoshop/cropService','photoshop/canvasService','photoshop/layerService','photoshop/infoBarRenderer','photoshop/deliveryService','core/layoutEngine','core/layoutWorkflow'];
const hashes = Object.fromEntries(modules.map(n=>[n+'.js',crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src',n+'.js'))).digest('hex')]));
const header=`const realRequire=require;
const ps=realRequire('photoshop'),uxp=realRequire('uxp'),storage=uxp.storage;
const output=await storage.localFileSystem.getEntryWithUrl(${JSON.stringify('file:/'+output.replace(/\\/g,'/'))});
{
const require=name=>name==='uxp'?{...uxp,storage:{...storage,localFileSystem:{...storage.localFileSystem,getDataFolder:async()=>output,createPersistentToken:async entry=>entry.url,getEntryForPersistentToken:token=>storage.localFileSystem.getEntryWithUrl(token)}}}:realRequire(name);
const memory={};const window={localStorage:{getItem:k=>memory[k]||null,setItem:(k,v)=>memory[k]=String(v),removeItem:k=>delete memory[k]}};
const report={testOnly:true,fixtureBoundary:'isolated camera registration and current capture metadata only; real authorized NAS photo copies; no physical print or real user identity acceptance',sourceHashes:${JSON.stringify(hashes)},started:new Date().toISOString(),before:Array.from(ps.app.documents).map(d=>({id:d.id,width:d.width,height:d.height})),results:[],errors:[]};
const owned=new Set(); let originalActive=ps.app.activeDocument;
async function writeReport(){await(await output.createFile('report.json',{overwrite:true})).write(JSON.stringify(report,null,2),{format:storage.formats.utf8});}
`;
const footer=`
try {
  const metadata={make:'TESTONLY',model:'stage5 fixture',serialNumber:'STAGE5_TEST_CAMERA',captureDate:new Date().toISOString().slice(0,10),historical:false};
  window.IDPhotoSourceEligibilityService.registerCamera(metadata);
  window.IDPhotoSettingsStore={load:()=>({shopName:'阶段5测试',shopPhone:'电话未填写'})};
  async function openFixture(name){
    const file=await storage.localFileSystem.getEntryWithUrl('file:/C:/Users/Administrator/.cache/yx-stage5/samples/'+name);
    let doc;await window.IDPhotoPhotoshopExecution.executeAsModal(async()=>{doc=await ps.app.open(file);},'打开隔离测试副本');
    if(report.before.some(d=>d.id===doc.id))throw Error('Fixture aliases pre-existing user document');owned.add(doc.id);
    await window.IDPhotoPhotoshopExecution.activateDocument(doc);
    const info=await window.IDPhotoDocumentService.getActiveDocumentInfo();
    if(!info||info.id!==doc.id)throw Error('Fixture document identity mismatch');
    info.sourceMetadata=metadata;info.name='stage5-testOnly-'+name;
    return {doc,info};
  }
  const source=await openFixture('sample-17.jpg');
  const workflow=window.IDPhotoLayoutWorkflow.create({onStatus:message=>{report.lastStatus=message;},onError:(stage,error)=>report.errors.push({stage,error:error.message})});
  for(const t of window.IDPhotoTemplates.getAllTemplates()){
    const result=await workflow.run({templateNames:[t.name],sourceDocument:source.doc,docInfo:source.info,cropStrategy:'crop',skipExport:true,skipPrint:true,delivery:t.id==='one-inch'});
    if(!result.ok)throw Error(t.id+': '+result.failures.map(f=>f.error.message).join('; '));
    const r=result.successResults[0].result,doc=r.targetDocument;
    if(!doc || report.before.some(d=>d.id===doc.id)||doc.id===source.doc.id||doc.width!==3600||doc.height!==2400)throw Error('Output identity/pixels mismatch');
    owned.add(doc.id);
    const layers=Array.from(doc.layers).map(l=>({name:l.name,bounds:{left:Number(l.bounds.left),top:Number(l.bounds.top),right:Number(l.bounds.right),bottom:Number(l.bounds.bottom)}}));
    const file=await output.createFile(t.id+'.jpg',{overwrite:false});
    await window.IDPhotoPhotoshopExecution.executeAsModal(async()=>{await window.IDPhotoPhotoshopExecution.activateDocument(doc);await doc.saveAs.jpg(file,{quality:10},true);},'保存实际模板取证');
    report.results.push({template:t.id,documentId:doc.id,pixels:[doc.width,doc.height],photos:r.layerResult.placedCount,infoBar:r.layoutPlan.infoBar,delivery:r.deliveryResult,layers,print:r.printResult});await writeReport();
    await window.IDPhotoDocumentService.closeWithoutSaving(doc);owned.delete(doc.id);
  }
  const electronic=await openFixture('sample-3.jpg');
  const task=await window.IDPhotoDeliveryService.electronic(electronic.doc,electronic.info,window.IDPhotoSettingsStore.load());
  report.electronic={taskId:task.id,code:task.code,fingerprint:task.fingerprint,status:task.status,sourcePixels:[electronic.doc.width,electronic.doc.height]};
  if(task.status.info!=='saved')throw Error('Electronic information strip failed: '+(task.status.infoError||task.status.info));
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message||String(error);report.stack=error.stack;}
finally{
  for(const d of Array.from(ps.app.documents)){if(owned.has(d.id)&&!report.before.some(x=>x.id===d.id))try{await window.IDPhotoDocumentService.closeWithoutSaving(d);}catch(error){report.errors.push({cleanup:d.id,error:error.message});}}
  if(originalActive&&Array.from(ps.app.documents).some(d=>d.id===originalActive.id))await window.IDPhotoPhotoshopExecution.activateDocument(originalActive);
  report.after=Array.from(ps.app.documents).map(d=>({id:d.id,width:d.width,height:d.height}));report.finished=new Date().toISOString();await writeReport();
}
}
`;
fs.writeFileSync(path.join(output,'probe.psjs'),header+modules.map(n=>fs.readFileSync(path.join(root,'src',n+'.js'),'utf8')).join('\n')+footer);
fs.writeFileSync(path.join(output,'source-hashes.json'),JSON.stringify(hashes,null,2));
console.log(path.join(output,'probe.psjs'));
