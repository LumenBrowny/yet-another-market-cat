import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Buffer} from 'node:buffer';
import {generate} from './service-keys.mjs';
import {recipient,fingerprint,seal,unseal,ROLES} from './issuer-transfer.mjs';
import {unseal as deploymentUnseal} from './transfer.mjs';
test('issuer transfer excludes all other roles and rejects tampering or wrong identity',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yamc-issuer-transfer-')),dir=path.join(root,'keys');
 try{
  const registry=generate(dir),pair=recipient(),fp=fingerprint(pair.publicKey);
  const issuer=JSON.parse(fs.readFileSync(path.join(dir,'issuer.json'),'utf8'));
  const publisher=JSON.parse(fs.readFileSync(path.join(dir,'publisher.json'),'utf8'));
  assert.deepEqual(ROLES,['issuer']);
  const envelope=seal({issuer},registry,pair.publicKey,fp);
  assert.deepEqual(unseal(envelope,registry,pair.privateKey),{issuer});
  assert.throws(()=>seal({issuer,publisher},registry,pair.publicKey,fp));
  assert.throws(()=>seal({issuer:publisher},registry,pair.publicKey,fp));
  assert.throws(()=>seal({issuer},registry,pair.publicKey,'wrong'));
  assert.throws(()=>deploymentUnseal(envelope,registry,pair.privateKey));
  for(const field of ['wrappedKey','iv','tag','ciphertext']){
   const bytes=Buffer.from(envelope[field],'base64');bytes[0]^=1;
   assert.throws(()=>unseal({...envelope,[field]:bytes.toString('base64')},registry,pair.privateKey));
  }
  assert.throws(()=>unseal({...envelope,registrySha256:'wrong'},registry,pair.privateKey));
  assert.throws(()=>unseal({...envelope,recipientSha256:'wrong'},registry,pair.privateKey));
  assert(!JSON.stringify(envelope).includes(JSON.stringify(issuer)));
 }finally{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);fs.rmdirSync(root);}
});
