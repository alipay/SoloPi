const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const {scrcpyVersion,deployServer}=require('./scrcpy-deployment');
const run = (file, args, options) => new Promise((resolve, reject) => execFile(file, args, options, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));

// scrcpy's documented raw stream protocol avoids the recorder/muxer buffer.
// Each preview owns its ADB forward and server process; recordings are separate.
async function openScrcpyStream(media, serial, { spawnProcess, signal, onChild, onError, execute = run, connect = net.createConnection, startupTimeoutMs = 45000, onMetrics = () => {} }) {
  const adb = media.adb || media.env?.ADB;
  if (!adb || !media.scrcpyServer) throw Error('缺少 ADB 或 scrcpy server 运行时');
  const options = { env: media.env, timeout: 10000, maxBuffer: 65536, signal };
  const scid = randomBytes(4).readUInt32BE() & 0x7fffffff;
  const socketName = `scrcpy_${scid.toString(16).padStart(8, '0')}`;
  let remote;
  let port, socket, child, closing;
  const close = () => closing ||= (async () => {
    socket?.destroy();
    if (child && child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
    // Remove only this preview's forward and temporary server, never another task's.
    const cleanup = { env: media.env, timeout: 3000, maxBuffer: 65536 };
    if (port) await execute(adb, ['-s',serial,'forward','--remove',`tcp:${port}`], cleanup).catch(()=>{});
  })();
  try {
    signal.throwIfAborted();
    let version;
    const preparationStartedAt=Date.now();
    // The forward does not depend on deployment or version probing. Await both
    // branches even on failure so a late-created owned forward can be removed.
    const prepared=await Promise.allSettled([
      Promise.all([scrcpyVersion(media,execute,options).then(v=>{onMetrics({stage:'version-probe',durationMs:Date.now()-preparationStartedAt});return v;}),deployServer(media,adb,serial,execute,options).then(d=>{onMetrics({stage:'server-deploy',source:d.uploaded?'uploaded':'device-cache',durationMs:Date.now()-preparationStartedAt});return d;})]).then(([v,deployment])=>{version=v;remote=deployment.remote;}),
      execute(adb,['-s',serial,'forward','tcp:0',`localabstract:${socketName}`],options).then(value=>{
        onMetrics({stage:'adb-forward',durationMs:Date.now()-preparationStartedAt});port=String(value).trim();if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('ADB 未返回有效视频端口');
      }),
    ]);
    const failure=prepared.find(r=>r.status==='rejected');if(failure)throw failure.reason;
    signal.throwIfAborted();
    const streamStartedAt=Date.now();
    child = spawnProcess(adb, ['-s',serial,'shell',`CLASSPATH=${remote}`,'app_process','/','com.genymobile.scrcpy.Server',version,
      `scid=${scid.toString(16)}`,'log_level=info','tunnel_forward=true','audio=false','control=false','cleanup=false',
      'send_device_meta=false','send_dummy_byte=false','send_codec_meta=false','send_frame_meta=true',
      'video_codec=h264','video_codec_options=i-frame-interval=1','max_size=960','max_fps=30'], {env:media.env,stdio:['ignore','pipe','pipe']});
    onChild(child);
    // ADB forward may accept before the device socket exists. Retry empty closes,
    // but only until actual stream data arrives; never restart an established stream.
    const deadline = Date.now()+startupTimeoutMs;
    while (Date.now()<deadline) {
      signal.throwIfAborted();
      socket = connect({host:'127.0.0.1',port:Number(port)});
      const first = await new Promise((resolve,reject)=>{
        const candidate=socket;let settled=false;
        const finish=(value,error)=>{
          if(settled)return;settled=true;
          clearTimeout(timer);signal.removeEventListener('abort',abort);
          candidate.removeListener('data',data);candidate.removeListener('error',empty);candidate.removeListener('close',empty);
          if(error)reject(error);else resolve(value);
        };
        const abort=()=>{finish(null,signal.reason || Error('投屏已停止'));candidate.destroy();};
        const data=chunk=>{candidate.pause();finish(chunk);};
        const empty=()=>finish(null);
        // An accepted forward is not yet a ready encoder. Keep that connection
        // until its first data, close, cancellation or the shared startup budget.
        const timer=setTimeout(()=>{finish(null,Object.assign(Error('scrcpy 原始视频首包超时'),{code:'SCRCPY_STREAM_START_TIMEOUT'}));candidate.destroy();},Math.max(1,deadline-Date.now()));
        candidate.once('data',data);candidate.once('error',empty);candidate.once('close',empty);
        signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();
      });
      if (first) {
        onMetrics({stage:'first-packet',durationMs:Date.now()-streamStartedAt});
        socket.on('error',onError);
        signal.addEventListener('abort',()=>socket.destroy(),{once:true});
        return {socket,first,close};
      }
      socket.destroy();
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Object.assign(Error('scrcpy 原始视频流连接超时'),{code:'SCRCPY_STREAM_START_TIMEOUT'});
  } catch(error) {if(!signal.aborted)onError(error);await close();throw error;}
}
module.exports={openScrcpyStream};
