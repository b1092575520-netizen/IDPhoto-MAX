"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const plugin=path.resolve(__dirname,"..");
const input=process.argv[2],output=path.resolve(process.argv[3]||"");
assert.ok(input&&output&&path.isAbsolute(input),"Give the selected original absolute path and a fresh output directory");
assert.ok(!fs.existsSync(output),"Fresh evidence required");fs.mkdirSync(output,{recursive:true});
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const save=(name,v)=>fs.writeFileSync(path.join(output,name),JSON.stringify(v,null,2)+"\n",{flag:"wx"});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=(promise,ms,label)=>Promise.race([promise,delay(ms).then(()=>{throw Error(label+" timed out")})]);
const corePath="C:/Users/Administrator/.cache/yx-stage5/uxp-cli/node_modules/@adobe/uxp-devtools-cli/node_modules/@adobe/uxp-devtools-core";
let client,session,debuggerClient,ownedCopy,staging;
const report={passed:false,started:new Date().toISOString(),sourceSha256:hash(fs.readFileSync(input)),sourceBindings:[],boundary:"Actual Photoshop27.8 on a byte-exact private unsaved R6 Mark III JPG. Production metadata/identity and exact pre-fix identity modules. Real save/reopen only on private copy. No daily replacement/queue/cloud or printing."};
async function debuggerConnection(endpoint) {
  if (endpoint.startsWith('ws=')) endpoint = 'ws://' + endpoint.slice(3);
  assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:14011\/socket\/cdt\//);
  const socket = new WebSocket(endpoint), pending = new Map();
  let sequence = 0, context, contextResolve;const contexts=[];
  const contextReady = new Promise(resolve => { contextResolve = resolve; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.executionContextCreated') {
      contexts.push(message.params.context.id);contextResolve();
    }
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); }
  };
  await deadline(new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; }), 10000, 'UXP debugger');
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 15000);
    pending.set(id, { resolve, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Runtime.enable');
  await deadline(contextReady, 10000, 'UXP execution context');
  for(let i=0;i<40&&!context;i++){
    for(const id of contexts){
      const reply=await command('Runtime.evaluate',{contextId:id,expression:"typeof window!=='undefined'&&typeof window.runProbe==='function'",returnByValue:true});
      if(reply.result?.result?.value===true){context=id;break;}
    }
    if(!context)await delay(250);
  }
  assert.ok(context,'The private probe DOM context did not become ready');
  return {
    close: () => socket.close(),
    evaluate: async expression => {
      const reply = await command('Runtime.evaluate', { contextId: context, expression, returnByValue: true, awaitPromise: false });
      if (reply.error || reply.result?.exceptionDetails) throw Error(JSON.stringify(reply));
      return reply.result.result.value;
    }
  };
}

async function main(){
  const listeners=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
    "@(Get-NetTCPConnection -State Listen -LocalPort 14011 | ForEach-Object { $p=Get-Process -Id $_.OwningProcess;[pscustomobject]@{address=$_.LocalAddress;name=$p.ProcessName} }) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}));
  assert.ok((Array.isArray(listeners)?listeners:[listeners]).some(x=>x.address==='127.0.0.1'&&x.name==='Adobe UXP Developer Tools'));
  const {UDTApplication}=require(corePath);UDTApplication.createInstance({servicePort:14011});client=UDTApplication.instance().client;
  await client.getServicePort();await deadline(client.connect(),10000,'Adobe service');
  const apps=await client.connectedApps();const host=apps.find(a=>a.id==='PS');assert.ok(host,'Photoshop not connected');
  report.hostVersion=host.version;const selector=host.id+'@'+host.version;
  staging=path.join(output,'probe-plugin');fs.mkdirSync(staging);ownedCopy=path.join(staging,'fresh-original.jpg');
  fs.copyFileSync(input,ownedCopy);assert.equal(hash(fs.readFileSync(ownedCopy)),report.sourceSha256);
  const modules=['core/errorService','core/deliveryProtocol','core/sourceEligibilityService','core/deliveryIdentity','photoshop/photoshopExecution','photoshop/documentService'];
  const texts=modules.map(n=>{const bytes=fs.readFileSync(path.join(plugin,'src',n+'.js'));report.sourceBindings.push({module:n,sha256:hash(bytes)});return bytes.toString('utf8')});
  const old=execFileSync('git',['show','2c3458197b3d35b556ec7e82ff37c643143e5738:src/core/deliveryIdentity.js'],{cwd:plugin,encoding:'utf8',windowsHide:true});
  report.oldIdentitySha256=hash(Buffer.from(old));
  const runtime=`(function(hostWindow){hostWindow.probeStatus={pending:false,ready:true};hostWindow.runProbe=async function(){
    const ps=require('photoshop'),storage=require('uxp').storage,window={};
    ${old}
    const beforeIdentity=window.IDPhotoDeliveryIdentity.getSourceIdentity;
    ${texts.join('\n')}
    const execution=window.IDPhotoPhotoshopExecution,docs=window.IDPhotoDocumentService,identity=window.IDPhotoDeliveryIdentity;
    const sha=window.IDPhotoDeliveryProtocol.sha256;
    const r={passed:false,checks:[],before:Array.from(ps.app.documents).map(d=>({id:d.id,width:Number(d.width),height:Number(d.height)})),samples:[],errors:[]};
    const active=ps.app.documents.length?ps.app.activeDocument.id:null,owned=new Set();let saved;
    const check=(yes,name)=>{if(!yes)throw Error(name);r.checks.push(name)};
    async function inspect(doc,name){await execution.activateDocument(doc);const info=await docs.getActiveDocumentInfo();
      check(info.id===doc.id,'production getActiveDocumentInfo binds own '+name);const m=info.sourceMetadata,description=identity.describeSourceIdentity(info),fields={};
      for(const key of ['serialNumber','captureDate','captureSubsecond','captureOffsetTime','imageUniqueId','originalDocumentId']){const value=String(m[key]||'');fields[key]={present:!!value,sha256:value?sha(value):null};}
      const item={name,fields,identityPresent:!!description.key,identityStrength:description.strength,identitySha256:description.key?sha(description.key):null,oldIdentityPresent:!!beforeIdentity(info),subsecond:m.captureSubsecond,inlineFraction:(String(m.captureDate).match(/\\.(\\d+)/)||[])[1]||'',offsetPresent:!!m.captureOffsetTime||/[+-]\\d{2}:?\\d{2}$/.test(m.captureDate||'')};r.samples.push(item);return {info,item,key:description.key};}
    try{
      const folder=await storage.localFileSystem.getPluginFolder();let doc;
      await execution.executeAsModal(async()=>{doc=await ps.app.open(await folder.getEntry('fresh-original.jpg'))},'核对未保存原片副本');
      r.openDiagnostic={returnedId:doc&&doc.id,documents:Array.from(ps.app.documents).map(d=>({id:d.id,name:d.name})),returnedType:typeof doc,returnedKeys:doc?Object.keys(doc):[]};
      check(doc&&doc.id!=null&&!r.before.some(d=>d.id===doc.id),'private original is independently owned');owned.add(doc.id);
      const fresh=await inspect(doc,'fresh');
      check(!fresh.info.sourceMetadata.imageUniqueId&&!fresh.info.sourceMetadata.originalDocumentId,'actual fresh host XMP has neither strong ID');
      check(!fresh.item.oldIdentityPresent,'pre-fix production identity reproduces empty identity');
      check(!!fresh.key&&fresh.item.identityStrength==='capture-subsecond','fixed identity accepts actual fresh camera subsecond');
      check(fresh.info.sourceMetadata.model==='Canon EOS R6 Mark III','real host model is R6 Mark III');
      check(identity.getSourceIdentity(Object.assign({},fresh.info,{name:'renamed.psd',widthPx:638,heightPx:898}))===fresh.key,'names and dimensions do not change original capture');
      check(!identity.getSourceIdentity({sourceMetadata:Object.assign({},fresh.info.sourceMetadata,{captureSubsecond:'',captureDate:fresh.info.sourceMetadata.captureDate.replace(/\\.\\d+/,'')})}),'no subsecond and no strong ID remains ineligible for fallback');
      const data=await storage.localFileSystem.getDataFolder();saved=await data.createFile('resaved-'+Date.now()+'.jpg',{overwrite:false});
      await execution.executeAsModal(async()=>{await doc.saveAs.jpg(saved,{quality:10},true)},'保存本次私有身份核对副本');
      await docs.closeWithoutSaving(doc);owned.delete(doc.id);
      let reopened;await execution.executeAsModal(async()=>{reopened=await ps.app.open(saved)},'重开本次私有副本');owned.add(reopened.id);
      const after=await inspect(reopened,'saved-reopened');
      check(!!after.info.sourceMetadata.originalDocumentId,'Photoshop save adds OriginalDocumentID');
      check(after.key===fresh.key,'same source identity before first save and after adding strong ID');
      check(identity.normalizeCaptureTime('2026-10-15T10:49:15.053+08:00','53')===identity.normalizeCaptureTime('2026:10:15 10:49:15','53','+08:00'),'EXIF53 and known Photoshop millisecond padding normalize equally');
      await docs.closeWithoutSaving(reopened);owned.delete(reopened.id);r.passed=true;
    }catch(e){r.error=String(e);r.stack=e.stack}finally{
      for(const d of Array.from(ps.app.documents))if(owned.has(d.id)&&!r.before.some(x=>x.id===d.id)){try{await docs.closeWithoutSaving(d);owned.delete(d.id)}catch(e){r.errors.push(String(e))}}
      const previous=Array.from(ps.app.documents).find(d=>d.id===active);if(previous)await execution.activateDocument(previous);
      r.after=Array.from(ps.app.documents).map(d=>({id:d.id,width:Number(d.width),height:Number(d.height)}));r.userDocumentsPreserved=r.before.every(x=>r.after.some(d=>d.id===x.id&&d.width===x.width&&d.height===x.height));
      r.ownedDocumentsClosed=owned.size===0;r.activeRestored=active===null||ps.app.activeDocument.id===active;
      if(saved&&r.ownedDocumentsClosed)await saved.delete();r.passed=r.passed&&r.userDocumentsPreserved&&r.ownedDocumentsClosed&&r.activeRestored&&!r.errors.length;hostWindow.probeStatus={pending:false,report:r};}
    return r;};})(window);`;
  fs.writeFileSync(path.join(staging,'probe.js'),runtime);
  fs.writeFileSync(path.join(staging,'manifest.json'),JSON.stringify({manifestVersion:5,id:'com.yx.freshidentity.r68',name:'Isolated fresh capture identity',version:'0.0.1',main:'index.html',host:{app:'PS',minVersion:'25.0.0',data:{apiVersion:2}},requiredPermissions:{localFileSystem:'request'},entrypoints:[{type:'panel',id:'fresh-probe',label:{default:'Fresh capture probe'}}]},null,2));
  fs.writeFileSync(path.join(staging,'index.html'),'<html><body><script src="probe.js"></script></body></html>');
  session=await deadline(client.loadPlugin({manifest:path.join(staging,'manifest.json'),apps:[selector],breakOnStart:false}),15000,'Probe load');session.commitToRc(staging);
  const debug=await client.debugPlugin(session,{apps:[selector]});debuggerClient=await debuggerConnection(debug[0].cdtDebugWsUrl);
  await debuggerClient.evaluate("window.probeStatus={pending:true};window.runProbe().catch(error=>window.probeStatus={pending:false,report:{passed:false,error:String(error),stack:error.stack}});'started'");report.hostStarted=true;
  let status;for(let i=0;i<120;i++){status=await debuggerClient.evaluate('window.probeStatus');if(status&&!status.pending&&status.report)break;await delay(500)}
  assert.ok(status&&status.report,'Host did not complete; do not force close user documents');report.host=status.report;save('host-report.json',report.host);assert.ok(report.host.passed,report.host.error);report.passed=true;
}
main().catch(e=>{report.error=String(e);report.stack=e.stack}).finally(async()=>{
  if(debuggerClient)debuggerClient.close();
  if(session&&(!report.hostStarted||report.host?.ownedDocumentsClosed)){try{await client.unloadPlugin(session,{apps:[]});report.probeUnloaded=true}catch(e){report.unloadError=String(e);report.passed=false}}
  if(ownedCopy&&(!report.hostStarted||report.host?.ownedDocumentsClosed)){fs.unlinkSync(ownedCopy);report.privateOriginalRemoved=true}
  report.originalBytesPreserved=hash(fs.readFileSync(input))===report.sourceSha256;
  report.sourceModulesUnchanged=report.sourceBindings.every(b=>hash(fs.readFileSync(path.join(plugin,'src',b.module+'.js')))===b.sha256);
  report.passed=report.passed&&report.originalBytesPreserved&&report.sourceModulesUnchanged;
  if(client)try{client.disconnect()}catch(e){report.disconnectToolError=String(e)}
  report.finished=new Date().toISOString();save('summary.json',report);console.log(JSON.stringify({passed:report.passed,hostChecks:report.host?.checks.length,error:report.error,originalBytesPreserved:report.originalBytesPreserved}));process.exit(report.passed?0:1);
});

