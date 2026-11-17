const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { runManagedCommand } = require('./managed-command');
const { observeScrcpyVideo } = require('./scrcpy-stream-observer');
const activeTransports = new Set();

const packet = value => { const data = Buffer.from(value); return Buffer.concat([Buffer.from(data.length.toString(16).padStart(4, '0')), data]); };
function reader(socket) {
  let buffer = Buffer.alloc(0), pending, failure;
  const drain = () => {
    if (!pending) return;
    if (buffer.length >= pending.count) {
      const current = pending; pending = null;
      const value = buffer.subarray(0, current.count); buffer = buffer.subarray(current.count); current.resolve(value);
    } else if (failure) { const current = pending; pending = null; current.reject(failure); }
  };
  const data = chunk => { buffer = Buffer.concat([buffer, chunk]); drain(); };
  const end = () => { failure = Error('ADB transport closed before response'); drain(); };
  const error = err => { failure = err; drain(); };
  socket.on('data', data); socket.on('end', end); socket.on('close', end); socket.on('error', error);
  return {
    read(count) { return new Promise((resolve, reject) => { pending = { count, resolve, reject }; drain(); }); },
    async message() { const size = (await this.read(4)).toString(); if (!/^[0-9a-f]{4}$/i.test(size)) throw Error('Invalid ADB message length'); return (await this.read(parseInt(size, 16))).toString(); },
    release() { socket.pause(); socket.removeListener('data', data); socket.removeListener('end', end); socket.removeListener('close', end); socket.removeListener('error', error); if (buffer.length) socket.unshift(buffer); },
  };
}
async function okay(input) { const status = (await input.read(4)).toString(); if (status !== 'OKAY') throw Error(status === 'FAIL' ? await input.message() : 'Invalid ADB response'); }
function listen(server, port = 0) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); }); }); }
function connect(endpoint, timeoutMs, track, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const socket = net.createConnection(endpoint); track?.(socket);
    const abort = () => socket.destroy(signal.reason || Error('Recording stopped'));
    signal?.addEventListener('abort', abort, {once:true});socket.once('close',()=>signal?.removeEventListener('abort',abort));
    socket.setTimeout(timeoutMs, () => socket.destroy(Error('ADB transport timeout')));
    socket.once('error', reject); socket.once('connect', () => { socket.removeListener('error', reject); resolve(socket); });
  });
}
async function query(endpoint, service, timeoutMs, signal, track) {
  const socket = await connect(endpoint, timeoutMs, track, signal), input = reader(socket);
  try { socket.write(packet(service)); await okay(input); return await input.message(); } finally { socket.destroy(); }
}
function deviceLine(text, serial) {
  const rows = text.split('\n').map(s => s.trim()).filter(Boolean).filter(row => row.split(/\s+/)[0] === serial);
  if (rows.length !== 1 || rows[0].split(/\s+/)[1] !== 'device') throw Error('Recording device is not uniquely online at resolved endpoint');
  return rows[0];
}
const execute = async (file, args, options) => {
  options.signal?.throwIfAborted();
  return (await runManagedCommand(file, args, options, cancel => {
    const abort=()=>cancel();options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted)cancel();
    return ()=>options.signal?.removeEventListener('abort',abort);
  })).stdout;
};
// Local recorders need the same packet-level readiness as remote adapters.
// Honor ADB's configured server without starting/stopping the shared server.
function resolveLocalAdbEndpoint(env = process.env) {
  const socket = String(env.ADB_SERVER_SOCKET || '').trim();
  let host = String(env.ANDROID_ADB_SERVER_ADDRESS || '127.0.0.1');
  let port = String(env.ANDROID_ADB_SERVER_PORT || '5037');
  if (socket) {
    const match = /^tcp:(?:(\[[^\]]+\]|[^:]+):)?(\d+)$/.exec(socket);
    if (!match) throw Error('Recording requires a TCP ADB server socket');
    host = (match[1] || '127.0.0.1').replace(/^\[|\]$/g, '');
    port = match[2];
  }
  if (!host || /[\s/\x00]/.test(host) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw Error('Invalid recording ADB server endpoint');
  }
  return { host, port: Number(port) };
}
async function resolveScrcpyEndpoint(adb, serial, { run = execute, env = process.env, signal } = {}) {
  const sidecar = `${adb}.lenswiper.json`;
  if (!fs.existsSync(sidecar)) return null;
  if (fs.statSync(sidecar).size > 65536) throw Error('ADB transport descriptor exceeds size limit');
  const config = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  if (config.schemaVersion !== 'lenswiper.adb-adapter.v1' || !path.isAbsolute(config.resolve?.executable)
    || !Array.isArray(config.resolve.args) || config.resolve.args.length > 100
    || config.resolve.args.some(arg => typeof arg !== 'string' || arg.length > 4096)
    || !config.resolve.args.includes('{serial}')) throw Error('Invalid ADB transport descriptor');
  const output = await run(config.resolve.executable, config.resolve.args.map(arg => arg === '{serial}' ? serial : arg), { env, signal, timeout: 15000, maxBuffer: 65536 });
  const result = JSON.parse(String(output));
  if (result.schemaVersion !== 'lenswiper.adb-transport.v1' || result.serial !== serial
    || typeof result.host !== 'string' || !result.host || /[\s/\x00]/.test(result.host)
    || !Number.isInteger(result.port) || result.port < 1 || result.port > 65535) throw Error('Invalid or mismatched ADB transport endpoint');
  return { host: result.host, port: result.port };
}

