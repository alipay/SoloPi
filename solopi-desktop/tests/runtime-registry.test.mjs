import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),registry=require('../electron/agent/runtime-registry.cjs'),local=require('../electron/agent/local-runtime.cjs');
const item=(id='fixture')=>({id,name:'Fixture CLI',command:process.execPath,args:[],family:'claude'});
function folder(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'runtime config with spaces '));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));return dir;}
test('fresh installations expose only public defaults and runtime configurations are host-scoped',async t=>{
 const a=folder(t),b=folder(t);assert.deepEqual(registry.definitions(a).map(x=>x.id),['codex','claude']);
 registry.save(a,[item()]);assert.equal((await local.discover({directory:a})).items.find(x=>x.id==='fixture').installed,true);assert.ok(!registry.definitions(b).some(x=>x.id==='fixture'));
 assert.deepEqual(local.executableCandidates(process.execPath),[process.execPath]);
});
test('malformed, duplicate and unknown runtime fields fail before saving',t=>{
 const dir=folder(t);
 for(const items of [null,{},[item(),item()],[{...item(),family:'shell'}],[{...item(),args:'--flag'}],[{...item(),env:{SECRET:'private'}}],[{...item(),modelsCommand:{command:'node',args:[],extra:true}}]])assert.throws(()=>registry.save(dir,items));
 assert.ok(!fs.existsSync(registry.configPath(dir)));
 fs.writeFileSync(registry.configPath(dir),'not-json');assert.throws(()=>registry.definitions(dir));
});
test('merge preserves unrelated definitions and respects overwrite=false',t=>{
 const dir=folder(t);registry.save(dir,[item(),item('other')]);registry.save(dir,[{...item(),name:'changed'}],{overwrite:false});assert.equal(registry.configured(dir)[0].name,'Fixture CLI');registry.save(dir,[{...item(),name:'changed'}]);assert.equal(registry.configured(dir).length,2);assert.equal(registry.configured(dir)[0].name,'changed');
});
test('catalog command receives runtime ID, supports paths with spaces and removes private output fields',async t=>{
 const dir=folder(t),script=path.join(dir,'catalog with spaces.cjs');fs.writeFileSync(script,`const fs=require('node:fs');const q=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify({items:[{id:q.runtimeId,name:'Visible',isDefault:true,token:'PRIVATE'}],credentials:'PRIVATE'}));`);
 registry.save(dir,[{...item(),modelsCommand:{command:process.execPath,args:[script]}}]);
 assert.deepEqual(await local.models('fixture',{directory:dir}),{items:[{id:'fixture',name:'Visible',isDefault:true}],source:'configured-command',allowsCustom:true});
 const next=path.join(dir,'next.cjs');fs.writeFileSync(next,`console.log(JSON.stringify({items:[{id:'updated'}]}));`);registry.save(dir,[{...item(),modelsCommand:{command:process.execPath,args:[next]}}]);assert.equal((await local.models('fixture',{directory:dir})).items[0].id,'updated');
});
test('catalog errors remain failures, never empty successes, and cancellation closes owned processes',async t=>{
 const dir=folder(t),script=path.join(dir,'catalog.cjs'),write=body=>{fs.writeFileSync(script,body);registry.save(dir,[{...item(),modelsCommand:{command:process.execPath,args:[script]}}]);};
 for(const body of [`console.log('{}')`,`console.log('null')`,`console.log(JSON.stringify({items:[{}]}))`,`console.log('{}\\n{}')`,`console.error('PRIVATE');process.exit(3)`]){write(body);await assert.rejects(()=>local.models('fixture',{directory:dir,refresh:true}),e=>!e.message.includes('PRIVATE'));}
 write(`setInterval(()=>{},1000)`);const c=new AbortController();setTimeout(()=>c.abort(Error('cancelled')),100);await assert.rejects(()=>local.models('fixture',{directory:dir,refresh:true,signal:c.signal}),/cancelled/);
});
