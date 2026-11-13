import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMessageReplyStore } = require('../electron/message-reply-store');
const { createCredentialStorage } = require('../electron/credential-storage');

test('persists encrypted intent across restarts and rejects tampering', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-store-'));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const storage = createCredentialStorage({ directory, env:{ LENSWIPER_CREDENTIAL_BACKEND:'file' } });
  const first = createMessageReplyStore({ directory, storage });
  assert.equal(first.load(), null);
  first.save({ pending:{id:'private-message', status:'dispatching'} });
  const file = path.join(directory, 'message-reply', 'state.bin');
  assert.equal(fs.readFileSync(file).includes(Buffer.from('private-message')), false);
  assert.equal(createMessageReplyStore({ directory, storage }).load().pending.status, 'dispatching');
  const corrupt = fs.readFileSync(file); corrupt[corrupt.length-1] ^= 1; fs.writeFileSync(file, corrupt);
  assert.throws(() => first.load());
});
test('clearing history retains pending sends and the deduplication baseline', t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reply-store-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const storage=createCredentialStorage({directory,env:{LENSWIPER_CREDENTIAL_BACKEND:'file'}});
  const store=createMessageReplyStore({directory,storage});
  store.save({seen:['previous'],pending:{id:'one',status:'dispatching',reply:'private'},
    history:[{id:'old',status:'sent',text:'old text',reply:'old reply'}]});
  assert.equal(store.history().history.length,1);
  store.clearHistory();
  assert.deepEqual(store.load().seen,['previous']);
  assert.equal(store.load().pending.id,'one');
  assert.deepEqual(store.history().history,[]);
  assert.equal(store.history().pending.reply,'private');
  assert.throws(()=>createMessageReplyStore({directory,storage,kind:'session'}).clearHistory(),/invalid_reply_store/);
});

test('session ownership and message state use separate encrypted records', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-store-'));
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  const storage = createCredentialStorage({directory,env:{LENSWIPER_CREDENTIAL_BACKEND:'file'}});
  const state = createMessageReplyStore({directory,storage});
  const session = createMessageReplyStore({directory,storage,kind:'session'});
  state.save({pending:{id:'x'}}); session.save({owner:'reply-id'});
  assert.equal(state.load().pending.id, 'x');
  assert.equal(session.load().owner, 'reply-id');
  assert.throws(() => createMessageReplyStore({directory,storage,kind:'../outside'}), /invalid_reply_store/);
});
test('manual review durably preserves content and deduplication without claiming delivery',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reply-store-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const storage=createCredentialStorage({directory,env:{LENSWIPER_CREDENTIAL_BACKEND:'file'}});
  const store=createMessageReplyStore({directory,storage});
  store.save({seen:['previous'],history:[],pending:{id:'one',status:'dispatching',text:'question',reply:'answer'}});
  assert.throws(()=>store.reviewPending('different'),/pending_review_changed/);
  assert.equal(store.load().pending.id,'one');
  const reviewed=store.reviewPending('one');
  assert.equal(reviewed.delivery,'unknown');
  const reopened=createMessageReplyStore({directory,storage});
  assert.deepEqual(reopened.load().seen,['previous','one']);
  assert.equal(reopened.load().pending,null);
  assert.deepEqual(reopened.history().history[0],reviewed);
  const bytes=fs.readFileSync(path.join(directory,'message-reply','state.bin'));
  assert.equal(bytes.includes(Buffer.from('question')),false);
  assert.equal(bytes.includes(Buffer.from('answer')),false);
  assert.throws(()=>store.reviewPending('one'),/pending_review_changed/);
});
