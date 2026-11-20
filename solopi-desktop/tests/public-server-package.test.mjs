import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';
import {exportPublicSource,isPublicSourceFile,checkPublicFile} from '../scripts/export-public-source.mjs';

test('public snapshot contains the self-hosted service and coordinator but no deployment state',t=>{
  const directory=mkdtempSync(join(tmpdir(),'public-server-source-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const output=join(directory,'source');exportPublicSource(output);
  for(const file of ['lab-server/src/serve.mjs','lab-server/scripts/init.mjs','lab-server/docs/SELF_HOSTING.md','lab-server/migrations/0001_init.sql','contracts/v0.3.9/schemas/endpoint-bindings.json','lab-web/src/main.tsx','lab-web/scripts/build-desktop-report.mjs','webpack.report-viewer.cjs','deploy/stage-a/httpview.mjs','deploy/stage-a/cp-request-body.mjs','integrations/solopi-lab/pyproject.toml','integrations/solopi-lab/solopi_lab/core.py'])assert.ok(existsSync(join(output,file)),file);
  for(const file of ['lab-server/data/model.json','lab-server/data/admin.token','lab-server/src/model.json','deploy/stage-a/handoff/web-viewer.token','deploy/stage-a/data/lab.db','lab-web/.desktop-source/ReportWorkbench.tsx','.private-local/model-catalog.cjs','integrations/lab-agent/secret.py'])assert.equal(isPublicSourceFile(file),false,file);
  assert.match(readFileSync(join(output,'.gitignore'),'utf8'),/lab-server\/data\//);
  assert.match(readFileSync(join(output,'.npmrc'),'utf8'),/^registry=https:\/\/registry\.npmjs\.org\/$/m);
});

test('new deployment initializes its own state and serves the native authenticated API',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'public-server-start-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const data=join(directory,'new-data');
  const init=spawnSync(process.execPath,['../solopi-lab-server/scripts/init.mjs','--data-dir',data],{encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);const receipt=JSON.parse(init.stdout);
  const token=readFileSync(receipt.tokenFile,'utf8').trim(),scope=JSON.parse(readFileSync(receipt.mapFile,'utf8'));
  assert.ok(token.length>=32);assert.ok(scope.orgId&&scope.projectId);assert.ok(!init.stdout.includes(token));
  const retry=spawnSync(process.execPath,['../solopi-lab-server/scripts/init.mjs','--data-dir',data],{encoding:'utf8'});
  assert.notEqual(retry.status,0);assert.equal(readFileSync(receipt.tokenFile,'utf8').trim(),token);
  const child=spawn(process.execPath,['../solopi-lab-server/src/serve.mjs','--db',receipt.database,'--host','127.0.0.1','--port','0'],{stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const closed=once(child,'exit');child.kill('SIGTERM');await closed;}});
  const ready=await new Promise((resolve,reject)=>{
    let output='',errors='';const timeout=setTimeout(()=>reject(Error('API startup timed out: '+errors)),15000);
    child.stderr.on('data',b=>errors+=b);child.once('exit',code=>{clearTimeout(timeout);reject(Error('API exited '+code+': '+errors));});
    child.stdout.on('data',b=>{output+=b;for(const line of output.split('\n')){try{const value=JSON.parse(line);if(value.listening){clearTimeout(timeout);resolve(value);return;}}catch{}}});
  });
  const base='http://127.0.0.1:'+ready.port;
  assert.equal((await fetch(base+'/v1/healthz')).status,200);
  const path='/v1/lab/catalog?'+new URLSearchParams(scope);
  assert.equal((await fetch(base+path)).status,401);
  const response=await fetch(base+path,{headers:{authorization:'Bearer '+token}});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).items,[]);
});

test('Server runtime sync needs no private Desktop provider catalog',t=>{
  const directory=mkdtempSync(join(tmpdir(),'public-server-sync-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const source=join(directory,'desktop','electron','agent');mkdirSync(source,{recursive:true});
  const script=readFileSync('../solopi-lab-server/scripts/sync-desktop-recovery.mjs','utf8');
  const files=script.match(/const files=\[([^\]]+)\]/)[1].match(/'([^']+)'/g).map(s=>s.slice(1,-1));
  for(const name of files)if(name!=='antcc-models.cjs')writeFileSync(join(source,name),'// generic fixture '+name);for(const name of ['diagnostics.js','product-identity.js','report-performance-diagnostics.js'])writeFileSync(join(source,'..',name),'// generic support fixture '+name);
  writeFileSync(join(source,'context.js'),"module.exports=require('./transitive.js');");
  writeFileSync(join(source,'transitive.js'),'module.exports={fixture:true};');
  const runner=join(directory,'server','scripts','sync.mjs');mkdirSync(join(directory,'server','scripts'),{recursive:true});writeFileSync(runner,script);
  const env={...process.env,SOLOPI_DESKTOP_SOURCE:join(directory,'desktop')};
  const result=spawnSync(process.execPath,[runner],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const wrapper=readFileSync(join(directory,'server','src','desktop-agent','antcc-models.cjs'),'utf8');assert.match(wrapper,/runtime-model-catalog/);
  assert.equal(readFileSync(join(directory,'server','src','desktop-agent','transitive.js'),'utf8'),'module.exports={fixture:true};');
  assert.equal(spawnSync(process.execPath,[runner,'--check'],{env}).status,0);
});

test('Server Superagent entry resolves its shared runtime modules without host configuration',async()=>{
  const entry=await import('../../solopi-lab-server/src/server-superagent.mjs');
  assert.equal(typeof entry.ServerSuperagent,'function');
});

test('first Server model projection resolves native compaction without a model call',async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const {prepareModelMessages}=require('../../solopi-lab-server/src/desktop-agent/context.js');
  const session={id:'public-startup',messages:[{role:'user',content:'Read existing task status only.'}],calls:[]};
  const result=await prepareModelMessages(session,'Generic test host',{
    provider:{contextWindowTokens:131072,maxOutputTokens:1024},
    model:async()=>{throw Error('No model call should be needed for a short projection');},
    store:{saveEvidence:()=> 'fixture-evidence'},
  });
  assert.ok(result.some(m=>m.role==='user'&&m.content==='Read existing task status only.'));
});
