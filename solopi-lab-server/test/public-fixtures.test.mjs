import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('read-only proxy and memory examples use synthetic external origins',()=>{
 const proxy=readFileSync(new URL('../web/test/W11.readonlyProxy.test.tsx',import.meta.url),'utf8');
 assert.match(proxy,/https:\/\/legacy\.example\.test:8791/);
 assert.match(proxy,/url\.startsWith\('\/ro\/'\)/);
 const memory=readFileSync(new URL('../web/test/MemoryWorkspace.test.tsx',import.meta.url),'utf8');
 assert.match(memory,/sourceContext:\{channel:'chat-bridge'\}/);
 assert.doesNotMatch(memory,/sourceContext:\{channel:'antmultica'\}/);
 for(const url of proxy.matchAll(/https?:\/\/([^/'"\s]+)/g)){
  const host=new URL('https://'+url[1]).hostname;
  assert.ok(host==='localhost'||host==='127.0.0.1'||host.endsWith('.test')||host.endsWith('.example'),host);
 }
});
