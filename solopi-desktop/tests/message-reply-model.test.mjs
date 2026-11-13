import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createReplyGenerator } = require('../electron/message-reply-model');
const { requestModel } = require('../electron/agent/model');

test('text request includes only selected recent context and matched knowledge', async () => {
  let request;
  const generate = createReplyGenerator({ role:'客服', contextLimit:1, textProvider:{model:'text'},
    knowledge:{search:async () => [{name:'规则',text:'七天'}]}, requestModel:async value => { request=value; return {content:'答复'}; } });
  const messages = [{id:'1',kind:'text',direction:'incoming',text:'older'}, {id:'2',kind:'text',direction:'outgoing',text:'recent'},
    {id:'3',kind:'text',direction:'incoming',text:'问题'}];
  assert.equal(await generate(messages[2],{messages}), '答复');
  const payload = JSON.parse(request.messages[1].content);
  assert.deepEqual(payload.context,[{direction:'outgoing',text:'recent'}]);
  assert.deepEqual(payload.knowledge,[{name:'规则',text:'七天'}]);
  assert.equal(request.tools.length, 0);
});
test('rejects unverified image before sending anything to a model', async () => {
  let calls = 0;
  const generate = createReplyGenerator({role:'', knowledge:{search:async()=>[]}, requestModel:async()=>{calls++;} });
  const message = {id:'one',kind:'image',imageVerified:true,imageMessageId:'other',imageBytes:Buffer.from('wrong')};
  await assert.rejects(generate(message,{messages:[message]}), /image_unconfirmed/);
  assert.equal(calls, 0);
});
test('zero context limit sends no prior messages', async () => {
  let request;
  const generate = createReplyGenerator({ role:'', contextLimit:0, knowledge:{search:async()=>[]},
    requestModel:async value => {request=value; return {content:'ok'};} });
  const messages = [{id:'one',kind:'text',direction:'incoming',text:'private'},
    {id:'two',kind:'text',direction:'incoming',text:'new'}];
  await generate(messages[1],{messages});
  assert.deepEqual(JSON.parse(request.messages[1].content).context, []);
});
test('unavailable knowledge blocks the text model request', async () => {
  let calls=0;
  const error=Error('unavailable'); error.code='knowledge_records_unavailable';
  const generate=createReplyGenerator({role:'',knowledge:{search:async()=>{throw error;}},requestModel:async()=>{calls++;}});
  const message={id:'one',kind:'text',direction:'incoming',text:'question'};
  await assert.rejects(generate(message,{messages:[message]}),{code:'knowledge_records_unavailable'});
  assert.equal(calls,0);
});
test('unavailable knowledge blocks image capture and both model requests', async () => {
  let captures=0, calls=0;
  const error=Error('unavailable'); error.code='knowledge_records_unavailable';
  const message={id:'one',kind:'image',imageVerified:true};
  const snapshot={observationId:'obs',identityVerified:true,messages:[message]};
  const generate=createReplyGenerator({role:'',knowledge:{search:async query=>{assert.equal(query,'');throw error;}},
    captureImage:async()=>{captures++;},requestModel:async()=>{calls++;}});
  await assert.rejects(generate(message,snapshot),{code:'knowledge_records_unavailable'});
  assert.equal(captures,0); assert.equal(calls,0);
});
test('cancellation during knowledge preflight blocks image capture and model requests', async () => {
  const controller=new AbortController();let finish,captures=0,calls=0;
  const message={id:'one',kind:'image',imageVerified:true};
  const snapshot={observationId:'obs',identityVerified:true,messages:[message]};
  const generate=createReplyGenerator({role:'',knowledge:{search:()=>new Promise(resolve=>{finish=resolve;})},
    captureImage:async()=>{captures++;},requestModel:async()=>{calls++;}});
  const pending=generate(message,snapshot,{signal:controller.signal});
  controller.abort();finish([]);
  await assert.rejects(pending); assert.equal(captures,0); assert.equal(calls,0);
});
test('only a crop bound to the message and observation reaches the vision model', async () => {
  const calls=[];
  const message={id:'image-1',kind:'image',imageVerified:true};
  const snapshot={observationId:'obs-1',identityVerified:true,messages:[message]};
  const png=Buffer.from('89504e470d0a1a0a01020304','hex');
  const generate=createReplyGenerator({role:'',visionProvider:{model:'vision'},textProvider:{model:'text'},
    captureImage:async () => ({observationId:'obs-1',messageId:'image-1',verified:true,bytes:png}),
    knowledge:{search:async()=>[]},requestModel:async request=>{calls.push(request);return {content:calls.length===1?'图片说明':'回复'};}});
  assert.equal(await generate(message,snapshot),'回复');
  assert.equal(calls.length,2);
  assert.equal(calls[0].messages[1].content[1].image_url.url,`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(JSON.parse(calls[1].messages[1].content).message,'图片说明');
});
test('mismatched crop is rejected without a model call', async () => {
  let calls=0;
  const message={id:'image-1',kind:'image',imageVerified:true};
  const snapshot={observationId:'obs-1',identityVerified:true,messages:[message]};
  const generate=createReplyGenerator({role:'',knowledge:{search:async()=>[]},
    captureImage:async()=>({observationId:'old',messageId:'image-1',verified:true,bytes:Buffer.from('89504e470d0a1a0a','hex')}),
    requestModel:async()=>{calls++;}});
  await assert.rejects(generate(message,snapshot),/image_unconfirmed/);
  assert.equal(calls,0);
});
test('vision request preserves the image through the actual model adapter', async () => {
  const bodies=[];
  const fetchImpl=async (_url,options) => {
    bodies.push(JSON.parse(options.body));
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({choices:[{message:{content:bodies.length===1?'图片说明':'回复'},finish_reason:'stop'}]})};
  };
  const message={id:'one',kind:'image',imageVerified:true};
  const snapshot={observationId:'obs',identityVerified:true,messages:[message]};
  const bytes=Buffer.from('89504e470d0a1a0a01020304','hex');
  const generate=createReplyGenerator({role:'',textProvider:{baseUrl:'https://model.invalid/v1',model:'text'},
    visionProvider:{baseUrl:'https://model.invalid/v1',model:'vision'},knowledge:{search:async()=>[]},
    captureImage:async()=>({observationId:'obs',messageId:'one',verified:true,bytes}),
    requestModel:options=>requestModel({...options,fetchImpl})});
  assert.equal(await generate(message,snapshot),'回复');
  assert.equal(bodies[0].messages[1].content[1].image_url.url,`data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(bodies[1].messages.some(item=>JSON.stringify(item).includes(bytes.toString('base64'))),false);
});
test('reply service errors never expose echoed chat fragments', async () => {
  const diagnostics=require('../electron/diagnostics');
  const original=diagnostics.record;const events=[];
  diagnostics.record=value=>events.push(value);
  try {
    await assert.rejects(requestModel({provider:{baseUrl:'https://model.invalid/v1',model:'text'},
      messages:[{role:'user',content:JSON.stringify({message:'private_fragment'})}],tools:[],stream:false,retry:false,purpose:'reply-text',
      fetchImpl:async()=>({ok:false,status:400,headers:new Headers(),json:async()=>({error:{code:'private_fragment',message:'private_fragment'}})})}),
      error=>!JSON.stringify(error.diagnostics).includes('private_fragment') && !error.message.includes('private_fragment'));
    assert.equal(JSON.stringify(events).includes('private_fragment'),false);
  } finally {diagnostics.record=original;}
});
test('reply success diagnostics omit upstream-provided text fields', async () => {
  const diagnostics=require('../electron/diagnostics');const original=diagnostics.record;const events=[];
  diagnostics.record=value=>events.push(value);
  try {
    await requestModel({provider:{baseUrl:'https://model.invalid/v1',model:'text'},messages:[{role:'user',content:'private_fragment'}],
      tools:[],stream:false,retry:false,purpose:'reply-text',fetchImpl:async()=>({ok:true,status:200,
        headers:new Headers({'content-type':'application/json','x-request-id':'private_fragment'}),json:async()=>({private_fragment:true,
          choices:[{message:{content:'reply',private_fragment:true},finish_reason:'private_fragment'}],usage:{prompt_tokens:'private_fragment'}})})});
    assert.equal(JSON.stringify(events).includes('private_fragment'),false);
  } finally {diagnostics.record=original;}
});
test('reply validation errors omit untrusted finish and usage fields', async () => {
  const diagnostics=require('../electron/diagnostics');const original=diagnostics.record;const events=[];
  diagnostics.record=value=>events.push(value);
  try {
    for (const purpose of ['reply-text','reply-image']) {
      for (const [finishReason,content] of [['private_fragment',''],['length','partial']]) {
        const options={provider:{baseUrl:'https://model.invalid/v1',model:'text'},
          messages:[{role:'user',content:'private_fragment'}],tools:[],stream:false,retry:false,purpose,
          fetchImpl:async()=>({ok:true,status:200,headers:new Headers(),json:async()=>({
            choices:[{message:{content},finish_reason:finishReason}],
            usage:{prompt_tokens:'private_fragment',completion_tokens:'private_fragment',total_tokens:'private_fragment'},
          })})};
        await assert.rejects(requestModel(options),error=>{
          assert.equal(JSON.stringify({message:error.message,diagnostics:error.diagnostics}).includes('private_fragment'),false);
          assert.equal(error.diagnostics.category,finishReason==='length'?'output-limit':'empty-response');
          return true;
        });
      }
    }
    assert.equal(JSON.stringify(events).includes('private_fragment'),false);
  } finally {diagnostics.record=original;}
});
test('ordinary conversation keeps response diagnostics', async () => {
  await assert.rejects(requestModel({provider:{baseUrl:'https://model.invalid/v1',model:'text'},
    messages:[{role:'user',content:'hello'}],tools:[],stream:false,retry:false,purpose:'conversation',
    fetchImpl:async()=>({ok:true,status:200,headers:new Headers(),json:async()=>({
      choices:[{message:{content:'partial'},finish_reason:'length'}],usage:{completion_tokens:42},
    })})}),error=>{
      assert.equal(error.diagnostics.finishReason,'length');
      assert.equal(error.diagnostics.completionTokens,42);
      assert.match(error.message,/42 tokens/);
      return true;
    });
});
test('cancelling during image capture prevents model dispatch', async () => {
  const controller=new AbortController();let finish,calls=0;
  const message={id:'image-1',kind:'image',imageVerified:true};
  const snapshot={observationId:'obs-1',identityVerified:true,messages:[message]};
  const generate=createReplyGenerator({role:'',knowledge:{search:async()=>[]},
    captureImage:()=>new Promise(resolve=>{finish=resolve;}),requestModel:async()=>{calls++;}});
  const pending=generate(message,snapshot,{signal:controller.signal});
  while (!finish) await new Promise(resolve=>setImmediate(resolve));
  controller.abort();finish({observationId:'obs-1',messageId:'image-1',verified:true,bytes:Buffer.from('89504e470d0a1a0a','hex')});
  await assert.rejects(pending);assert.equal(calls,0);
});
