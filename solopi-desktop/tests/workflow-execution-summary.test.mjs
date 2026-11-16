import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import assertionPolicy from '../electron/workflow-assertion.js';
const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const begin=source.indexOf('    const graphMode = executionEdges.length > 0;',source.indexOf('async function runWorkflowCase('));
const end=source.indexOf('\n  } finally {',begin);
assert.ok(begin>0 && end>begin);
const core=source.slice(begin,end);
async function run({failure,continueOnError=false,beforeFailure=false,empty=false}={}) {
 const steps=empty?[]:[{id:'start',type:'start'},{id:'action',type:'component',continueOnError},{id:'end',type:'end'}];
 const edges=empty?[]:[{source:'start',target:'action'},{source:'action',target:'end'}];
 const ctx=vm.createContext({effectiveSteps:steps,executionEdges:edges,stepMap:new Map(steps.map(s=>[s.id,s])),outgoing:new Map(edges.map(e=>[e.source,[e]])),results:[],context:{nodeOutputs:{}},devices:{},artifacts:{},requestId:'isolated',
  executeWorkflowAssertionStep:assertionPolicy.executeWorkflowAssertionStep,
  options:{beforeStep:async step=>{if(beforeFailure && step.id==='action')throw Error('preparation failed');}},
  isWorkflowCanceled:()=>false,sendProgress:()=>{},workflowCommandScope:{run:(_id,fn)=>fn()},prepareWorkflowActionLogBoundary:async()=>{},updateWorkflowLogAssertCheckpointForStep:()=>{},shouldApplyPostDelay:()=>false,
  executeWorkflowStep:async step=>{if(failure && step.id==='action')throw Object.assign(Error('assertion failed'),failure==='stop'?{code:'WORKFLOW_STOPPED'}:typeof failure==='object'?failure:{});return {success:true,stdout:'ok',meta:{}};},
  selectWorkflowNextStep:(step,_output,map,out)=>map.get(out.get(step.id)?.[0]?.target),
 });
 vm.runInContext(`async function execute(){let finalResponse;${core}\n}`,ctx);
 return JSON.parse(JSON.stringify(await ctx.execute()));
}
test('failed assertion is in attempted path and termination reports step failure',async()=>{
 const r=await run({failure:true});assert.equal(r.success,false);assert.deepEqual(r.executedPath,['start','action']);assert.equal(r.terminationReason,'step_failed');assert.equal(r.reachedEnd,false);assert.equal(r.results.at(-1).status,'failed');
});
test('failed log assertion evidence survives the real runner failure result',async()=>{
 const evidence={patternMatched:true,lastExtractedText:'initial',expectedText:'ready',matchOperator:'equals'};
 const r=await run({failure:{code:'LOG_TEXT_ASSERT_TIMEOUT',stdout:'value=initial',meta:{logTextAssertion:evidence}}});
 assert.equal(r.results.at(-1).errorCode,'LOG_TEXT_ASSERT_TIMEOUT');assert.equal(r.results.at(-1).stdout,'value=initial');
 assert.deepEqual(r.results.at(-1).meta.logTextAssertion,evidence);
});
test('continuing failure records each entered node once and reaching End does not turn failure into success',async()=>{
 const r=await run({failure:true,continueOnError:true});assert.equal(r.success,false);assert.deepEqual(r.executedPath,['start','action','end']);assert.equal(r.terminationReason,'reached_end');assert.equal(r.reachedEnd,true);
});
test('cancellation while executing records stopped node and stopped termination',async()=>{
 const r=await run({failure:'stop'});assert.equal(r.stopped,true);assert.deepEqual(r.executedPath,['start','action']);assert.equal(r.terminationReason,'stopped');
});
test('pre-step failure does not claim the action ran',async()=>{
 const r=await run({beforeFailure:true});assert.deepEqual(r.executedPath,['start']);assert.equal(r.terminationReason,'before_step_failed');assert.equal(r.success,false);
});
test('successful and empty workflows retain accurate terminal summaries',async()=>{
 const success=await run();assert.equal(success.success,true);assert.deepEqual(success.executedPath,['start','action','end']);assert.equal(success.terminationReason,'reached_end');
 const empty=await run({empty:true});assert.equal(empty.success,false);assert.deepEqual(empty.executedPath,[]);assert.equal(empty.terminationReason,'workflow_empty');
});
