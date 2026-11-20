#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { Connector } = require('./connector.cjs');
const { ConnectorError } = require('./transport.cjs');
async function main(argv) {
  const [command, ...args] = argv;
  if (command === '--help') { console.log('node electron/cluster-client/cli.cjs <init|status|enroll|connect|run> --config FILE --state-dir DIRECTORY [--seconds 60]'); return; }
  if (!['init', 'status', 'enroll', 'connect', 'run'].includes(command)) throw new ConnectorError('COMMAND_INVALID');
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--config', '--state-dir', '--seconds'].includes(args[i]) || !args[i + 1] || opts[args[i]]) throw new ConnectorError('ARGUMENT_INVALID');
    opts[args[i]] = args[i + 1];
  }
  if (!opts['--config'] || !opts['--state-dir']) throw new ConnectorError('ARGUMENT_INVALID');
  const seconds = Number(opts['--seconds'] || 60);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new ConnectorError('DURATION_INVALID');
  const configFile = path.resolve(opts['--config']);
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const c = new Connector({ stateDir: opts['--state-dir'], config, ca: config.caFile ? fs.readFileSync(path.resolve(path.dirname(configFile), config.caFile), 'utf8') : undefined });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setTimeout(stop, seconds * 1000);
  const output = value => console.log(JSON.stringify({ ok: true, contractVersion: '0.1.6', ...value }));
  try {
    if (command === 'init' || command === 'status') { output(c.status()); return; }
    if (command === 'enroll') { output(await c.enroll(controller.signal)); return; }
    const state = await c.connect(controller.signal); output(state);
    if (state.phase !== 'approved') { process.exitCode = 2; return; }
    output(await c.heartbeat(controller.signal));
    if (command === 'run') {
      while (!controller.signal.aborted) {
        await wait(c.session.heartbeatIntervalSec * 1000, undefined, { signal: controller.signal });
        output(await c.heartbeat(controller.signal));
      }
    }
  } finally {
    clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); c.close();
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(e => {
  if (e.code === 'ABORTED' || e.name === 'AbortError') return;
  console.log(JSON.stringify({ ok: false, error: { code: typeof e.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(e.code) ? e.code : 'CONNECTOR_FAILED' } })); process.exitCode = 1;
});
module.exports = { main };
