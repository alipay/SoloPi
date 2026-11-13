import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prepareStartupAdb } = require('../electron/startup-adb-tcpip');

test('only the uniquely discovered USB device receives tcpip and is verified', async () => {
  const calls = []; let port = '0'; let released = false;
  const runAdb = async args => {
    calls.push(args);
    if (args[0] === 'devices') return 'List of devices attached\nPHONE device usb:1 model:Pixel\n';
    assert.equal(args[1], 'PHONE');
    if (args[2] === 'tcpip') { assert.equal(args[3], '5555'); port = '5555'; return 'restarting'; }
    if (args[2] === 'get-state') return 'device';
    if (args[2] === 'shell') return port;
    throw Error('unexpected adb call');
  };
  const gate = { acquire: task => { assert.deepEqual(task.reservedDeviceSerials, ['PHONE']); return { release: () => { released = true; } }; } };
  assert.deepEqual(await prepareStartupAdb({ runAdb, gate, pause: async () => {} }), { state: 'ready', changed: true });
  assert.equal(released, true);
  assert.equal(calls.filter(args => args[2] === 'tcpip').length, 1);
  assert.deepEqual(await prepareStartupAdb({ runAdb, gate }), { state: 'ready', changed: false });
  assert.equal(calls.filter(args => args[2] === 'tcpip').length, 1);
});

test('multiple USB devices, offline devices and emulators cannot trigger tcpip', async () => {
  const gate = { acquire: () => { throw Error('must not acquire'); } };
  for (const [listing, reason] of [
    ['A device usb:1\nB device usb:2', 'multiple_usb_devices'],
    ['A unauthorized usb:1\nemulator-5554 device', 'no_usb_device'],
    ['192.168.1.2:5555 device', 'no_usb_device'],
  ]) {
    const result = await prepareStartupAdb({ runAdb: async args => { assert.deepEqual(args, ['devices', '-l']); return `List of devices attached\n${listing}\n`; }, gate });
    assert.deepEqual(result, { state: 'skipped', reason });
  }
});

test('a busy device is not changed', async () => {
  const calls = [];
  await assert.rejects(prepareStartupAdb({ runAdb: async args => { calls.push(args); return 'List of devices attached\nPHONE device usb:1\n'; }, gate: { acquire: () => { throw Error('busy'); } } }), /busy/);
  assert.deepEqual(calls, [['devices', '-l']]);
});
