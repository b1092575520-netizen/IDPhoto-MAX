const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// The entry code is drawn from its link; Settings can swap the link by reading a square code image once.
const root=path.join(__dirname,'..');
function harness({logoBytes,picture,cancel=false,putPixels=true}={}) {
  const store=new Map(),original={id:1,name:'客人照片'},closed=[],puts=[],disposed=[];
  const logo=logoBytes||fs.readFileSync(path.join(root,'src','assets','entry-logo.rgb'));
  const dir=children=>({getEntry:async name=>{if(!children[name])throw Error('missing '+name);return children[name];}});
  const plugin=dir({src:dir({assets:dir({'entry-logo.rgb':{read:async()=>logo.buffer.slice(logo.byteOffset,logo.byteOffset+logo.length)}})})});
  let sequence=1;
  const app={documents:[original],async open(){const doc={id:++sequence,width:picture.width,height:picture.height};app.documents.push(doc);return doc;}};
  const imaging={
    async createImageDataFromBuffer(buffer,options){return {buffer,options,dispose(){disposed.push(options.width);}};},
    async getPixels(){return {imageData:{width:picture.width,height:picture.height,components:3,getData:async()=>picture.rgb,dispose(){disposed.push('read');}}};}
  };
  if(putPixels) imaging.putPixels=async args=>{puts.push(args);};
  const window={localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    IDPhotoPhotoshopExecution:{executeAsModal:async cb=>cb(),getPhotoshop:()=>({app})},
    IDPhotoDocumentService:{closeWithoutSaving:async doc=>{assert.notEqual(doc.id,original.id);closed.push(doc.id);app.documents=app.documents.filter(d=>d!==doc);}}};
  const context=vm.createContext({window,console:{warn(){},log(){}},Uint8Array,Uint8ClampedArray,
    require:name=>name==='photoshop'?{imaging}:{storage:{formats:{binary:'binary'},localFileSystem:{getPluginFolder:async()=>plugin,getFileForOpening:async()=>cancel?null:{name:'新码.png'}}}}});
  for(const f of ['src/core/deliveryProtocol.js','src/vendor/qrcode-generator.js','src/vendor/jsQR.js','src/core/entryCodeMatrix.js','src/photoshop/entryCodeService.js'])
    vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});
  return {service:window.IDPhotoEntryCodeService,code:window.IDPhotoEntryCode,decode:window.IDPhotoQrDecode,window,store,app,original,closed,puts,disposed};
}
function picture(code,text,variant='coarse',size=330){
  const r=code.render({text,variant,size});return {width:size,height:size,rgb:r.pixels};
}
function rgba(rgb,size){const out=new Uint8ClampedArray(size*size*4);for(let i=0;i<size*size;i++){out[i*4]=rgb[i*3];out[i*4+1]=rgb[i*3+1];out[i*4+2]=rgb[i*3+2];out[i*4+3]=255;}return out;}

test('both drawings of the store link read back as the link at every card size and turn',()=>{
  const h=harness(),logo={data:fs.readFileSync(path.join(root,'src','assets','entry-logo.rgb')),width:240};
  assert.equal(h.code.matrix(h.code.DEFAULT_TEXT,'Q').count,37);
  assert.equal(h.code.matrix(h.code.DEFAULT_TEXT,'L').count,29);
  for(const [variant,size,turn] of [['logo',480,''],['logo',480,'ccw'],['logo',355,''],['logo',292,'ccw'],['coarse',214,''],['coarse',180,'ccw']]) {
    const r=h.code.render({variant,size,turn,logo});
    assert.equal(r.pixels.length,size*size*3);
    assert.equal(h.decode(rgba(r.pixels,size),size,size).data,h.code.DEFAULT_TEXT,variant+' '+size+' '+turn);
  }
  assert.throws(()=>h.code.render({variant:'sun',size:200}),/未知/);
});
test('the default code is drawn in place with the store logo; the pixels are released',async()=>{
  const h=harness(),prepared=await h.service.prepare();
  assert.equal(prepared.custom,false);assert.equal(prepared.logo.width,240);
  const layers=[],doc={id:7,createLayer:async(kind,o)=>{const l={id:9,kind,name:o.name};layers.push(l);return l;}};
  const layer=await h.service.draw(doc,prepared,{x:3000,y:100,width:214,height:214},{variant:'coarse',turn:'ccw',name:'完整小程序码'});
  assert.equal(layer.name,'完整小程序码');assert.equal(layers[0].kind,'pixel');
  assert.deepEqual(JSON.parse(JSON.stringify(h.puts[0].targetBounds)),{left:3000,top:100});
  assert.equal(h.puts[0].documentID,7);assert.equal(h.puts[0].layerID,9);
  assert.equal(h.puts[0].imageData.buffer.length,214*214*3);
  assert.deepEqual(h.disposed,[214]);
});
test('a damaged logo still prints the code without it; a Photoshop without pixel drawing prints no code',async()=>{
  const broken=harness({logoBytes:Buffer.alloc(240*240*3)});
  const prepared=await broken.service.prepare();
  assert.equal(prepared.logo,null);
  await assert.rejects(harness({putPixels:false}).service.prepare(),/不能直接画/);
});
test('Settings replaces the code from a square image, closes only that picture, and can go back',async()=>{
  const base=harness(),text='https://mp.weixin.qq.com/a/~NEWcode123~~';
  const h=harness({picture:picture(base.code,text)});
  assert.match(h.service.label(),/本店默认/);
  const result=await h.service.replaceFromImage();
  assert.equal(result.text,text);
  assert.deepEqual(h.app.documents,[h.original]);assert.equal(h.closed.length,1);assert.ok(h.disposed.includes('read'));
  assert.equal(h.service.current().custom,true);assert.match(h.service.label(),/已更换/);
  const prepared=await h.service.prepare();
  assert.equal(prepared.text,text);assert.equal(prepared.logo,null,'a replaced code carries no store logo');
  h.service.reset();
  assert.equal(h.service.current().text,h.code.DEFAULT_TEXT);
  const again=harness({picture:picture(base.code,base.code.DEFAULT_TEXT,'logo',430)});
  await again.service.replaceFromImage();
  assert.equal(again.store.size,0,'choosing the store code again simply keeps the default');
});
test('a cancelled picker, a blank picture or a non-link code keeps the current code',async()=>{
  const base=harness();
  const cancelled=harness({cancel:true});
  assert.equal((await cancelled.service.replaceFromImage()).cancelled,true);
  const blank=harness({picture:{width:200,height:200,rgb:new Uint8Array(200*200*3).fill(255)}});
  await assert.rejects(blank.service.replaceFromImage(),/没认出二维码/);
  assert.equal(blank.store.size,0);assert.deepEqual(blank.app.documents,[blank.original]);
  const plain=harness({picture:picture(base.code,'店铺电话 13003825982')});
  await assert.rejects(plain.service.replaceFromImage(),/不是小程序链接/);
  assert.equal(plain.store.size,0);
});

