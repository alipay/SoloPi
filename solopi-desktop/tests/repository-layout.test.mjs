import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const upstreamLayout=JSON.parse(readFileSync(new URL('./fixtures/github-layout.json',import.meta.url),'utf8'));
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
const run = (...args) => spawnSync(process.execPath,args,{encoding:'utf8',cwd:repositoryRoot});

test('Desktop and Server are independent first-level modules with shared sources resolved', () => {
  for (const file of ['solopi-desktop/package.json','solopi-lab-server/package.json','solopi-lab-server/web/package.json','solopi-lab-server/contracts/v0.3.9/schemas/endpoint-bindings.json','solopi-lab-server/migrations/0001_init.sql']) assert.ok(existsSync(join(repositoryRoot,file)),file);
  for (const file of ['package.json','electron/main.js','src','scripts','skills','contracts','deploy','integrations','lab-server','lab-web','cert.pem']) assert.equal(existsSync(join(repositoryRoot,file)),false,file);
  for (const script of ['check-contract-bundle.mjs','check-public-usage.mjs','sync-desktop-recovery.mjs']) {
    const r=run('solopi-lab-server/scripts/'+script,...(script.startsWith('sync')?['--check']:[]));
    assert.equal(r.status,0,r.stderr);
  }
});

test('fresh gateway starts on loopback without inherited state or an explicit host', async t => {
  const data=mkdtempSync(join(tmpdir(),'monorepo-gateway-'));
  t.after(()=>rmSync(data,{recursive:true,force:true}));
  const init=run('solopi-lab-server/scripts/init.mjs','--data-dir',join(data,'deployment'));
  assert.equal(init.status,0,init.stderr);
  const receipt=JSON.parse(init.stdout);
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['solopi-lab-server/deploy/stage-a/httpview.mjs','--db',receipt.database,'--token-file',receipt.tokenFile,'--map-file',receipt.mapFile,'--port',String(port)],{cwd:repositoryRoot,stdio:['ignore','pipe','pipe'],env:{...process.env,CONTEXT_MODEL_PORT:'0'}});
  t.after(async()=>{if(child.exitCode===null){const closed=once(child,'exit');child.kill('SIGTERM');await closed;}});
  const ready=await new Promise((resolve,reject)=>{
    let text='',err='';const timer=setTimeout(()=>reject(Error('Gateway did not start: '+err)),15000);
    child.stderr.on('data',b=>err+=b);child.once('exit',code=>{clearTimeout(timer);reject(Error('Gateway exited '+code+': '+err));});
    child.stdout.on('data',b=>{text+=b;for(const line of text.split('\n'))try{const v=JSON.parse(line);if(v.listening){clearTimeout(timer);resolve(v);return;}}catch{}});
  });
  assert.equal(ready.host,'127.0.0.1');
  assert.ok(ready.webroot.endsWith('solopi-lab-server/web/dist'));
  assert.ok(existsSync(join(ready.webroot,'index.html')));
  const response=await fetch(`http://127.0.0.1:${ready.port}/`);
  assert.equal(response.status,200);
  assert.ok((await response.text()).includes('<html'));
  const model=await fetch(`http://127.0.0.1:${ready.port}/superagent/status`);
  assert.equal(model.status,200);
  assert.equal(JSON.parse(readFileSync(receipt.mapFile)).projectId.length>0,true);
});

test('repository root matches the complete GitHub layout plus Lab Server',()=>{
 const result=spawnSync('git',['ls-files','-z'],{cwd:repositoryRoot,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const roots=[...new Set(result.stdout.split('\0').filter(Boolean).map(name=>name.split('/')[0]))].sort();
 assert.deepEqual(roots,[...upstreamLayout.roots,'solopi-lab-server'].sort());
});

test('App and Skill contain every upstream file with unchanged content and executable modes',()=>{
 for(const entry of upstreamLayout.files){
  const p=join(repositoryRoot,entry.path),bytes=readFileSync(p);
  const oid=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(oid,entry.oid,entry.path);
  if(process.platform!=='win32')assert.equal(Boolean(statSync(p).mode&0o111),entry.mode==='100755',entry.path+' executable mode');
 }
});
