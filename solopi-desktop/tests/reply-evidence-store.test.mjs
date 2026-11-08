import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createReplyEvidenceStore} = require('../electron/reply-evidence-store');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-evidence-test-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  let data = null;
  const index = {load:() => structuredClone(data), save:value => {data = structuredClone(value);}};
  return {root, index, store:createReplyEvidenceStore({index,artifactDirectory:()=>root})};
}
const owner = 'reply-12345678-1234-1234-1234-123456789abc';
const id = 'a'.repeat(32);

test('only bound and cleaned runs are listed and removed', t => {
  const x = setup(t);
  x.store.begin(owner,id);
  const directory = path.join(x.root, 'virtual-' + id);
  fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'report.html'), 'fixture');
  assert.deepEqual(x.store.list(), []);
  assert.throws(() => x.store.remove(id));
  x.store.bind(owner,id);
  assert.deepEqual(x.store.list(), []);
  x.store.complete(owner,id);
  assert.equal(x.store.list()[0].id,id);
  const unrelated = path.join(x.root,'virtual-' + 'b'.repeat(32));
  fs.mkdirSync(unrelated);
  x.store.remove(id);
  assert.equal(fs.existsSync(directory),false);
  assert.equal(fs.existsSync(unrelated),true);
  assert.deepEqual(x.store.list(),[]);
});

test('unbound, unrelated, malformed and forged IDs cannot delete anything', t => {
  const x = setup(t);
  x.store.begin(owner,id);
  x.store.complete(owner,id);
  fs.mkdirSync(path.join(x.root, 'virtual-' + id));
  assert.deepEqual(x.store.list(),[]);
  for (const bad of [id, '../outside', 'b'.repeat(32), null]) assert.throws(() => x.store.remove(bad));
  assert.equal(fs.existsSync(path.join(x.root,'virtual-' + id)),true);
});

test('symlinked roots, runs and descendants are rejected', t => {
  const x = setup(t);
  x.store.begin(owner,id); x.store.bind(owner,id); x.store.complete(owner,id);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(),'reply-evidence-outside-'));
  t.after(() => fs.rmSync(outside,{recursive:true,force:true}));
  const marker = path.join(outside,'marker'); fs.writeFileSync(marker,'safe');
  const dir = path.join(x.root,'virtual-' + id);
  fs.symlinkSync(outside,dir,'dir');
  assert.throws(() => x.store.remove(id));
  fs.unlinkSync(dir); fs.mkdirSync(dir); fs.symlinkSync(outside,path.join(dir,'nested'),'dir');
  assert.throws(() => x.store.remove(id));
  assert.equal(fs.readFileSync(marker,'utf8'),'safe');
  assert.equal(x.store.list().length,1);
});

test('corrupt index and mismatched owner cannot claim a run', t => {
  const x = setup(t);
  x.store.begin(owner,id);
  assert.throws(() => x.store.bind('reply-87654321-1234-1234-1234-123456789abc',id));
  x.index.save({records:[{id,owner,status:'complete',createdAt:'bad'}]});
  assert.throws(() => x.store.list());
  assert.throws(() => x.store.remove(id));
});
