const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness({width=900,height=900,flattenFail=false}={}) {
  const files=new Map(),settings=new Map(),original={id:1},closed=[],events=[];
  const source={name:'本店入口.png',read:async()=>new Uint8Array([137,80,78,71,13,10]).buffer};
  const folder={async createFile(name){const file={name,read:async()=>file.bytes,write:async bytes=>{file.bytes=bytes;}};files.set(name,file);return file;},async getEntry(name){if(!files.has(name))throw Error('missing');return files.get(name);}};
  let sequence=1;
  const app={documents:[original],async open(){const doc={id:++sequence,width,height};app.documents.push(doc);return doc;}};
  const window={localStorage:{getItem:key=>settings.get(key),setItem:(key,value)=>settings.set(key,value),removeItem:key=>settings.delete(key)},
    IDPhotoPhotoshopExecution:{executeAsModal:async callback=>callback(),getPhotoshop:()=>({app}),
      activateDocument:async doc=>{assert.notEqual(doc.id,original.id);},batchPlay:async commands=>{events.push(commands[0]._obj);if(flattenFail)throw Error('flatten failed');}},
    IDPhotoDocumentService:{closeWithoutSaving:async doc=>{assert.notEqual(doc.id,original.id);closed.push(doc.id);app.documents=app.documents.filter(d=>d!==doc);}}};
  const context=vm.createContext({window,require:()=>({storage:{formats:{binary:'binary'},localFileSystem:{getFileForOpening:async()=>source,getDataFolder:async()=>folder}}})});
  for(const path of ['core/deliveryProtocol','photoshop/entryCodeService'])vm.runInContext(fs.readFileSync(__dirname+'/../src/'+path+'.js','utf8'),context);
  return {service:window.IDPhotoEntryCodeService,files,settings,original,closed,events,app};
}
test('entry asset is absent by default, requires explicit verification, and closes only owned decoded copies',async()=>{
  const h=harness();
  assert.match(h.service.label(),/未配置/);
  await h.service.withAsset(async doc=>assert.equal(doc,null));
  await assert.rejects(h.service.configure(false),/先确认/);assert.equal(h.files.size,0);
  const value=await h.service.configure(true);assert.equal(value.verified,true);assert.equal(h.closed.length,1);
  await h.service.withAsset(async doc=>{assert.notEqual(doc.id,h.original.id);assert.equal(doc.width,900);});
  assert.equal(h.closed.length,2);assert.deepEqual(h.events,['flattenImage','flattenImage']);
  assert.deepEqual(h.app.documents,[h.original]);
  h.service.clear();await h.service.withAsset(async doc=>assert.equal(doc,null));
});
test('changed bytes, invalid size, and render failure cannot substitute a stale or unverified code image',async()=>{
  for(const size of [{width:424,height:424},{width:900,height:800}]) {
    const h=harness(size);await assert.rejects(h.service.configure(true),/完整正方形/);
    assert.equal(h.settings.size,0);assert.equal(h.closed.length,1);
  }
  const h=harness(),value=await h.service.configure(true);
  await assert.rejects(h.service.withAsset(async()=>{throw Error('render failure');}),/render failure/);
  assert.equal(h.closed.length,2);
  h.files.get(value.file).bytes=new Uint8Array([1,2,3]).buffer;
  await assert.rejects(h.service.withAsset(async()=>assert.fail('tampered asset must not render')),/发生变化/);
  assert.deepEqual(h.app.documents,[h.original]);
});
test('flatten failure closes the newly opened asset and preserves the original document',async()=>{
  const h=harness({flattenFail:true});
  // Failure after app.open must not escape ownership cleanup.
  await assert.rejects(h.service.configure(true),/flatten failed/);
  assert.deepEqual(h.app.documents,[h.original]);assert.equal(h.settings.size,0);
});
