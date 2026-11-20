import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMessageReplyEngine } = require('../electron/message-reply-engine');

function setup() {
  let saved, sequence = 0, epoch = 'epoch';
  let messages = [{ id:'old', direction:'incoming', kind:'text' }];
  let sends = 0, confirm = true;
  const adapter = {
    notificationStatus: async () => ({ available:true, epoch, sequence }),
    observe: async () => ({ contactId:'allowed', identityVerified:true, complete:true, observationId:'obs', messages }),
    send: async ({contactId,messageId,observationId}) => { sends++; return { confirmed:confirm,contactId,messageId,observationId,contentVerified:true,outgoingId:'reply-1' }; },
  };
  const store = { load:() => saved, save:value => { saved = structuredClone(value); } };
  const engine = createMessageReplyEngine({ adapter, store, generate:async () => 'reply' });
  return { engine, adapter, store, wake:() => sequence++, add:message => { messages = [...messages, message]; },
    setEpoch:() => { epoch = 'new'; }, unconfirmed:() => { confirm = false; }, sends:() => sends };
}
const incoming = id => ({ id, direction:'incoming', kind:'text', text:'question?', isQuestion:true,
  unique:true, retracted:false, afterBaseline:true });

test('baseline is ignored and duplicate wake does not resend', async () => {
  const x = setup(); await x.engine.start({contactId:'allowed'}); x.add(incoming('new')); x.wake();
  assert.equal((await x.engine.poll()).processed, 1); await x.engine.poll(); assert.equal(x.sends(), 1);
});
for (const [description, secondText] of [['different text', 'another question?'], ['identical text', 'question?']]) {
  test(`coalesced notification handles two messages with ${description} using fresh observations`, async () => {
    const x = setup();
    const observe = x.adapter.observe, send = x.adapter.send;
    const calls = [];
    let observation = 0;
    x.adapter.observe = async () => ({ ...(await observe()), observationId:`obs-${++observation}` });
    x.adapter.send = async request => {
      calls.push({ id:request.messageId, observationId:request.observationId });
      const receipt = await send(request);
      x.add({ id:`out-${request.messageId}`, direction:'outgoing', kind:'text' });
      return receipt;
    };
    await x.engine.start({contactId:'allowed'});
    x.add(incoming('one')); x.add({...incoming('two'), text:secondText}); x.wake();
    assert.equal((await x.engine.poll()).processed, 1);
    assert.equal((await x.engine.poll()).processed, 2);
    await x.engine.poll();
    assert.deepEqual(calls.map(call => call.id), ['one', 'two']);
    assert.notEqual(calls[0].observationId, calls[1].observationId);
    assert.equal(x.sends(), 2);
  });
}
test('missing history or ambiguous current identity pauses before sending', async () => {
  for (const change of [
    snapshot => ({...snapshot, messages:[incoming('new')]}),
    snapshot => ({...snapshot, identityVerified:false}),
    snapshot => ({...snapshot, messages:[...snapshot.messages, incoming('new')]}),
    snapshot => ({...snapshot, complete:false}),
  ]) {
    const x = setup(); await x.engine.start({contactId:'allowed'});
    x.add(incoming('new')); x.wake();
    const observe = x.adapter.observe;
    x.adapter.observe = async () => change(await observe());
    const result = await x.engine.poll();
    assert.equal(result.status, 'paused');
    assert.ok(['message_history_unconfirmed', 'conversation_identity_unconfirmed'].includes(result.reason));
    assert.equal(x.sends(), 0);
  }
});
test('unconfirmed send blocks restart', async () => {
  const x = setup(); await x.engine.start({contactId:'allowed'}); x.add(incoming('new')); x.wake(); x.unconfirmed();
  assert.equal((await x.engine.poll()).reason, 'send_outcome_unknown');
  await assert.rejects(x.engine.start({contactId:'allowed'}), /send_requires_manual_review/);
  assert.equal(x.sends(), 1);
});
test('identity ambiguity and notification reconnection pause', async () => {
  const x = setup(); await x.engine.start({contactId:'allowed'}); x.setEpoch();
  assert.equal((await x.engine.poll()).reason, 'notification_interrupted'); assert.equal(x.sends(), 0);
  const y = setup(); y.adapter.observe = async () => ({ contactId:'allowed', identityVerified:false, complete:true, messages:[] });
  await assert.rejects(y.engine.start({contactId:'allowed'}), /conversation_identity_unconfirmed/);
});
test('unverified or non-question messages are skipped', async () => {
  const x = setup(); await x.engine.start({contactId:'allowed'}); x.add({...incoming('new'), unique:false}); x.wake();
  assert.equal((await x.engine.poll()).processed, 1); assert.equal(x.sends(), 0);
});
test('stopping while a model request is pending prevents dispatch', async () => {
  let resolve;
  const x = setup();
  const engine = createMessageReplyEngine({ adapter:x.adapter, store:x.store,
    generate:() => new Promise(done => { resolve = done; }) });
  await engine.start({contactId:'allowed'}); x.add(incoming('new')); x.wake();
  const pending = engine.poll();
  while (!resolve) await new Promise(done => setImmediate(done));
  engine.stop(); resolve('reply'); await pending;
  assert.equal(x.sends(), 0);
});
test('stopping during startup cannot enable the listener later', async () => {
  const x = setup(); let resolve;
  x.adapter.observe = () => new Promise(done => { resolve = done; });
  const starting = x.engine.start({contactId:'allowed'});
  while (!resolve) await new Promise(done => setImmediate(done));
  x.engine.stop();
  resolve({ contactId:'allowed', identityVerified:true, complete:true, messages:[] });
  await assert.rejects(starting, /reply_start_cancelled/);
  assert.equal(x.engine.status().status, 'stopped');
});
test('persisted send intent contains generated reply and survives an ambiguous receipt', async () => {
  const x = setup(); await x.engine.start({contactId:'allowed'}); x.add(incoming('new')); x.wake();
  x.adapter.send = async () => ({ confirmed:true });
  assert.equal((await x.engine.poll()).reason, 'send_outcome_unknown');
  assert.equal(x.store.load().pending.reply, 'reply');
  assert.equal(x.store.load().pending.text, 'question?');
});
test('notification loss while generating pauses before dispatch', async () => {
  const x = setup(); let resolve;
  const engine = createMessageReplyEngine({adapter:x.adapter,store:x.store,
    generate:() => new Promise(done => { resolve=done; })});
  await engine.start({contactId:'allowed'}); x.add(incoming('new')); x.wake();
  const pending=engine.poll(); while (!resolve) await new Promise(done => setImmediate(done));
  x.setEpoch(); resolve('reply');
  assert.equal((await pending).reason, 'notification_interrupted');
  assert.equal(x.sends(),0);
});
test('unavailable knowledge pauses before dispatch', async () => {
  const x=setup();
  const engine=createMessageReplyEngine({adapter:x.adapter,store:x.store,generate:async()=>{
    const error=Error('unavailable'); error.code='knowledge_records_unavailable'; throw error;
  }});
  await engine.start({contactId:'allowed'}); x.add(incoming('new')); x.wake();
  assert.equal((await engine.poll()).reason,'knowledge_records_unavailable');
  assert.equal(x.sends(),0);
});
test('session deadline reached while model runs stops before sending', async () => {
  const x=setup(); let resolve, allowed=true;
  const engine=createMessageReplyEngine({adapter:x.adapter,store:x.store,canProceed:()=>allowed,
    generate:()=>new Promise(done=>{resolve=done;})});
  await engine.start({contactId:'allowed'}); x.add(incoming('new')); x.wake();
  const pending=engine.poll(); while(!resolve) await new Promise(done=>setImmediate(done));
  allowed=false; resolve('reply');
  assert.equal((await pending).reason,'session_duration_limit');
  assert.equal(x.sends(),0);
});
test('stop aborts model work and the adapter sees cancellation during a pending send', async () => {
  const x=setup(); let modelSignal, entered;
  const engine=createMessageReplyEngine({adapter:x.adapter,store:x.store,generate:(_m,_s,{signal})=>{
    modelSignal=signal; return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))));
  }});
  await engine.start({contactId:'allowed'});x.add(incoming('one'));x.wake();
  const polling=engine.poll();while(!modelSignal) await new Promise(done=>setImmediate(done));
  engine.stop();await polling;assert.equal(modelSignal.aborted,true);assert.equal(x.sends(),0);

  const y=setup();const second=createMessageReplyEngine({adapter:y.adapter,store:y.store,generate:async()=> 'reply'});
  y.adapter.send=({signal})=>new Promise(resolve=>{entered=()=>resolve({confirmed:false});signal.addEventListener('abort',entered);});
  await second.start({contactId:'allowed'});y.add(incoming('two'));y.wake();
  const sending=second.poll();while(!entered) await new Promise(done=>setImmediate(done));
  second.stop();await sending;assert.equal(y.store.load().pending.id,'two');
});
