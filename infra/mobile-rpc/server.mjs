import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {checkedRequest} from './policy.mjs';
export function createGateway({upstream,transactions=false,expectedGenesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',localTest=false}) {
const url=new URL(upstream);
if((url.protocol!=='https:'&&!(localTest&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))||url.username||url.password||url.hash)throw Error('Invalid upstream configuration');
let genesisCheckedAt=0;
const sends=new Map();let sendCount=0;
const cache=new Map(),rates=new Map();let windowAt=Date.now(),globalCount=0,active=0;
const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const error=(res,status,id,message)=>reply(res,status,{jsonrpc:'2.0',id:id??null,error:{code:-32000,message}});
const server=http.createServer(async(req,res)=>{
 if(req.url==='/health'&&req.method==='GET')return reply(res,200,{mode:transactions?'transactions':'read-only',status:'alive'});
 if(req.url!=='/'||req.method!=='POST')return error(res,405,null,'POST required');
 if(!String(req.headers['content-type']??'').startsWith('application/json'))return error(res,415,null,'JSON required');
 const now=Date.now();if(now-windowAt>=60000){rates.clear();sends.clear();sendCount=0;globalCount=0;windowAt=now;}
 const peer=req.socket.remoteAddress?.replace(/^::ffff:/,'');
 const ip=peer==='172.29.6.254'?String(req.headers['x-forwarded-for']??peer):peer;
 const count=(rates.get(ip)??0)+1;
 if(rates.size>=2000&&!rates.has(ip))return error(res,429,null,'Rate limit');
 rates.set(ip,count);
 if(count>120||++globalCount>600||active>=8)return error(res,429,null,'Rate limit; retry later');
 let id=null;
 try{
   let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384){error(res,413,null,'Request too large');return;}chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));id=body.id;
   const checked=checkedRequest(body,transactions),key=JSON.stringify([checked.method,checked.params]);
   if(checked.method==='sendTransaction'){
     const sent=(sends.get(ip)??0)+1;sends.set(ip,sent);
     if(sent>6||++sendCount>60)return error(res,429,id,'Submission rate limit');
   }
   const old=cache.get(key);if(old&&old.expires>now)return reply(res,200,{jsonrpc:'2.0',id,result:old.result});
   if(active>=8)return error(res,429,id,'Rate limit; retry later');
   active++;
   try{
     if(checked.method==='sendTransaction'&&Date.now()-genesisCheckedAt>60000){
       const check=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getGenesisHash',params:[]})});
       let size=0,parts=[];for await(const chunk of check.body){size+=chunk.length;if(size>4096)throw Error('Genesis response limit');parts.push(chunk);}
       if(!check.ok||JSON.parse(Buffer.concat(parts).toString('utf8')).result!==expectedGenesis)return error(res,503,id,'Network unavailable');
       genesisCheckedAt=Date.now();
     }
     const upstream=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:checked.method,params:checked.params})});
     if(!upstream.ok){await upstream.body?.cancel();return error(res,503,id,'RPC temporarily unavailable');}
     let size=0,parts=[];for await(const chunk of upstream.body){size+=chunk.length;if(size>262144)throw Error('Response limit');parts.push(chunk);}
     const result=JSON.parse(Buffer.concat(parts).toString('utf8'));
     if(result.error||!Object.hasOwn(result,'result'))return error(res,503,id,'RPC temporarily unavailable');
     if(checked.method==='getGenesisHash'&&result.result!==expectedGenesis)return error(res,503,id,'Network unavailable');
     if(checked.ttl>0){
       if(cache.size>=512)cache.delete(cache.keys().next().value);
       cache.set(key,{expires:Date.now()+checked.ttl,result:result.result});
     }
     reply(res,200,{jsonrpc:'2.0',id,result:result.result});
   }finally{active--;}
 }catch{error(res,400,id,'Request rejected or RPC unavailable');}
});
server.requestTimeout=15000;server.headersTimeout=10000;
return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 createGateway({upstream:process.env.RPC_UPSTREAM,transactions:process.env.RPC_TRANSACTIONS_ENABLED==='true'}).listen(8080,'0.0.0.0');
}
