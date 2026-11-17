import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire}from'node:module';
const require=createRequire(import.meta.url);
test('upgraded dev server serves a real compiled asset and rejects non-slash publicPath traversal',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'webpack-security-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'entry.js'),'globalThis.syntheticWebpackAsset = "compiled fixture";');fs.writeFileSync(path.join(dir,'private.txt'),'OUTSIDE_PUBLIC_ROOT_FIXTURE');
 const compiler=require('webpack')({mode:'development',entry:path.join(dir,'entry.js'),output:{path:path.join(dir,'build'),filename:'fixture.js'},infrastructureLogging:{level:'error'},stats:'errors-only'});
 const DevServer=require('webpack-dev-server'),server=new DevServer({host:'127.0.0.1',port:0,open:false,hot:false,liveReload:false,client:false,static:false,devMiddleware:{publicPath:'/assets'}},compiler);
 await server.start();t.after(()=>server.stop());const base=`http://127.0.0.1:${server.server.address().port}`;
 const response=await fetch(base+'/assets/fixture.js');assert.equal(response.status,200);assert.match(await response.text(),/compiled fixture/);
 for(const requestPath of ['/assets../private.txt','/assets/%2e%2e%2fprivate.txt']){const r=await fetch(base+requestPath);assert.ok(r.status>=400);assert.doesNotMatch(await r.text(),/OUTSIDE_PUBLIC_ROOT_FIXTURE/);}
});
