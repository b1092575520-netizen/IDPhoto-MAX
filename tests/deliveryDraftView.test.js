const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 class Element{
  constructor(){this.children=[];this.events={};this.attributes={};this.style={};this.textContent='';this.value='';}
  set value(v){this._value=String(v);}get value(){return this._value;}
  appendChild(e){this.children.push(e);} removeChild(e){this.children=this.children.filter(x=>x!==e);}
  setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
  addEventListener(k,fn){this.events[k]=fn;}
  querySelectorAll(selector){return this.children.flatMap(e=>[...(selector==='input'&&e.type?[e]:[]),...e.querySelectorAll(selector)]);}
  async click(){return this.events.click();}
 }
 const elements=new Map(),document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()};
 let current=10;const generated=[];const target={version:1,deliveryId:'a'.repeat(64),contextKey:'b'.repeat(64),groupVersion:0,title:'同行',code:'A23456',preview:'data:image/jpeg;base64,eA=='};
 const window={IDPhotoDeliverySpecifications:{target:x=>x}};
 vm.runInNewContext(fs.readFileSync('src/ui/deliveryDraftView.js','utf8'),{window,document,require:()=>({storage:{formats:{utf8:'utf8'},localFileSystem:{getFileForOpening:async()=>({read:async()=>JSON.stringify(target)})}}})});
 window.IDPhotoDeliveryDraftView.create({currentDocumentId:()=>current,generate:async(specs,target)=>generated.push({specs,target})});
 return{get:document.getElementById,generated,setDocument:id=>{current=id;}};
}
test('multi draft UI clears the selected target after generation and rejects a switched customer',async()=>{
 const h=harness();await h.get('multiDeliveryButton').click();await h.get('chooseDeliveryTarget').click();h.setDocument(11);
 await h.get('generateDeliveryDraft').click();assert.equal(h.generated.length,0);assert.match(h.get('multiDeliveryStatus').textContent,/已切换/);
 await h.get('generateDeliveryDraft').click();assert.equal(h.generated.length,1);assert.equal(h.generated[0].target,null);
 await h.get('chooseDeliveryTarget').click();await h.get('generateDeliveryDraft').click();assert.equal(h.generated[1].target.deliveryId,'a'.repeat(64));
 await h.get('generateDeliveryDraft').click();assert.equal(h.generated[2].target,null);
 await h.get('chooseDeliveryTarget').click();await h.get('closeMultiDelivery').click();await h.get('multiDeliveryButton').click();
 await h.get('generateDeliveryDraft').click();assert.equal(h.generated[3].target,null);
});
