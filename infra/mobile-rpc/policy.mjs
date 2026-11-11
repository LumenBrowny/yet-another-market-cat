const key = v => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const mints = new Set(['BcExYqanw2XzVAAsos1FdMCMX952FmaU7v7sqKm3QxAT','SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3']);
export function checkedRequest(body, transactions = false) {
  if (!object(body) || body.jsonrpc !== '2.0' || !['string','number'].includes(typeof body.id) || String(body.id).length > 80 || !Array.isArray(body.params ?? [])) throw Error('Invalid request');
  if(Object.keys(body).some(k=>!['jsonrpc','id','method','params'].includes(k)))throw Error('Invalid request');
  const p=body.params??[], method=body.method;
  const options=(value,parsed=false)=>{
    if(value!==undefined && !object(value))throw Error('Invalid options');
    const v=value??{};
    if(Object.keys(v).some(k=>!['commitment','encoding','minContextSlot','dataSlice'].includes(k)))throw Error('Invalid options');
    if(v.commitment && !['confirmed','finalized'].includes(v.commitment))throw Error('Invalid commitment');
    if(v.encoding && v.encoding!==(parsed?'jsonParsed':'base64'))throw Error('Invalid encoding');
    if(v.minContextSlot!==undefined&&(!Number.isSafeInteger(v.minContextSlot)||v.minContextSlot<0))throw Error('Invalid slot');
    if(v.dataSlice!==undefined && (!object(v.dataSlice)||Object.keys(v.dataSlice).sort().join()!=='length,offset'||v.dataSlice.offset!==0||!Number.isInteger(v.dataSlice.length)||v.dataSlice.length<0||v.dataSlice.length>2048))throw Error('Invalid slice');
    return {...v,commitment:v.commitment??'confirmed'};
  };
  let params,ttl=2000;
  if(method==='getGenesisHash' && p.length===0){params=[];ttl=3600000;}
  else if(method==='getBalance' && p.length<=2 && key(p[0])){const o=options(p[1]);if(o.encoding||o.dataSlice)throw Error('Invalid balance options');params=[p[0],o];}
  else if(method==='getAccountInfo' && p.length<=2 && key(p[0]))params=[p[0],{...options(p[1]),encoding:'base64',dataSlice:p[1]?.dataSlice??{offset:0,length:2048}}];
  else if(method==='getMultipleAccounts' && p.length<=2 && Array.isArray(p[0]) && p[0].length>0 && p[0].length<=8 && p[0].every(key))params=[p[0],{...options(p[1]),encoding:'base64',dataSlice:p[1]?.dataSlice??{offset:0,length:2048}}];
  else if(method==='getTokenAccountsByOwner' && p.length<=3 && key(p[0]) && object(p[1]) && Object.keys(p[1]).join()==='mint' && mints.has(p[1].mint)){const o=options(p[2],true);if(o.dataSlice)throw Error('Invalid token slice');params=[p[0],p[1],{...o,encoding:'jsonParsed'}];ttl=15000;}
  else if(transactions && ['getLatestBlockhash','getBlockHeight'].includes(method) && p.length<=1){
    const o=options(p[0]);if(o.encoding||o.dataSlice)throw Error('Invalid options');params=[o];ttl=0;
  }
  else if(transactions && method==='getSignatureStatuses' && p.length<=2 && Array.isArray(p[0]) && p[0].length>0 && p[0].length<=8 && p[0].every(v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v))){
    if(p[1]!==undefined && (!object(p[1])||Object.keys(p[1]).some(k=>k!=='searchTransactionHistory')||![undefined,false].includes(p[1].searchTransactionHistory)))throw Error('History unavailable');
    params=[p[0],{searchTransactionHistory:false}];ttl=0;
  }
  else if(transactions && method==='sendTransaction' && p.length===2 && typeof p[0]==='string' && p[0].length<=1644 && /^[A-Za-z0-9+/]+={0,2}$/.test(p[0])){
    const bytes=Buffer.from(p[0],'base64'),o=p[1];
    if(bytes.length<100||bytes.length>1232||bytes.toString('base64')!==p[0])throw Error('Invalid wire transaction');
    if(!object(o)||Object.keys(o).some(k=>!['encoding','skipPreflight','preflightCommitment','maxRetries','minContextSlot'].includes(k))||o.encoding!=='base64'||![undefined,false].includes(o.skipPreflight)||![undefined,'confirmed'].includes(o.preflightCommitment))throw Error('Preflight required');
    if(o.maxRetries!==undefined&&(!Number.isInteger(o.maxRetries)||o.maxRetries<0||o.maxRetries>2))throw Error('Retry limit');
    if(o.minContextSlot!==undefined&&(!Number.isSafeInteger(o.minContextSlot)||o.minContextSlot<0))throw Error('Invalid slot');
    params=[p[0],{...o,encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:o.maxRetries??2}];ttl=0;
  }
  else throw Error('Method unavailable');
  return {method,params,ttl};
}
