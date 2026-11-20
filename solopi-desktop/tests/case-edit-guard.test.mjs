import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const {guardStateWrite,assertLibraryApplySafe,digest}=require('../electron/case-edit-guard');
const fixture=()=>({caseLibraries:[{id:'a',localRevision:'r1'},{id:'b',localRevision:'b1'}],caseFolders:[{id:'fa',libraryId:'a'},{id:'fb',libraryId:'b'}],components:[{id:'action',commandTemplate:'fixture action'}],cases:[{id:'one',folderId:'fa',steps:[{id:'start',type:'start'},{id:'action',type:'component',componentId:'action'},{id:'end',type:'end'}],variables:{}},{id:'two',folderId:'fa',steps:[{id:'s',type:'start'},{id:'e',type:'end'}]},{id:'three',folderId:'fb',steps:[{id:'s',type:'start'},{id:'e',type:'end'}]}],caseEdges:{one:[{id:'one',source:'start',target:'action'},{id:'two',source:'action',target:'end'}]}});
function edited(base){const next=structuredClone(base);next.cases[0].steps.splice(2,0,{id:'condition',type:'if',config:{condition:'{{variables.result.type}}',equals:'Exit'}});next.caseEdges.one=[{source:'start',target:'action'},{source:'action',target:'condition'},{source:'condition',sourceHandle:'true',target:'end'},{source:'condition',sourceHandle:'false',target:'end'}];return next;}
const request=(state,libraryId='a')=>({libraryId,cases:state.cases.filter(c=>c.folderId===(libraryId==='a'?'fa':'fb')),caseEdges:state.caseEdges,components:state.components});
test('library registration cannot vanish while owned folders or cases remain',()=>{
 const old=fixture(),next=structuredClone(old);next.caseLibraries=next.caseLibraries.filter(l=>l.id!=='a');
 const before=JSON.stringify(old);
 assert.throws(()=>guardStateWrite(next,old),e=>e.code==='CASE_LIBRARY_REGISTRATION_MISSING'&&e.libraryId==='a');
 next.caseFolders=next.caseFolders.filter(f=>f.libraryId!=='a');next.cases=[{id:'direct',libraryId:'a',steps:[]}];
 assert.throws(()=>guardStateWrite(next,old),e=>e.code==='CASE_LIBRARY_REGISTRATION_MISSING');
 assert.equal(JSON.stringify(old),before);
});
test('explicit removal with contents and repair of a legacy missing registration remain allowed',()=>{
 const old=fixture(),next=structuredClone(old);
 next.caseLibraries=next.caseLibraries.filter(l=>l.id!=='a');next.caseFolders=next.caseFolders.filter(f=>f.libraryId!=='a');next.cases=next.cases.filter(c=>c.folderId!=='fa');
 assert.doesNotThrow(()=>guardStateWrite(next,old));
 const broken=structuredClone(old);broken.caseLibraries=broken.caseLibraries.filter(l=>l.id!=='a');
 assert.doesNotThrow(()=>guardStateWrite(old,broken));
 // Unrelated saves must not suddenly block on pre-existing orphaned records.
 assert.doesNotThrow(()=>guardStateWrite(broken,broken));
});
test('saved CLI branch survives persistence/restart and cannot be replaced by an older repo snapshot',t=>{
 const old=fixture(),next=guardStateWrite(edited(old),old,{source:'cli',caseIds:['one']});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-guard-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(next));const restored=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
 assert.equal(restored.caseEditGuards.one.source,'cli');assert.throws(()=>assertLibraryApplySafe(restored,request(old)),e=>e.code==='CASE_LIBRARY_LOCAL_EDITS_CONFLICT'&&e.caseIds[0]==='one');
 assert.deepEqual(restored.cases,next.cases);
});
test('non-conflicting same-library changes and another library still refresh',()=>{
 const base=fixture(),saved=guardStateWrite(edited(base),base,{source:'cli',caseIds:['one']});const incoming=structuredClone(saved);incoming.cases[1].name='new upstream case';
 assert.equal(assertLibraryApplySafe(saved,request(incoming)).success,true);assert.equal(assertLibraryApplySafe(saved,request(base,'b')).success,true);
});
test('renderer edits, global command edits and deletions get durable guards without trusting incoming guard metadata',()=>{
 const base=fixture(),next=structuredClone(base);next.components[0].commandTemplate='new fixture action';const saved=guardStateWrite(next,base);assert.equal(saved.caseEditGuards.one.source,'editor');assert.throws(()=>assertLibraryApplySafe(saved,request(base)),/已保存/);
 const deleted=structuredClone(saved);deleted.cases=deleted.cases.filter(c=>c.id!=='one');const persisted=guardStateWrite(deleted,saved);assert.equal(persisted.caseEditGuards.one.digest,null);assert.throws(()=>assertLibraryApplySafe(persisted,request(base)),/已保存/);
 const emptyGuard={...persisted,caseEditGuards:{}};assert.equal(guardStateWrite(emptyGuard,persisted).caseEditGuards.one.digest,null);
});
test('save-time guard rejects a refresh racing with a CLI edit, before committing any cases',()=>{
 const old=fixture(),saved=guardStateWrite(edited(old),old,{source:'cli',caseIds:['one']});const stale=structuredClone(old);stale.caseLibraries[0].localRevision='r2';assert.throws(()=>guardStateWrite(stale,saved),e=>e.code==='CASE_LIBRARY_LOCAL_EDITS_CONFLICT');assert(saved.cases[0].steps.some(s=>s.id==='condition'));
});
test('legacy state acquires a guard on explicit save even for identical content; clean imports are not marked edited',()=>{
 const base=fixture();assert(guardStateWrite(base,base,{caseIds:['one'],source:'cli'}).caseEditGuards.one);
 const next=structuredClone(base);next.caseLibraries[0].localRevision='r2';next.cases[0].name='upstream';assert.equal(guardStateWrite(next,base).caseEditGuards.one,undefined);
});
test('equivalent edge order, layout, object key order and unrelated component changes do not create false edits',()=>{
 const old=fixture(),next=structuredClone(old);next.caseEdges.one.reverse();next.nodePositions={one:{start:{x:99,y:33}}};next.components.push({id:'unused',commandTemplate:'unrelated'});next.cases[0].variables={};assert.equal(digest(old,old.cases[0]),digest(next,next.cases[0]));assert.deepEqual(guardStateWrite(next,old).caseEditGuards,{});
});
const source=fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('editor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=new Map();function walk(n){if(ts.isVariableDeclaration(n))declarations.set(n.name.getText(tree),n.initializer?.getText(tree));ts.forEachChild(n,walk);}walk(tree);
test('all UI refresh entry points await the durable check before replacing cases',()=>{
 const merge=declarations.get('mergeCaseLibraryFiles');assert(merge.indexOf("'case-library:check-apply'")<merge.indexOf('setCases('));assert.match(merge,/if \(!checked.success\) throw/);assert.match(merge,/assertLibraryRefreshState\(beforeApply, liveCaseStateRef.current\)/);
 assert.match(declarations.get('applyLocalCaseLibraryChange'),/await mergeCaseLibraryFilesRef.current/);assert.match(declarations.get('refreshSelectedCaseLibrary'),/await mergeCaseLibraryFiles\(/);assert.match(declarations.get('pullRemoteCases'),/await mergeCaseLibraryFiles\(/);
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');assert.match(main,/caseEditGuard.guardStateWrite\(mergeWorkflowStateForRendererSave/);assert.match(main,/caseEditGuard.guardStateWrite\(nextState, state, \{ source: 'cli'/);
});
test('guard diagnostics contain only identity/count metadata and survive sanitization',()=>{
 const {sanitize}=require('../electron/diagnostics');assert.deepEqual(sanitize({event:'case-library.apply-check',libraryId:'a',caseId:'one',source:'refresh',status:'blocked',conflictCount:1,caseBody:'secret payload',apiKey:'secret'}),{event:'case-library.apply-check',libraryId:'a',caseId:'one',source:'refresh',status:'blocked',conflictCount:1});
});

test('legacy glass device/config spellings normalize without marking unedited cases',()=>{
 const old=fixture();old.cases[0].steps[0].device='glass';old.cases[0].steps[0].config={captureGlassLog:true,recordGlassScreen:false};const next=structuredClone(old);next.cases[0].steps[0].device='glasses';next.cases[0].steps[0].config={captureGlassesLog:true,recordGlassesScreen:false};assert.equal(digest(old,old.cases[0]),digest(next,next.cases[0]));assert.deepEqual(guardStateWrite(next,old).caseEditGuards,{});
});

function assetFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asset-equivalence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const local=path.join(root,'old.pcm'),archived=path.join(root,'new-contenthash.pcm');fs.writeFileSync(local,'same original bytes');fs.copyFileSync(local,archived);
 const state=fixture();state.cases[0].steps[1].inputs={localPath:local,query:'keep expected query'};state.caseEditGuards={one:{libraryId:'a'}};
 const incoming=structuredClone(state);incoming.cases[0].steps[1].inputs.localPath=archived;return{state,incoming,local,archived};
}
test('identical material bytes at renamed paths refresh safely and restart does not reintroduce conflicts',t=>{
 const f=assetFixture(t),saved=JSON.parse(JSON.stringify(f.state));assert.notEqual(digest(saved,saved.cases[0]),digest(f.incoming,f.incoming.cases[0]));
 assert.equal(assertLibraryApplySafe(saved,request(f.incoming)).success,true);
 f.incoming.caseLibraries[0].localRevision='r2';assert.doesNotThrow(()=>guardStateWrite(f.incoming,saved));
});
test('real parameters, edges, component commands and different material bytes remain protected',t=>{
 const f=assetFixture(t);
 for(const edit of [s=>s.cases[0].steps[1].inputs.query='changed expectation',s=>s.caseEdges.one.push({source:'end',target:'start'}),s=>s.components[0].commandTemplate='different command']){
  const next=structuredClone(f.incoming);edit(next);assert.throws(()=>assertLibraryApplySafe(f.state,request(next)),{code:'CASE_LIBRARY_LOCAL_EDITS_CONFLICT'});
 }
 fs.writeFileSync(f.archived,'different material bytes');assert.throws(()=>assertLibraryApplySafe(f.state,request(f.incoming)),{code:'CASE_LIBRARY_LOCAL_EDITS_CONFLICT'});
});
test('missing material never becomes equivalent by basename or hash-looking suffix',t=>{
 const f=assetFixture(t);fs.rmSync(f.archived);assert.throws(()=>assertLibraryApplySafe(f.state,request(f.incoming)),{code:'CASE_LIBRARY_LOCAL_EDITS_CONFLICT'});
});

test('relative material paths resolve against each case base and same filenames with different bytes still conflict',t=>{
 const f=assetFixture(t),left=path.dirname(f.local),right=path.join(left,'second-checkout');fs.mkdirSync(right);
 const name='audio.pcm';fs.writeFileSync(path.join(left,name),'identical');fs.writeFileSync(path.join(right,name),'identical');
 f.state.cases[0].assetBaseDir=left;f.state.cases[0].steps[1].inputs.localPath=name;
 f.incoming.cases[0].assetBaseDir=right;f.incoming.cases[0].steps[1].inputs.localPath=name;
 assert.doesNotThrow(()=>assertLibraryApplySafe(f.state,request(f.incoming)));
 fs.writeFileSync(path.join(right,name),'changed audio, same filename');assert.throws(()=>assertLibraryApplySafe(f.state,request(f.incoming)),{code:'CASE_LIBRARY_LOCAL_EDITS_CONFLICT'});
});
