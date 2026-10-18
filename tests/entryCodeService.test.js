const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// The entry code ships with the plugin: the real bundled bytes are checked, and only the opened copy is closed.
function harness({width,height,flattenFail=false,tamper=false}={}) {
  const original={id:1},closed=[],events=[],opened=[];
  const assets=path.join(__dirname,'..','src','assets');
  const entry=name=>({name,read:async()=>{const b=fs.readFileSync(path.join(assets,name));if(tamper)b[b.length-1]^=1;return b.buffer.slice(b.byteOffset,b.byteOffset+b.length);}});
  const dir=children=>({getEntry:async name=>{if(!children[name])throw Error('missing '+name);return children[name];}});
  const plugin=dir({src:dir({assets:dir({'entry-code.png':entry('entry-code.png'),'entry-code-coarse.png':entry('entry-code-coarse.png')})})});
  let sequence=1;
  const app={documents:[original],async open(file){opened.push(file.name);const size=file.name.includes('coarse')?990:1290;
    const doc={id:++sequence,width:width||size,height:height||size};app.documents.push(doc);return doc;}};
  const window={IDPhotoPhotoshopExecution:{executeAsModal:async callback=>callback(),getPhotoshop:()=>({app}),
      activateDocument:async doc=>{assert.notEqual(doc.id,original.id);},batchPlay:async commands=>{events.push(commands[0]._obj);if(flattenFail)throw Error('flatten failed');}},
    IDPhotoDocumentService:{closeWithoutSaving:async doc=>{assert.notEqual(doc.id,original.id);closed.push(doc.id);app.documents=app.documents.filter(d=>d!==doc);}}};
  const context=vm.createContext({window,console:{warn(){}},Uint8Array,require:()=>({storage:{formats:{binary:'binary'},localFileSystem:{getPluginFolder:async()=>plugin}}})});
  for(const p of ['core/deliveryProtocol','photoshop/entryCodeService'])vm.runInContext(fs.readFileSync(__dirname+'/../src/'+p+'.js','utf8'),context);
  return {service:window.IDPhotoEntryCodeService,original,closed,events,opened,app};
}
test('both bundled code images open as their own flattened copy and close without touching the original',async()=>{
  for(const [variant,file,size] of [['logo','entry-code.png',1290],['coarse','entry-code-coarse.png',990]]) {
    const h=harness();
    const doc=await h.service.open(variant);
    assert.deepEqual(h.opened,[file]);assert.equal(doc.width,size);assert.deepEqual(h.events,['flattenImage']);
    await h.service.close(doc);
    assert.deepEqual(h.app.documents,[h.original]);
  }
  const h=harness();await h.service.open();assert.deepEqual(h.opened,['entry-code.png']);
  await assert.rejects(h.service.open('sun'),/未知/);
});
test('damaged bytes or a wrong size never print, and the opened copy is closed',async()=>{
  const damaged=harness({tamper:true});
  await assert.rejects(damaged.service.open('logo'),/损坏/);assert.deepEqual(damaged.opened,[]);
  const wrong=harness({width:1290,height:1200});
  await assert.rejects(wrong.service.open('logo'),/尺寸/);
  assert.deepEqual(wrong.app.documents,[wrong.original]);assert.equal(wrong.closed.length,1);
});
test('flatten failure closes the newly opened asset and preserves the original document',async()=>{
  const h=harness({flattenFail:true});
  await assert.rejects(h.service.open('coarse'),/flatten failed/);
  assert.deepEqual(h.app.documents,[h.original]);
});
