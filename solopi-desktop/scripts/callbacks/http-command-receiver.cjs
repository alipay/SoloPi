#!/usr/bin/env node
// Generic signed HTTP -> configured command bridge, used by remote callback receivers.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {runManagedCommand,cancelAllManagedCommands}=require('../../electron/managed-command');
const idx=process.argv.indexOf('--config');if(idx<0)throw Error('--config required');const cfg=JSON.parse(fs.readFileSync(process.argv[idx+1]));
if(cfg.host!=='127.0.0.1'||!path.isAbsolute(cfg.command)||!cfg.args?.includes('{{eventFile}}'))throw Error('Use loopback and a fixed absolute command with argv');
const secret=fs.readFileSync(cfg.signingKeyFile,'utf8').trim();if(secret.length<32)throw Error('Signing key too short');fs.mkdirSync(cfg.directory,{recursive:true,mode:0o700});
const inFlight=new Map(),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const server=http.createServer(async(req,res)=>{
 const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.method!=='POST'||req.url!=='/callback')return reply(404,{accepted:false});
 const chunks=[];let size=0,body;
 try{for await(const b of req){size+=b.length;if(size>65536)return reply(413,{accepted:false});chunks.push(b);}body=Buffer.concat(chunks).toString('utf8');}catch{return reply(400,{accepted:false});}
 const timestamp=String(req.headers['x-solopi-timestamp']||''),signature=String(req.headers['x-solopi-signature']||''),id=String(req.headers['idempotency-key']||'');
 const expected='sha256='+crypto.createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
 if(!/^\d+$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^sha256=[a-f0-9]{64}$/.test(signature)||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))||!id||id.length>200)return reply(401,{accepted:false});
 let event;try{event=JSON.parse(body);if(event.specversion!=='1.0'||typeof event.id!=='string')throw Error();}catch{return reply(400,{accepted:false});}
 const key=hash(id),receiptPath=path.join(cfg.directory,key+'.receipt.json'),eventPath=path.join(cfg.directory,key+'.event.json');
 try {
  if(fs.existsSync(receiptPath)){
    if(fs.readFileSync(eventPath,'utf8')!==body)return reply(409,{accepted:false,error:'Idempotency key already binds another event'});
    return reply(202,JSON.parse(fs.readFileSync(receiptPath)));
  }
  if(inFlight.has(key)&&fs.readFileSync(eventPath,'utf8')!==body)return reply(409,{accepted:false,error:'Idempotency key already binds another event'});
  if(!inFlight.has(key))inFlight.set(key,(async()=>{
    fs.writeFileSync(eventPath,body,{mode:0o600});
    const r=await runManagedCommand(cfg.command,cfg.args.map(a=>a==='{{eventFile}}'?eventPath:a),{cwd:cfg.cwd||cfg.directory,timeout:15000,maxBuffer:65536});
    const receipt=JSON.parse(r.stdout);if(receipt.accepted!==true||receipt.eventId!==event.id)throw Error('Receipt mismatch');
    const tmp=receiptPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(receipt),{mode:0o600});fs.renameSync(tmp,receiptPath);return receipt;
  })());
  reply(202,await inFlight.get(key));
 }catch{reply(503,{accepted:false,error:'Delivery not acknowledged; receiver reconciliation required'});}finally{inFlight.delete(key);}
});
server.listen(cfg.port,cfg.host,()=>console.log(JSON.stringify({ready:true,port:server.address().port})));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{cancelAllManagedCommands();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),3000).unref();});
