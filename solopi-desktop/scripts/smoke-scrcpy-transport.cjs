// Isolated native ADB client compatibility check. All sockets are fake loopback
// endpoints; this never selects a real device or contacts the shared ADB server.
const net=require('node:net'),assert=require('node:assert/strict'),{execFile}=require('node:child_process');
const {createScrcpyTransport,packet,reader}=require(process.argv[3] || '../electron/scrcpy-transport');
const run=(file,args,env)=>new Promise((resolve,reject)=>execFile(file,args,{env,timeout:5000},(e,out,err)=>e?reject(Object.assign(e,{stderr:err})):resolve(out.trim())));
(async()=>{
 const clients=new Set(),calls=[];
 const server=net.createServer(socket=>{
  clients.add(socket);socket.on('error',()=>{});socket.once('close',()=>clients.delete(socket));
  (async()=>{const r=reader(socket),service=await r.message();calls.push(service);
   let value='';
   if(service==='host:version')value='0029';
   else if(service==='host:devices-l')value='fixture-native\tdevice model:Fixture transport_id:42\n';
   else if(service.endsWith(':get-state'))value='device';
   else if(service.startsWith('host:transport:')||service.startsWith('host:tport:serial:')){
    socket.write(service.startsWith('host:tport:')?Buffer.concat([Buffer.from('OKAY'),Buffer.from([42,0,0,0,0,0,0,0])]):'OKAY');
    const selected=await r.message();calls.push(selected);
    if(selected==='host:get-state')socket.end(Buffer.concat([Buffer.from('OKAY'),packet('device')]));
    else {assert.equal(selected,'localabstract:fixture_video');socket.end('OKAYVIDEO');}return;
   }
   else assert.ok(['host:host-features','host:features','host-serial:fixture-native:features'].includes(service),service);
   socket.end(Buffer.concat([Buffer.from('OKAY'),packet(value)]));
  })().catch(e=>{socket.destroy();if(!e.message.includes('closed before response'))console.error(e.message);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let proxy;
 try{
  proxy=await createScrcpyTransport({endpoint:{host:'127.0.0.1',port:server.address().port},serial:'fixture-native'});
  const env={...process.env,ADB_SERVER_SOCKET:proxy.socket};delete env.ANDROID_ADB_SERVER_PORT;delete env.ANDROID_SERIAL;
  const adb=process.argv[2];if(!adb)throw Error('Pass an explicit native ADB executable');
  await run(adb,['start-server'],env);
  assert.match(await run(adb,['devices','-l'],env),/fixture-native\s+device/);
  assert.equal(await run(adb,['-s','fixture-native','get-state'],env),'device');
  const port=Number(await run(adb,['-s','fixture-native','forward','tcp:0','localabstract:fixture_video'],env));assert.ok(port>0);
  const socket=net.createConnection({host:'127.0.0.1',port}),r=reader(socket);assert.equal((await r.read(5)).toString(),'VIDEO');socket.destroy();
  await run(adb,['-s','fixture-native','forward','--remove',`tcp:${port}`],env);
  assert.ok(calls.every(s=>!s.includes('kill')&&!s.includes('forward')));
  console.log(JSON.stringify({success:true,nativeClient:true,startOnlyProbed:true,deviceScoped:true,localVideoBridge:true,realDevicesUsed:0}));
 }finally{proxy?.close();for(const socket of clients)socket.destroy();server.close();}
})().catch(e=>{console.error(e.stderr||e.stack);process.exitCode=1;});
