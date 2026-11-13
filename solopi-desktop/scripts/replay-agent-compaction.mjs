// Read-only historical replay. Model output is a fixture; this is not a live model benchmark.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {prepareModelMessages,modelMessages,estimateTokens}=require('../electron/agent/context');
const {SYSTEM}=require('../electron/agent/runtime');
const {createTools}=require('../electron/agent/tools');
const {AgentStore}=require('../electron/agent/store');
const file=process.argv[2];
const budget=process.argv[3] ? Number(process.argv[3]) : undefined;
if(!file) throw Error('Usage: node scripts/replay-agent-compaction.mjs <session.json>');
const raw=fs.readFileSync(file),original=JSON.parse(raw),hash=x=>createHash('sha256').update(x).digest('hex');
const tools=(await createTools({invoke:()=>assert.fail('No tool execution in replay'),readState:()=>({}),skillsRoots:()=>[],config:()=>({}),mcp:{}})({})).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.schema}}));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-desktop-dsh-replay-'));
const store=new AgentStore(()=>dir),results=[];
try{
 for(const mode of ['latest','fresh-projection','confirmed-overflow']){
  const s=structuredClone(original);
  if(mode!=='latest'){delete s.contextCheckpoint;delete s.contextPruned;}
  const before=JSON.stringify(s.messages);let requests=0,largestSummaryInput=0;const begin=performance.now();
  const out=await prepareModelMessages(s,SYSTEM,{...(budget?{provider:{contextWindowTokens:1048576,requestPolicy:require('../electron/agent/request-policy').requestPolicy({inputBudgetTokens:budget})}}:{}),store,save:s=>store.save(s),tools,trigger:mode==='confirmed-overflow'?'context-overflow':'pressure',model:async r=>{requests++;largestSummaryInput=Math.max(largestSummaryInput,estimateTokens(r.messages));if(budget)assert.ok(estimateTokens(r.messages)<=budget);return {content:'Historical replay fixture summary. Preserve pending user task; verify uncertain writes before resubmission.',finish_reason:'stop'};}});
  assert.equal(JSON.stringify(s.messages),before);
  assert.deepEqual(modelMessages(store.get(s.id),SYSTEM),out);
  const pending=new Set();for(const m of out){if(m.role==='assistant'){assert.equal(pending.size,0);for(const c of m.tool_calls||[])pending.add(c.id);}if(m.role==='tool')assert.ok(pending.delete(m.tool_call_id));}assert.equal(pending.size,0);
  const requestTokensEstimate=estimateTokens({messages:out,tools});if(budget)assert.ok(requestTokensEstimate<=budget);
  results.push({mode,messages:s.messages.length,tools:tools.length,requests,largestSummaryInput,requestTokensEstimate,ms:Math.round(performance.now()-begin),state:s.contextState});
 }
 assert.equal(hash(fs.readFileSync(file)),hash(raw));
 console.log(JSON.stringify({sourceHash:hash(raw),results},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
