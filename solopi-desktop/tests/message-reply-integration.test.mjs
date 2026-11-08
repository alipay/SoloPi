import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { createFixtureSessionFactory }=require('../electron/message-reply-fixture');
const { createMessageReplyTask }=require('../electron/message-reply-task');
const { createReplyGenerator }=require('../electron/message-reply-model');

test('controlled notification flows through frozen model and returns one verified reply',async()=>{
  let sequence=0, added=false, sent=false, modelCalls=0, run, state;
  const operations=[];
  const old={id:'old',description:'fixture:message:old-1:incoming:text:active',text:'old?'};
  const incoming={id:'new',description:'fixture:message:m1:incoming:text:active',text:'new?'};
  const outgoing={id:'out',description:'fixture:message:m2:outgoing:text:active',text:'answer'};
  const buttons=[{id:'arrival',resourceId:'com.solopi.fastpath.demo:id/chat_arrival',actions:['click']},
    {id:'wake',resourceId:'com.solopi.fastpath.demo:id/chat_wake',actions:['click']}];
  const page=id=>({observationId:id,nodes:buttons,readableNodes:[{id:'identity',description:'fixture:conversation:friend-1:single:unique',text:'contact'},
    {id:'count',description:`fixture:message-count:${1+Number(added)+Number(sent)}:0123456789abcdef0123456789abcdef`,text:'count'},
    old,...(added?[incoming]:[]),...(sent?[outgoing]:[])]});
  const control={
    request:async(operation,payload,{owner})=>{
      operations.push({operation,payload,owner});
      if(operation==='virtual_start') return {success:true,data:{observationId:'start',nodes:[{id:'entry',resourceId:'com.solopi.fastpath.demo:id/scenario_chat',actions:['click']}],readableNodes:[]}};
      if(operation==='virtual_act') {
        if(payload.targetId==='arrival') added=true;
        if(payload.targetId==='wake') sequence++;
        return {success:true,data:{...page('after-action'),receipt:{status:'succeeded'}}};
      }
      if(operation==='virtual_notification_status') return {success:true,data:{available:true,epoch:'epoch',sequence}};
      if(operation==='virtual_observe') return {success:true,data:page('observe')};
      if(operation==='virtual_fixture_input') return {success:true,data:{...page('input'),receipt:{status:'succeeded'}}};
      if(operation==='virtual_fixture_send') {sent=true;return {success:true,data:{...page('sent'),receipt:{status:'succeeded'}}};}
      if(operation==='virtual_end') return {success:true,data:{cleanupConfirmed:true}};
      throw Error('unexpected');
    },
  };
  const adapter=createFixtureSessionFactory({control,controlConfig:()=>({packageName:'com.example.test',port:23343})});
  const task=createMessageReplyTask({...adapter,timers:{setTimeout:()=>1,clearTimeout:()=>{}},
    engineStore:{load:()=>state,save:value=>{state=structuredClone(value);}},
    runStore:{load:()=>run,save:value=>{run=structuredClone(value);}},
    createGenerate:config=>createReplyGenerator({role:config.role,contextLimit:0,textProvider:{model:config.textModel},
      knowledge:{search:async()=>[]},requestModel:async request=>{modelCalls++;assert.equal(request.provider.model,'fixture-model');return {content:'answer'};}}),
  });
  await task.start({deviceId:'device',contactId:'friend-1',role:'helper',textModel:'fixture-model'});
  await task.simulateArrival();
  assert.equal((await task.poll()).processed,1);
  assert.equal((await task.poll()).processed,1);
  assert.equal(modelCalls,1);
  assert.equal(operations.filter(item=>item.operation==='virtual_fixture_send').length,1);
  assert.equal(state.history[0].status,'sent');
  assert.equal((await task.stop()).cleanupConfirmed,true);
});