// A private smart socket for one recording. The real shared server is never
// started/stopped or asked to create TCP forwards in its network namespace.
async function createScrcpyTransport({ endpoint, serial, timeoutMs = 10000, signal, onEvent = () => {} }) {
  if (!serial || /[\s\x00]/.test(serial)) throw Error('Invalid recording serial');
  const sockets = new Set(), forwards = new Map(); let closed = false, videoClaimed = false;
  const event = (phase, extra = {}) => { try { onEvent({ phase, serial, ...extra }); } catch (_) {} };
  let connectionSequence = 0, channelSequence = 0;
  const metadata = new WeakMap();
  const destroy = (socket, reason) => { const info=metadata.get(socket); if(info && !info.closeReason)info.closeReason=reason; socket.destroy(); };
  const track = (socket, role='adb-upstream', channel=null) => {
    const info={connectionId:++connectionSequence,role,channel,openedAtMs:Date.now(),lastReadAtMs:null,closeReason:''};
    metadata.set(socket,info);sockets.add(socket);
    const details=()=>({...info,bytesRead:socket.bytesRead,bytesWritten:socket.bytesWritten,endpoint});
    socket.on('data',()=>{info.lastReadAtMs=Date.now();});
    socket.on('end',()=>event('socket-peer-end',details()));
    socket.on('timeout',()=>event('socket-timeout',details()));
    socket.on('error',error=>event('socket-error',{...details(),error:error.message,code:error.code,syscall:error.syscall}));
    socket.once('close',hadError=>{sockets.delete(socket);event('socket-close',{...details(),hadError,origin:info.closeReason?'local-cleanup':'peer-or-socket-error'});});
    if(closed)destroy(socket,'transport-already-closed');return socket;
  };
  const pair = (client, upstream) => {
    client.once('close',()=>destroy(upstream,`paired-socket-${metadata.get(client)?.connectionId}-closed`));
    upstream.once('close',()=>destroy(client,`paired-socket-${metadata.get(upstream)?.connectionId}-closed`));
  };
  async function verify() {
    const version = await query(endpoint, 'host:version', timeoutMs, signal, track);
    if (parseInt(version, 16) !== 41) throw Error('ADB protocol mismatch; shared server left unchanged');
    return { version, line: deviceLine(await query(endpoint, 'host:devices-l', timeoutMs, signal, track), serial) };
  }
  const probe=await verify(); event('server-probe',{version:probe.version,deviceState:'device',endpoint});
  const fail = (socket, error) => { if (!socket.destroyed) socket.end(Buffer.concat([Buffer.from('FAIL'), packet(error.message)])); event('transport-error', { error: error.message }); };
  async function deviceConnection(socket, service, channel) {
    if (closed || socket.destroyed) return;
    const upstream = await connect(endpoint, timeoutMs, s=>track(s,'forward-upstream',channel)), input = reader(upstream);
    event('video-adb-connected');
    upstream.write(packet(`host:transport:${serial}`)); await okay(input);
    event('video-device-selected');
    upstream.write(packet(service)); await okay(input); input.release();
    event('video-socket-ready',{channel,connectionId:metadata.get(upstream)?.connectionId});
    if (closed || socket.destroyed) { upstream.destroy(); return; }
    if (!videoClaimed) {
      videoClaimed = true;
      const observer = observeScrcpyVideo(() => event('video-frame-received'), error => event('video-observer-error', {error:error.message}));
      upstream.on('data', observer.push);
    }
    upstream.setTimeout(0); socket.setTimeout(0); socket.pipe(upstream); upstream.pipe(socket);
    upstream.once('data',chunk=>event('video-first-bytes',{bytes:chunk.length}));
    upstream.resume(); socket.resume();
    pair(socket,upstream);
  }
  async function forward(socket, operation) {
    if (operation.startsWith('killforward:')) {
      const key = operation.slice(12), server = forwards.get(key);
      if (!server) throw Error('Forward is not owned by this recording');
      forwards.delete(key); server.close(); socket.end('OKAYOKAY'); return;
    }
    const match = /^forward:(?:norebind:)?tcp:(\d+);(localabstract:[A-Za-z0-9_.-]+)$/.exec(operation);
    if (!match || Number(match[1]) > 65535) throw Error('Unsupported recording forward');
    const target = match[2], server = net.createServer(client => {
      const channel=++channelSequence;event('video-client-connected',{channel});
      track(client,'forward-client',channel); client.pause(); deviceConnection(client, target,channel).catch(error => { event('video-connect-error', {error:error.message,code:error.code,channel}); destroy(client,'forward-connect-failed'); });
    });
    server.on('error', error => event('listener-error', {error:error.message}));
    // Never rebind somebody else's listener, even when adb omits norebind.
    const port = await listen(server, Number(match[1]));
    if (closed) { server.close(); throw Error('Recording transport closed'); }
    forwards.set(`tcp:${port}`, server); event('video-tunnel', { port });
    socket.end(Buffer.concat([Buffer.from('OKAYOKAY'), ...(Number(match[1]) === 0 ? [packet(String(port))] : [])]));
  }
  async function handle(socket) {
    const input = reader(socket), service = await input.message();
    if (service === 'host:version') { const {version} = await verify(); socket.end(Buffer.concat([Buffer.from('OKAY'), packet(version)])); return; }
    if (service === 'host:devices' || service === 'host:devices-l') {
      const {line} = await verify(); socket.end(Buffer.concat([Buffer.from('OKAY'), packet(service.endsWith('-l') ? `${line}\n` : `${serial}\tdevice\n`)])); return;
    }
    const prefix = `host-serial:${serial}:`;
    if (service.startsWith(prefix)) {
      const operation = service.slice(prefix.length);
      if (operation.startsWith('forward:') || operation.startsWith('killforward:')) return forward(socket, operation);
      if (!['features', 'get-state', 'get-serialno', 'get-devpath'].includes(operation)) throw Error('Recording host operation denied');
    } else if (service === `host:transport:${serial}` || service === `host:tport:serial:${serial}`) {
      const upstream = await connect(endpoint, timeoutMs, track), remote = reader(upstream);
      upstream.write(packet(service)); await okay(remote);
      socket.write(service.startsWith('host:tport:') ? Buffer.concat([Buffer.from('OKAY'), await remote.read(8)]) : 'OKAY');
      const deviceService = await input.message();
      if (deviceService.startsWith('host:forward:') || deviceService.startsWith('host:killforward:')) { upstream.destroy(); return forward(socket, deviceService.slice(5)); }
      if (!/^(shell(?:,|:)|exec:|sync:)/.test(deviceService) && !['host:features','host:get-state','host:get-serialno','host:get-devpath'].includes(deviceService)) { upstream.destroy(); throw Error('Recording device service denied'); }
      remote.release();
      upstream.write(packet(deviceService)); input.release();
      upstream.setTimeout(0); socket.setTimeout(0); socket.pipe(upstream); upstream.pipe(socket); upstream.resume(); socket.resume();
      pair(socket,upstream); return;
    } else if (!['host:host-features', 'host:features'].includes(service)) throw Error('Unscoped or server lifecycle operation denied');
    const upstream = await connect(endpoint, timeoutMs, track); input.release();
    upstream.write(packet(service)); upstream.pipe(socket); socket.pipe(upstream); socket.resume();
    pair(socket,upstream);
  }
  const server = net.createServer(socket => { track(socket,'adb-client'); socket.setTimeout(timeoutMs,()=>destroy(socket,'handshake-timeout')); handle(socket).catch(error=>fail(socket,error)); });
  server.on('error', error => event('listener-error', {error:error.message}));
  let port;
  try { port = await listen(server); } catch (error) { for (const socket of sockets) socket.destroy(); throw error; }
  event('proxy-ready', { port });
  const transport = { port, socket: `tcp:127.0.0.1:${port}`, endpoint, serial, close(reason='transport-cleanup') {
    if (closed) return; closed = true; signal?.removeEventListener('abort',abort); activeTransports.delete(transport); server.close(); for (const listener of forwards.values()) listener.close(); forwards.clear(); event('transport-close-requested',{reason,activeSockets:sockets.size}); for (const socket of sockets) destroy(socket,reason); event('closed',{reason});
  } };
  const abort=()=>transport.close('preparation-aborted');signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){transport.close();throw signal.reason || Error('Recording stopped');}
  activeTransports.add(transport);return transport;
}
function closeAllScrcpyTransports() { for (const transport of [...activeTransports]) transport.close('application-shutdown'); }
function scopedAdbEnvironment(base, adb, socket) {
  const env={...base,ADB:adb,ADB_PATH:adb,SCRCPY_ADB:adb,ADB_SERVER_SOCKET:socket};
  for(const key of ['ANDROID_ADB_SERVER_PORT','ANDROID_ADB_SERVER_ADDRESS','ANDROID_SERIAL'])delete env[key];
  return env;
}
module.exports = { resolveLocalAdbEndpoint, resolveScrcpyEndpoint, createScrcpyTransport, closeAllScrcpyTransports, scopedAdbEnvironment, packet, reader };
