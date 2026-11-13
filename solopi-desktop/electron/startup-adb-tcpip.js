// Prepare the one unambiguous USB device when the desktop starts.
async function prepareStartupAdb({ runAdb, gate, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const output = await runAdb(['devices', '-l'], 10000);
  const devices = String(output).split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/))
    .filter(parts => parts[1] === 'device' && parts.some(part => /^usb:[^\s]+$/.test(part))
      && /^[A-Za-z0-9_.-]{1,128}$/.test(parts[0]) && !parts[0].startsWith('emulator-'));
  if (devices.length !== 1) return { state: 'skipped', reason: devices.length ? 'multiple_usb_devices' : 'no_usb_device' };
  const serial = devices[0][0];
  // Code security: bind the fixed ADB command to the discovered device and its lease.
  const lease = gate.acquire({ id: 'startup-adb-' + require('node:crypto').randomUUID(), name: '准备 SoloPi ADB', reservedDeviceSerials: [serial] });
  try {
    const port = String(await runAdb(['-s', serial, 'shell', 'getprop', 'service.adb.tcp.port'], 5000)).trim();
    if (port === '5555') return { state: 'ready', changed: false };
    await runAdb(['-s', serial, 'tcpip', '5555'], 15000);
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const state = String(await runAdb(['-s', serial, 'get-state'], 3000)).trim();
        const actual = state === 'device' ? String(await runAdb(['-s', serial, 'shell', 'getprop', 'service.adb.tcp.port'], 5000)).trim() : '';
        if (actual === '5555') return { state: 'ready', changed: true };
      } catch (_) { /* USB can briefly disconnect while adbd restarts. */ }
      await pause(500);
    }
    return { state: 'unconfirmed', reason: 'adb_not_ready' };
  } finally { lease.release(); }
}
module.exports = { prepareStartupAdb };
