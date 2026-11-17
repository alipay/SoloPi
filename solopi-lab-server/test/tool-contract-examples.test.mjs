import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {examples,toolDescription} from '../src/tool-contract-examples.mjs';
const require=createRequire(import.meta.url),Ajv=require('ajv');
const {createTools}=require('../../solopi-desktop/electron/agent/tools.js');
test('published shortest-path examples validate against the actual shared Desktop tools',async()=>{
 const tools=await createTools({skillsRoots:[],config:()=>({})})(undefined,new AbortController().signal);
 const ajv=new Ajv({strict:false});
 for(const [name,example] of Object.entries(examples)){
  const {clientId,tool,args}=example;assert.ok(clientId);
  const native=tools.find(t=>t.name===(tool||'save_case'));assert.ok(native);
  const validate=ajv.compile(native.schema);assert.equal(validate(args),true,JSON.stringify(validate.errors));
  const description=toolDescription(name,'native description');assert.ok(description.startsWith('native description'));assert.ok(description.includes(JSON.stringify(example)));
 }
 const validate=ajv.compile(tools.find(t=>t.name==='search_task_logs').schema);
 assert.equal(validate({taskId:'actual',query:'wrong level'}),false);
 assert.equal(validate({queries:[{query:'missing task'}]}),false);
});
