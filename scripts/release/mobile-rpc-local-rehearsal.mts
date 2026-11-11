// Local-only transport rehearsal. No production keys, RPC credentials or backend.
import assert from 'node:assert/strict';
import {Connection,Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {createGateway} from '../../infra/mobile-rpc/server.mjs';
import {submitAndConfirm} from '../../app/src/transactionTransport';

const upstream='http://127.0.0.1:8899';
const direct=new Connection(upstream,{commitment:'confirmed',disableRetryOnRateLimit:true});
const genesis=await direct.getGenesisHash();
assert(!['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d','EtWTRABZaYq6iMfeYKouRu166VU2xqa1'].includes(genesis));
const gateway=createGateway({upstream,transactions:true,expectedGenesis:genesis,localTest:true});
await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
try {
 const address=gateway.address();assert(address&&typeof address!=='string');
 const rpc=new Connection(`http://127.0.0.1:${address.port}`,{commitment:'confirmed',disableRetryOnRateLimit:true});
 const payer=Keypair.generate(),recipient=Keypair.generate();
 const airdrop=await direct.requestAirdrop(payer.publicKey,1000000000);
 for(let i=0;i<30;i++){
  if((await direct.getSignatureStatuses([airdrop])).value[0]?.confirmationStatus==='confirmed')break;
  await new Promise(r=>setTimeout(r,500));
 }
 const latest=await rpc.getLatestBlockhash('confirmed');
 const tx=new Transaction({feePayer:payer.publicKey,...latest}).add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient.publicKey,lamports:1000000}));tx.sign(payer);
 let observed='';
 const signature=await submitAndConfirm(rpc,tx.serialize(),tx.signature!,latest.lastValidBlockHeight,s=>observed=s,'finalized');
 assert.equal(signature,observed);assert.equal(await rpc.getBalance(recipient.publicKey),1000000);
 // Preflight rejection is surfaced as an uncertain/not-observed outcome, never success.
 const invalid=await fetch(`http://127.0.0.1:${address.port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'sendTransaction',params:[Buffer.alloc(200,1).toString('base64'),{encoding:'base64'}]})}).then(r=>r.json());
 assert(invalid.error);
 console.log(JSON.stringify({network:'local-validator',genesis,confirmedAndFinalized:true,signature,recipientLamports:1000000,invalidWireRejected:true,backendRequired:false}));
} finally {await new Promise<void>((resolve,reject)=>gateway.close(e=>e?reject(e):resolve()));}
