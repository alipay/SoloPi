import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMessageReplyEngine } = require('../electron/message-reply-engine');
const message = id => ({ id, direction:'incoming', kind:'text', text:'question?',
  unique:true, retracted:false, afterBaseline:true, isQuestion:true });

function setup(generate = async () => 'reply') {
  let state, sequence = 1, available = true, failure = false;
  let messages = [message('baseline')], sent = [];
  const adapter = {
    notificationStatus: async () => {
      if (failure) throw Error('unavailable');
      return {available, epoch:'epoch', sequence};
    },
    observe: async () => ({contactId:'fixture', identityVerified:true, complete:true,
      observationId:`observation-${sequence}`, messages:structuredClone(messages)}),
    send: async request => {
      sent.push(request.messageId);
      return {confirmed:true, contactId:request.contactId, messageId:request.messageId,
        observationId:request.observationId, contentVerified:true, outgoingId:`out-${request.messageId}`};
    },
  };
  const store = {load:() => state, save:value => {state = structuredClone(value);}};
  return {adapter, store, engine:createMessageReplyEngine({adapter, store, generate}),
    setSequence:value => {sequence = value;}, setAvailable:value => {available = value;},
    fail:value => {failure = value;}, add:value => {messages.push(value);}, sent:() => sent};
}

test('unavailable notifications prevent establishing a baseline', async () => {
  const x = setup(); x.setAvailable(false);
  await assert.rejects(x.engine.start({contactId:'fixture'}), /notification_unavailable/);
  assert.equal(x.store.load(), undefined);
  assert.deepEqual(x.sent(), []);
});

test('sequence rollback or notification failure pauses without dispatch', async () => {
  for (const interrupt of [x => x.setSequence(0), x => x.setAvailable(false), x => x.fail(true)]) {
    const x = setup(); await x.engine.start({contactId:'fixture'});
    x.add(message('new')); interrupt(x);
    const result = await x.engine.poll();
    assert.equal(result.status, 'paused');
    assert.ok(['notification_interrupted', 'processing_failed'].includes(result.reason));
    assert.equal(result.pending, false);
    assert.deepEqual(x.sent(), []);
  }
});

test('notification arriving during generation is processed on a new observation', async () => {
  let release, calls = 0;
  const x = setup(() => ++calls === 1 ? new Promise(resolve => {release = resolve;}) : Promise.resolve('reply'));
  await x.engine.start({contactId:'fixture'});
  x.add(message('first')); x.setSequence(2);
  const first = x.engine.poll();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  x.add(message('second')); x.setSequence(3); release('reply');
  assert.equal((await first).processed, 1);
  assert.equal((await x.engine.poll()).processed, 2);
  assert.deepEqual(x.sent(), ['first', 'second']);
  await x.engine.poll();
  assert.deepEqual(x.sent(), ['first', 'second']);
});

test('restart after notification interruption uses a fresh baseline', async () => {
  const x = setup(); await x.engine.start({contactId:'fixture'});
  x.setAvailable(false); assert.equal((await x.engine.poll()).reason, 'notification_interrupted');
  x.add(message('offline')); x.setAvailable(true); x.setSequence(2);
  await x.engine.start({contactId:'fixture'});
  x.setSequence(3); await x.engine.poll();
  assert.deepEqual(x.sent(), []);
  x.add(message('after-restart')); x.setSequence(4);
  await x.engine.poll();
  assert.deepEqual(x.sent(), ['after-restart']);
});
