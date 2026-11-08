import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMessageReplyTask } = require('../electron/message-reply-task');
const { createReplyGenerator } = require('../electron/message-reply-model');
const { createMessageReplyStore } = require('../electron/message-reply-store');
const { createCredentialStorage } = require('../electron/credential-storage');

function setup() {
  let state, run, sequence = 0, captures = 0;
  const messages = [{id:'old', direction:'incoming', kind:'text'}];
  const requests = [], sent = [];
  const session = {
    notificationStatus:async () => ({available:true, epoch:'epoch', sequence}),
    observe:async () => ({contactId:'friend-1', identityVerified:true, complete:true,
      observationId:'observation', messages:[...messages]}),
    captureImage:async ({observationId, messageId}) => {
      captures++;
      return {observationId, messageId, verified:true, bytes:Buffer.from('89504e470d0a1a0a01020304','hex')};
    },
    send:async ({contactId, messageId, observationId}) => {
      sent.push(messageId);
      return {confirmed:true, contactId, messageId, observationId, contentVerified:true, outgoingId:'out'};
    },
    close:async () => ({cleanupConfirmed:true}),
  };
  const task = createMessageReplyTask({
    openSession:async () => session, recoverSession:async () => ({cleanupConfirmed:true}),
    engineStore:{load:() => state, save:value => {state=structuredClone(value);}},
    runStore:{load:() => run, save:value => {run=structuredClone(value);}},
    timers:{setTimeout:() => 1, clearTimeout:() => {}},
    createGenerate:config => createReplyGenerator({role:'', textProvider:config.textProvider,
      visionProvider:config.visionProvider, knowledge:{search:async () => []}, captureImage:session.captureImage,
      requestModel:async request => {requests.push(request.purpose); return {content:'reply'};}}),
  });
  return {task, messages, requests, sent, state:() => state, captures:() => captures, wake:() => sequence++};
}

const image = {id:'image', direction:'incoming', kind:'image', imageVerified:true,
  unique:true, retracted:false, afterBaseline:true};
const text = {id:'text', direction:'incoming', kind:'text', text:'question?', isQuestion:true,
  unique:true, retracted:false, afterBaseline:true};

test('a task without a vision model skips images without capture and continues with text', async () => {
  const f = setup();
  const config = {deviceId:'device', contactId:'friend-1', textProvider:{model:'text'}, visionProvider:null};
  await f.task.start(config);
  config.visionProvider = {model:'changed-after-start'};
  f.messages.push(image, text); f.wake();
  assert.equal((await f.task.poll()).status, 'running');
  assert.equal(f.captures(), 0);
  assert.deepEqual(f.requests, ['reply-text']);
  assert.deepEqual(f.sent, ['text']);
  assert.deepEqual(f.state().history.map(({id, status, reason}) => ({id, status, reason})), [
    {id:'image', status:'skipped', reason:'image_model_not_configured'},
    {id:'text', status:'sent', reason:undefined},
  ]);
  await f.task.poll();
  assert.deepEqual(f.sent, ['text']);
  await f.task.stop();
});

test('a task with a frozen vision model still processes a verified image', async () => {
  const f = setup();
  const config = {deviceId:'device', contactId:'friend-1', textProvider:{model:'text'}, visionProvider:{model:'vision'}};
  await f.task.start(config);
  config.visionProvider = null;
  f.messages.push(image); f.wake();
  assert.equal((await f.task.poll()).status, 'running');
  assert.equal(f.captures(), 1);
  assert.deepEqual(f.requests, ['reply-image', 'reply-text']);
  assert.deepEqual(f.sent, ['image']);
  await f.task.stop();
});

test('history exposes only the fixed missing-image-model reason', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-image-capability-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const storage = createCredentialStorage({directory, env:{LENSWIPER_CREDENTIAL_BACKEND:'file'}});
  const store = createMessageReplyStore({directory, storage});
  store.save({history:[{id:'image', status:'skipped', reason:'image_model_not_configured'},
    {id:'other', status:'skipped', reason:'untrusted detail'}]});
  assert.deepEqual(store.history().history, [{id:'image', status:'skipped', reason:'image_model_not_configured'},
    {id:'other', status:'skipped'}]);
});
