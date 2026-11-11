import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedRequest} from './policy.mjs';
const key='BcExYqanw2XzVAAsos1FdMCMX952FmaU7v7sqKm3QxAT';
const req=(method,params=[])=>({jsonrpc:'2.0',id:1,method,params});
test('bounded account reads and token mint filter',()=>{
 assert.equal(checkedRequest(req('getAccountInfo',[key])).params[1].dataSlice.length,2048);
 assert.equal(checkedRequest(req('getGenesisHash')).ttl,3600000);
 assert.equal(checkedRequest(req('getTokenAccountsByOwner',[key,{mint:key},{encoding:'jsonParsed'}])).params[2].encoding,'jsonParsed');
});
test('no transactions, arbitrary scans, batches or user-chosen upstreams',()=>{
 for(const method of ['sendTransaction','simulateTransaction','requestAirdrop','getProgramAccounts','getBlock','getTransaction'])assert.throws(()=>checkedRequest(req(method)));
 assert.throws(()=>checkedRequest([req('getGenesisHash')]));
 assert.throws(()=>checkedRequest({...req('getGenesisHash'),endpoint:'https://example.com'}));
 assert.throws(()=>checkedRequest(req('getTokenAccountsByOwner',[key,{programId:key}])));
 assert.throws(()=>checkedRequest(req('getMultipleAccounts',[Array(9).fill(key)])));
 assert.throws(()=>checkedRequest(req('getAccountInfo',[key,{dataSlice:{offset:0,length:999999}}])));
});
test('opt-in transaction methods enforce preflight, size, retry and history bounds',()=>{
 const wire=Buffer.alloc(200,1).toString('base64');
 const send=(options={encoding:'base64'})=>req('sendTransaction',[wire,options]);
 assert.throws(()=>checkedRequest(send()));
 const checked=checkedRequest(send(),true);
 assert.equal(checked.ttl,0);assert.equal(checked.params[1].skipPreflight,false);assert.equal(checked.params[1].maxRetries,2);
 for(const option of [{skipPreflight:true},{maxRetries:3},{preflightCommitment:'processed'},{extra:true}])assert.throws(()=>checkedRequest(send({encoding:'base64',...option}),true));
 assert.throws(()=>checkedRequest(req('sendTransaction',[Buffer.alloc(1233).toString('base64'),{encoding:'base64'}]),true));
 assert.throws(()=>checkedRequest(req('getSignatureStatuses',[['1'.repeat(88)],{searchTransactionHistory:true}]),true));
 assert.equal(checkedRequest(req('getSignatureStatuses',[['1'.repeat(88)]]),true).ttl,0);
 assert.equal(checkedRequest(req('getLatestBlockhash',[{commitment:'confirmed'}]),true).ttl,0);
 assert.throws(()=>checkedRequest(req('getBlockHeight',[{dataSlice:{offset:0,length:5}}]),true));
});
