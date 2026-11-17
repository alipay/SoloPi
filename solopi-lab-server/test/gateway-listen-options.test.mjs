import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayListenOptions} from '../src/gateway-listen-options.mjs';
test('gateway defaults to loopback even when unrelated arguments are present', () => {
  for (const args of [[], ['--db','example.db'], ['--token-file','admin.token']]) {
    assert.deepEqual(gatewayListenOptions(args), {host:'127.0.0.1',port:8780});
  }
});
test('explicit network binding remains configurable and invalid ports are rejected', () => {
  assert.deepEqual(gatewayListenOptions(['--host','0.0.0.0','--port','8780']), {host:'0.0.0.0',port:8780});
  for (const args of [['--port','0'],['--host'],['--host','--port','8780'],['--port','-1'],['--port','8780x'],['--port','65536']]) assert.throws(()=>gatewayListenOptions(args));
});
