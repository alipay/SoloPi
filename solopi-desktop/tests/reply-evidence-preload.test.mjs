import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('evidence IPC permits only the two explicit channels', async () => {
  const source = fs.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
  const calls = [];
  let exposed;
  const electron = {
    contextBridge: { exposeInMainWorld(_name, value) { exposed = value; } },
    ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve({success:true}); } },
    webUtils: {},
  };
  vm.runInNewContext(source, { require(name) { assert.equal(name, 'electron'); return electron; } });
  await exposed.ipcRenderer.invoke('reply-evidence:list');
  await exposed.ipcRenderer.invoke('reply-evidence:remove', 'run-id');
  await assert.rejects(exposed.ipcRenderer.invoke('reply-evidence:remove-all'), /Unsupported IPC channel/);
  assert.deepEqual(calls, [['reply-evidence:list'], ['reply-evidence:remove', 'run-id']]);
});
