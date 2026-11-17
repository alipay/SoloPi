import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,writeFileSync,rmSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{loadHostCapabilities}from'../src/superagent-host-capabilities.mjs';
function setup(t,observationMs=8000){const dir=mkdtempSync(join(tmpdir(),'host-observation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'host-capabilities.json'),JSON.stringify({programs:{fixture:{command:process.execPath}}}));const c=loadHostCapabilities(dir,{observationMs});return(name,args,id='one')=>c.tools.find(t=>t.name===name).execute(args,{operationId:id,conversationId:'one'});}
test('short CLI returns its final output and replay does not respawn',async t=>{const call=setup(t);const a={program:'fixture',args:['-e','console.log("done")']};const r=await call('start_host_cli',a);assert.equal(r.status,'succeeded');assert.equal(r.exitCode,0);assert.match(r.output,/done/);assert.deepEqual(await call('start_host_cli',a),r);});
test('observation timeout preserves the same running operation until terminal',async t=>{const call=setup(t,1);const r=await call('start_host_cli',{program:'fixture',args:['-e','setTimeout(()=>console.log("finished"),150)']});assert.equal(r.status,'running');let q;for(let n=0;n<100;n++){q=await call('read_host_operation',{operationId:r.operationId},'read');if(q.status!=='running')break;await new Promise(r=>setTimeout(r,10));}assert.equal(q.status,'succeeded');assert.match(q.output,/finished/);});
test('written file path can be passed straight to read_work_file',async t=>{const call=setup(t);const r=await call('write_work_file',{path:'result.md',content:'正文'});assert.equal(r.path,'result.md');const read=await call('read_work_file',{path:r.path,offset:0,limit:100},'read');assert.equal(read.text,'正文');});
test('CLI diagnostics cannot contaminate deterministic JSON body append',async t=>{const call=setup(t);const original='# Existing\n"quoted" and \\ path\n';const r=await call('start_host_cli',{program:'fixture',args:['-e','console.error("update available");console.log(JSON.stringify({body:'+JSON.stringify(original)+'}))']});assert.equal(r.status,'succeeded');const out=await call('write_work_file',{path:'append.md',content:'\n## Result\nfailed'} ,'append');const composed=await call('compose_work_file',{path:'composed.md',parts:[{file:r.stdoutFile,jsonPointer:'/body'},{file:out.path} ]},'compose');const read=await call('read_work_file',{path:composed.path,offset:0,limit:12000},'read');assert.equal(read.text,original+'\n## Result\nfailed');await assert.rejects(()=>call('compose_work_file',{path:'bad.md',parts:[{file:'../outside'}]},'bad'),{code:'HOST_PATH_DENIED'});});
test('Skill references are complete, revisioned and confined even through symlinks',async t=>{
 const {mkdirSync,symlinkSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'skill-reference-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const root=join(dir,'skills','fixture');mkdirSync(join(root,'references'),{recursive:true});mkdirSync(join(dir,'skills','incomplete'));mkdirSync(join(dir,'skills','.metadata'));
 writeFileSync(join(root,'SKILL.md'),'---\nname: fixture\ndescription: fixture\n---\nLoad references/rules.md');const text='HEAD'+'.'.repeat(14000)+'MIDDLE_RULE'+'.'.repeat(10000)+'TAIL';writeFileSync(join(root,'references/rules.md'),text);writeFileSync(join(dir,'private.txt'),'SECRET');symlinkSync(join(dir,'private.txt'),join(root,'references/link.md'));
 const caps=loadHostCapabilities(dir);assert.deepEqual(caps.summary.skills,['fixture']);const tool=caps.tools.find(t=>t.name==='read_skill_reference');const r=await tool.execute({name:'fixture',file:'references/rules.md'});assert.equal(r.content,text);assert.equal(r.complete,true);assert.equal(r.absolutePath,realpathSync(join(root,'references/rules.md')));assert.match(r.sha256,/^[a-f0-9]{64}$/);writeFileSync(join(root,'references/rules.md'),'changed');assert.notEqual((await tool.execute({name:'fixture',file:'references/rules.md'})).sha256,r.sha256);
 for(const file of ['../../private.txt','references/link.md'])await assert.rejects(()=>tool.execute({name:'fixture',file}),{code:'SKILL_REFERENCE_DENIED'});
});

test('paged work-file reads survive Desktop pruning and resume without missing middle content',async t=>{
 const {ToolResultPruner}=await import('@deepseek-ai/dsh-compaction-tool-result-pruner');
 const call=setup(t),original=('前\\"\n'+String.fromCharCode(1)+'😀').repeat(3000)+'MIDDLE_RULE_END';
 await call('write_work_file',{path:'large.json',content:original});
 const {Context}=await import('@deepseek-ai/cordis');
 const pruner=new ToolResultPruner(new Context()),pages=[];let offset=0;
 do{const r=await call('read_work_file',{path:'large.json',offset,limit:12000});
  assert.equal(pruner.pruneContent([{type:'text',text:JSON.stringify(r)}]),null);
  pages.push(r.text);if(r.nextOffset===null)break;
  assert.equal(r.nextOffset,offset+r.text.length);assert.ok(r.nextOffset>offset);offset=r.nextOffset;
 }while(pages.length<200);
 assert.equal(pages.join(''),original);
});
