import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGateway} from './server.mjs';
const genesis='local-genesis',wire=Buffer.alloc(200,1).toString('base64');
async function fixture(t,{enabled=true,wrongGenesis=false,fail=false}={}){
 let sends=0;
 const upstream=http.createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;
  const b=JSON.parse(text);res.setHeader('Content-Type','application/json');
  if(b.method==='getGenesisHash')return res.end(JSON.stringify({result:wrongGenesis?'wrong':genesis}));
  sends++;
  res.end(JSON.stringify(fail?{error:{message:'SECRET_UPSTREAM_CREDENTIAL'}}:{result:'signed-transaction'}));
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const gateway=createGateway({upstream:`http://127.0.0.1:${upstream.address().port}`,transactions:enabled,localTest:true,expectedGenesis:genesis});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>gateway.close(r));await new Promise(r=>upstream.close(r));});
 return {sends:()=>sends,call:async()=>{
  const response=await fetch(`http://127.0.0.1:${gateway.address().port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'sendTransaction',params:[wire,{encoding:'base64'}]})});
  return {status:response.status,body:await response.json()};
 }};
}
test('submission disabled by default and wrong chain rejected before relay',async(t)=>{
 for(const options of [{enabled:false},{wrongGenesis:true}]){
  const f=await fixture(t,options);assert((await f.call()).body.error);assert.equal(f.sends(),0);
 }
});
test('submissions are not cached and have separate rate budget',async(t)=>{
 const f=await fixture(t);
 for(let i=0;i<6;i++)assert.equal((await f.call()).body.result,'signed-transaction');
 assert.equal((await f.call()).status,429);assert.equal(f.sends(),6);
});
test('provider error details never escape gateway',async(t)=>{
 const f=await fixture(t,{fail:true});const result=await f.call();
 assert(result.body.error);assert(!JSON.stringify(result).includes('SECRET_UPSTREAM_CREDENTIAL'));
});