// 10-28: the order's own link (delivery manager candidate 38).
const ORDER_LINK='https://mp.weixin.qq.com/a/~~WdSuO5i0uQ4~WhUnbj16GNTjF-XyoACd7A~~';
test('the order\'s own link is a fixed version 6 / version 4 code with the logo that reads back at every card size',async()=>{
  const h=harness(),prepared=await h.service.prepare({entryLink:{code:'CKCJW7',link:ORDER_LINK,reason:''},pickupCode:'CKCJW7'});
  assert.equal(prepared.exclusive,true);assert.equal(prepared.text,ORDER_LINK);assert.equal(prepared.logo.width,240);assert.equal(prepared.custom,false);
  assert.equal(h.code.render({text:ORDER_LINK,variant:'logo',size:470,exclusive:true}).count,41);
  assert.equal(h.code.render({text:ORDER_LINK,variant:'coarse',size:370,exclusive:true}).count,33);
  for(const [variant,size,turn] of [['logo',480,''],['logo',480,'ccw'],['logo',398,''],['logo',355,''],['logo',292,'ccw'],['coarse',214,''],['coarse',180,'ccw']])
    assert.equal(h.service.readsBack(prepared,size,{variant,turn}),true,variant+' '+size+' '+turn);
  // What is drawn is exactly what was read back.
  const doc={id:7,createLayer:async(kind,o)=>({id:9,kind,name:o.name})};
  await h.service.draw(doc,prepared,{x:3394,y:0,width:180,height:180},{variant:'coarse',turn:'ccw'});
  const drawn=h.puts[0].imageData.buffer;
  assert.equal(h.decode(rgba(drawn,180),180,180).data,ORDER_LINK);
  assert.deepEqual(Array.from(drawn),Array.from(h.code.render({text:ORDER_LINK,variant:'coarse',size:180,turn:'ccw',logo:prepared.logo,exclusive:true}).pixels));
});
test('anything doubtful about the order\'s link prints the store code and says why',async()=>{
  const h=harness(),entry={code:'CKCJW7',link:ORDER_LINK,reason:''};
  for(const [options,reason] of [
    [{pickupCode:'CKCJW7'},/没有专属链接/],
    [{entryLink:entry,pickupCode:'A2B3C4'},/不属于本单/],
    [{entryLink:{code:'CKCJW7',link:'',reason:'回执里没有专属链接'},pickupCode:'CKCJW7'},/回执里没有/],
    [{entryLink:{code:'CKCJW7',link:ORDER_LINK+'x',reason:''},pickupCode:'CKCJW7'},/格式不对/],
    [{entryLink:entry,pickupCode:'CKCJW7',allowExclusive:false},/先印通用码/],
    [{entryLink:entry,pickupCode:'CKCJW7',fallbackReason:'专属码回读和链接不一致'},/回读/]]) {
    const prepared=await h.service.prepare(options);
    assert.equal(prepared.exclusive,false,JSON.stringify(options));assert.equal(prepared.text,h.code.DEFAULT_TEXT);
    assert.match(prepared.reason,reason);assert.equal(prepared.logo.width,240);
  }
  const prepared=await h.service.prepare({entryLink:entry,pickupCode:'CKCJW7'});
  h.window.IDPhotoQrDecode=()=>({data:ORDER_LINK.slice(0,-2)});
  assert.equal(h.service.readsBack(prepared,180,{variant:'coarse',turn:'ccw'}),false,'a different reading is refused');
  h.window.IDPhotoQrDecode=()=>null;
  assert.equal(h.service.readsBack(prepared,214,{variant:'coarse'}),false,'no reading is refused');
});
