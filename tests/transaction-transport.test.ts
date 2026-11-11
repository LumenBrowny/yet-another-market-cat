import {test} from "node:test";
import assert from "node:assert/strict";
import {getBase58Decoder} from "@solana/kit";
import type {SignatureStatus} from "@solana/web3.js";
import {submitAndConfirm} from "../app/src/transactionTransport";

const bytes = new Uint8Array(64).fill(1), signature=getBase58Decoder().decode(bytes);
function fixture(statuses: (Partial<SignatureStatus> | Error | null)[], sendFails=false, height=1) {
 let now=0,sends=0,reads=0;
 const rpc:Parameters<typeof submitAndConfirm>[0]={
  sendRawTransaction:async()=>{sends++;if(sendFails)throw Error('response lost');return signature;},
  getSignatureStatuses:async()=>{reads++;const s=statuses.shift();if(s instanceof Error)throw s;return {context:{slot:1},value:[s?{slot:1,confirmations:1,err:null,...s}:null]};},
  getBlockHeight:async()=>height,
 };
 return {rpc,clock:{now:()=>now,sleep:async(ms:number)=>{now+=ms;},timeoutMs:12000},counts:()=>({sends,reads})};
}
test('HTTP confirmation recovers lost send response without resend',async()=>{
 const f=fixture([null,{confirmationStatus:'confirmed',err:null}],true);let seen='';
 assert.equal(await submitAndConfirm(f.rpc,bytes,bytes,100,s=>seen=s,'confirmed',f.clock),signature);
 assert.equal(seen,signature);assert.equal(f.counts().sends,1);
});
test('finalized confirmation waits past blockhash expiry for landed transaction',async()=>{
 const f=fixture([{confirmationStatus:'confirmed',err:null},{confirmationStatus:'finalized',err:null}],false,200);
 assert.equal(await submitAndConfirm(f.rpc,bytes,bytes,100,()=>{},'finalized',f.clock),signature);
});
test('failed, expired and unavailable confirmations never report success or resend',async()=>{
 for(const [statuses,height,pattern] of [
  [[{err:{InstructionError:[0,'Custom']}}],1,/Transaction failed/],
  [[null,null],200,/Blockhash expired/],
  [[new Error('offline'),null,null,null],1,/Confirmation unavailable/],
 ] as const){
  const f=fixture([...statuses],false,height);
  await assert.rejects(submitAndConfirm(f.rpc,bytes,bytes,100,()=>{},'confirmed',f.clock),pattern);
  assert.equal(f.counts().sends,1);
 }
});
