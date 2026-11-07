import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createVirtualRecoveryStore}=require('../electron/virtual-recovery-store');
const {createCredentialStorage}=require('../electron/credential-storage');

function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-recovery-store-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const storage=createCredentialStorage({directory:()=>dir,env:{LENSWIPER_CREDENTIAL_BACKEND:'file'}});
  return {dir,store:createVirtualRecoveryStore({directory:()=>dir,storage})};
}
test('encrypted owner record survives reconstruction and is deleted after cleanup',t=>{
  const {dir,store}=setup(t), token='a'.repeat(64), value={ownerToken:token,config:{deviceId:'test-device',appId:'org.example'}};
  store.save('chat-1',value);
  const file=path.join(dir,'virtual-recovery','chat-1.bin'), raw=fs.readFileSync(file);
  assert.equal(raw.includes(Buffer.from(token)),false);assert.equal(raw.includes(Buffer.from('test-device')),false);
  if(process.platform!=='win32')assert.equal(fs.statSync(file).mode & 0o077,0);
  assert.deepEqual(store.load('chat-1'),value);
  assert.throws(()=>store.save('chat-1',value),/EEXIST/);
  store.remove('chat-1');assert.equal(fs.existsSync(file),false);
});
test('path traversal, cross-owner substitution, tampering, and symlinks are rejected',t=>{
  const {dir,store}=setup(t),value={ownerToken:'b'.repeat(64),config:{deviceId:'test'}};
  assert.throws(()=>store.save('../bad',value),/invalid_virtual_owner/);
  store.save('chat-a',value);const root=path.join(dir,'virtual-recovery'),a=path.join(root,'chat-a.bin'),b=path.join(root,'chat-b.bin');
  fs.copyFileSync(a,b);assert.throws(()=>store.load('chat-b'),/virtual_recovery_unavailable/);
  fs.unlinkSync(b);fs.symlinkSync(a,b);assert.throws(()=>store.load('chat-b'));
  const bytes=fs.readFileSync(a);bytes[bytes.length-1]^=1;fs.writeFileSync(a,bytes);
  assert.throws(()=>store.load('chat-a'),/virtual_recovery_unavailable/);
});
test('failed persistence removes only the incomplete new record before any device start',t=>{
  const {dir,store}=setup(t),original=fs.fsyncSync;
  try {
    fs.fsyncSync=()=>{throw Error('simulated_disk_failure');};
    assert.throws(()=>store.save('chat-a',{ownerToken:'c'.repeat(64),config:{deviceId:'test'}}),/simulated_disk_failure/);
  } finally { fs.fsyncSync=original; }
  assert.equal(fs.existsSync(path.join(dir,'virtual-recovery','chat-a.bin')),false);
  store.save('chat-a',{ownerToken:'d'.repeat(64),config:{deviceId:'test'}});
  assert.equal(store.load('chat-a').config.deviceId,'test');
});
