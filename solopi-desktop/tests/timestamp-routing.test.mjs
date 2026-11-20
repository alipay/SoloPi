import test from 'node:test';
import assert from 'node:assert/strict';
import {timestampAuthority,timestampFileOptions} from '../scripts/electron-builder-sign.mjs';
test('explicit loopback transport preserves signed timestamp requirements and entitlements',()=>{
 for(const url of ['http://127.0.0.1:51244/ts01','http://[::1]:51244/ts01']) {
  assert.equal(timestampAuthority({GLASSBOX_TIMESTAMP_URL:url}),url);
  assert.deepEqual(timestampFileOptions(()=>({entitlements:'app.plist',hardenedRuntime:true}),{GLASSBOX_TIMESTAMP_URL:url})('app'),{entitlements:'app.plist',hardenedRuntime:true,timestamp:url});
 }
 for(const url of ['none','','http://127.0.0.2/ts01','http://127.0.0.1.example.test/ts01','http://192.168.1.1/ts01','http://user:secret@127.0.0.1/ts01','http://127.0.0.1/ts01?token=secret','http://127.0.0.1/ts01#fragment']) assert.throws(()=>timestampAuthority({GLASSBOX_TIMESTAMP_URL:url}));
});
