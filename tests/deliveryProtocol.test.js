const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function load() { const c={window:{},Uint8Array,DataView,Int32Array};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core/deliveryProtocol.js'),'utf8'),c);return c.window.IDPhotoDeliveryProtocol; }
test('handoff fingerprint matches standard SHA-256 for UTF8 and JPEG block boundaries',()=>{
  const p=load();
  for(const value of ['', '福清印象 A2B3C4', ...[1,55,56,63,64,65,49152,2097152,8388608].map(n=>crypto.randomBytes(n))]) {
    assert.equal(p.sha256(value),crypto.createHash('sha256').update(value).digest('hex'));
  }
});
test('crossed and stale receipts cannot attach another customer code; missing or invalid receipt stays pending',()=>{
  const p=load(),a={id:p.id(),fingerprint:p.sha256('a'),confirmationId:p.id()},b={id:p.id(),fingerprint:p.sha256('b'),confirmationId:p.id()};
  const r={version:2,requestId:a.confirmationId,confirmed:true,status:'ready',contextKey:'ctx-a',taskId:a.id,manifestFingerprint:a.fingerprint,accepted:true,deliveryId:'delivery-a',code:'A2B3C4'};
  assert.equal(p.confirmedCode(r,a),'A2B3C4');assert.equal(p.confirmedCode(r,b),'');
  for(const changed of [{taskId:b.id},{manifestFingerprint:b.fingerprint},{accepted:false},{deliveryId:''},{code:'ABCDEF'},{code:'123456'},{code:'I2B3C4'},{code:'L2B3C4'},{version:1}]) assert.equal(p.confirmedCode({...r,...changed},a),'');
  assert.equal(p.confirmedCode(null,a),'');assert.match(a.id,/^[a-f0-9]{32}$/);assert.notEqual(a.id,b.id);
});

test('A B C out-of-order receipts and replay preserve separate stable task identities',()=>{
  const p=load(),tasks=['A','B','C'].map(label=>({id:p.id(),fingerprint:p.sha256(label),confirmationId:p.id()}));
  const receipts=tasks.map((t,i)=>({version:2,requestId:t.confirmationId,confirmed:true,status:"preparing",contextKey:"ctx-a",accepted:true,taskId:t.id,manifestFingerprint:t.fingerprint,deliveryId:'delivery-'+i,code:['A2B3C4','D5E6F7','G8H9J2'][i]}));
  for(const index of [2,0,1,2,1,0])for(let i=0;i<tasks.length;i++)assert.equal(p.confirmedCode(receipts[index],tasks[i]),i===index?receipts[index].code:'');
  assert.equal(new Set(tasks.map(t=>t.id)).size,3);
});

test('fresh confirmation requires request nonce, original connection and delivery; cache or terminal is never authority',()=>{
 const p=load(),task={id:p.id(),fingerprint:p.sha256('r1'),confirmationId:p.id(),contextKey:'ctx-a',deliveryId:'delivery-a'};
 const r={version:2,taskId:task.id,manifestFingerprint:task.fingerprint,accepted:true,requestId:task.confirmationId,contextKey:'ctx-a',deliveryId:'delivery-a',status:'ready',confirmed:true,code:'A2B3C4'};
 assert.equal(p.confirmedCode(r,task),'A2B3C4');
 for(const change of [{version:1},{requestId:p.id()},{requestId:''},{contextKey:'ctx-b'},{deliveryId:'delivery-b'},{status:'cancelled'},{status:'withdrawn'},{confirmed:false}])assert.equal(p.confirmedCode({...r,...change},task),'');
});

// 10-28: the per-order mini-program link is printed only when it belongs to this very code
// and is a WeChat short link both code styles can hold (at most 74 characters).
test('an entry link counts only for its own code and in the WeChat short-link shape',()=>{
  const p=load(),link='https://mp.weixin.qq.com/a/~~WdSuO5i0uQ4~WhUnbj16GNTjF-XyoACd7A~~',code='CKCJW7';
  assert.equal(p.entryLink({entryLink:link,entryLinkCode:code},code).link,link);
  assert.equal(p.entryLink({entryLink:'https://mp.weixin.qq.com/a/~ECctIh1ILr7RP5ZRcuuT8A~~',entryLinkCode:code},code).link.length,52);
  const longest='https://mp.weixin.qq.com/a/~~'+'a'.repeat(43)+'~~';
  assert.equal(longest.length,74);assert.equal(p.entryLink({entryLink:longest,entryLinkCode:code},code).link,longest);
  for(const [receipt,reason] of [
    [{},/没有专属链接/],[null,/没有专属链接/],[{entryLink:'',entryLinkCode:code},/没有专属链接/],
    [{entryLink:link},/不属于本单/],[{entryLink:link,entryLinkCode:'A2B3C4'},/不属于本单/],
    [{entryLink:longest.replace('~~a','~~aa'),entryLinkCode:code},/格式不对/],
    [{entryLink:link.replace('https','http'),entryLinkCode:code},/格式不对/],
    [{entryLink:link.replace('qq.com','qq.com.evil.cn'),entryLinkCode:code},/格式不对/],
    [{entryLink:link+'?code=A2B3C4',entryLinkCode:code},/格式不对/],
    [{entryLink:link.replace('Wd','W d'),entryLinkCode:code},/格式不对/],
    [{entryLink:link.slice(0,-1),entryLinkCode:code},/格式不对/],
    [{entryLink:[link],entryLinkCode:code},/格式不对/]]) {
    const result=p.entryLink(receipt,code);
    assert.equal(result.link,'',JSON.stringify(receipt));assert.match(result.reason,reason);assert.equal(result.code,code);
  }
  // An invalid pickup code never carries a link, even one that names it.
  assert.equal(p.entryLink({entryLink:link,entryLinkCode:'ABCDEF'},'ABCDEF').link,'');
});
