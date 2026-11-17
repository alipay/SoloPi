const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {runManagedCommand} = require('./managed-command');
const {isAuthoritativeTaskTerminal} = require('./workflow-task-events');
const key = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function createTaskCallbacks({directory, readTask, now=Date.now, fetchImpl=globalThis.fetch, run=runManagedCommand,onSettled=()=>{}}) {
  const root=path.join(directory,'task-callbacks');let timer,stopped=false,pumping=false,controller;
  const file=(kind,id)=>path.join(root,kind,key(id)+'.json');
  const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const write=(p,value)=>{fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});const tmp=p+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600});fs.renameSync(tmp,p);};
  const list=kind=>{const dir=path.join(root,kind);return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>read(path.join(dir,n))):[];};
  function targetSet(value) {
    if(!value||typeof value.id!=='string'||!value.id||value.id.length>200)throw Error('target.id is required');
    if(value.transport==='http') {
      const u=new URL(value.url);if(u.username||u.password||u.hash)throw Error('URL credentials/fragments forbidden');
      if(u.protocol!=='https:'&&!(value.allowLoopbackHttp===true&&u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)))throw Error('HTTPS required (explicit loopback HTTP allowed for tests)');
      if(value.signingKeyEnv&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.signingKeyEnv))throw Error('Invalid signingKeyEnv');
      if(!value.signingKeyEnv&&!value.allowLoopbackHttp)throw Error('HTTP signingKeyEnv required');
    } else if(value.transport==='command') {
      if(!path.isAbsolute(value.command)||!Array.isArray(value.args)||value.args.length>40||value.args.some(a=>typeof a!=='string')||!value.args.includes('{{eventFile}}'))throw Error('Absolute command and argv with {{eventFile}} required');
      if(value.cwd&&!path.isAbsolute(value.cwd))throw Error('cwd must be absolute');
    } else throw Error('Unknown callback transport');
    const target={id:value.id,transport:value.transport,...(value.transport==='http'?{url:value.url,allowLoopbackHttp:!!value.allowLoopbackHttp,signingKeyEnv:value.signingKeyEnv||''}:{command:value.command,args:value.args,cwd:value.cwd||directory}),updatedAt:new Date(now()).toISOString()};
    write(file('targets',target.id),target);return {success:true,targetId:target.id};
  }
  function subscribe(value) {
    if(!value||!value.id||!value.taskId||!value.targetId||[value.id,value.taskId,value.targetId].some(x=>typeof x!=='string'||x.length>200))throw Error('id/taskId/targetId required');
    if(!read(file('targets',value.targetId)))throw Error('Callback target not configured');
    if(JSON.stringify(value.context||{}).length>8000)throw Error('Context too large; do not include secrets');
    const sub={id:value.id,taskId:value.taskId,targetId:value.targetId,context:value.context||{},enabled:true,status:'awaiting',createdAt:new Date(now()).toISOString()};
    const old=read(file('subscriptions',sub.id));
    if(old){if(old.taskId!==sub.taskId||old.targetId!==sub.targetId||JSON.stringify(old.context)!==JSON.stringify(sub.context))throw Error('Subscription ID already binds another request');return {success:true,subscription:old};}
    write(file('subscriptions',sub.id),sub);enqueueTask(readTask(sub.taskId));return {success:true,subscription:sub};
  }
  function instanceId() {
    fs.mkdirSync(root,{recursive:true,mode:0o700});const p=path.join(root,'instance-id');
    try{fs.writeFileSync(p,crypto.randomUUID(),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    return fs.readFileSync(p,'utf8');
  }
  function enqueueTask(task) {
    if(!task||!isAuthoritativeTaskTerminal(task))return;
    // Reconstructible identity survives event-history pruning and restarts.
    const matching=list('subscriptions').filter(s=>s.enabled&&(!s.status||s.status==='awaiting')&&s.taskId===task.id);if(!matching.length)return;
    const source='urn:solopi:installation:'+instanceId(),eventId=key(`${source}:${task.id}:${task.finishedAt}:finished`);
    for(const sub of matching) {
      const deliveryId=key(`${sub.id}:${eventId}`),p=file('deliveries',deliveryId);const existing=read(p);if(existing){sub.status=existing.status==='pending'?'queued':existing.status;write(file('subscriptions',sub.id),sub);continue;}
      const counts=task.summary||{};
      const event={specversion:'1.0',id:eventId,source,type:'solopi.task.finished',subject:task.id,time:task.finishedAt,datacontenttype:'application/json',data:{taskId:task.id,status:task.status,summary:{caseCount:Number(counts.caseCount||task.total||0),passedCount:Number(counts.successCount||counts.passedCount||0),failedCount:Number(counts.failedCount||0),stoppedCount:Number(counts.stoppedCount||0)},report:{taskId:task.id,available:task.reportPackageAvailable===true||!!(task.reportPackagePath||task.reportPackage?.path)},correlationId:sub.id,context:sub.context}};
      write(p,{id:deliveryId,subscriptionId:sub.id,targetId:sub.targetId,event,status:'pending',attempts:0,nextAttemptAt:now(),createdAt:new Date(now()).toISOString()});
      sub.status='queued';write(file('subscriptions',sub.id),sub);
    }
  }
  async function send(target,delivery) {
    const body=JSON.stringify(delivery.event);
    if(target.transport==='http') {
      const timestamp=String(Math.floor(now()/1000)),headers={'Content-Type':'application/cloudevents+json','Idempotency-Key':delivery.id,'X-SoloPi-Timestamp':timestamp};
      if(target.signingKeyEnv){const secret=process.env[target.signingKeyEnv];if(!secret)throw Error('Callback signing key unavailable');headers['X-SoloPi-Signature']='sha256='+crypto.createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');}
      controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
      try {const r=await fetchImpl(target.url,{method:'POST',headers,body,signal:controller.signal,redirect:'error'});await r.body?.cancel();if(!r.ok)throw Error('Callback HTTP '+r.status);return {accepted:true,httpStatus:r.status};}finally{clearTimeout(timeout);controller=null;}
    }
    const eventPath=file('payloads',delivery.id);write(eventPath,delivery.event);
    const result=await run(target.command,target.args.map(a=>a==='{{eventFile}}'?eventPath:a),{cwd:target.cwd,timeout:15000,maxBuffer:65536});
    let receipt;try{receipt=JSON.parse(result.stdout);}catch{throw Error('Callback command missing JSON receipt');}
    if(receipt.eventId!==delivery.event.id||receipt.accepted!==true)throw Error('Callback command receipt mismatch');
    return {accepted:true,receiptId:String(receipt.receiptId||'').slice(0,200)};
  }
  async function pump() {
    if(stopped||pumping)return;pumping=true;const lock=path.join(root,'dispatch.lock');let locked=false;
    try {
      if(!fs.existsSync(root))return;
      try{fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner'),String(process.pid));locked=true;}catch(e){if(e.code!=='EEXIST')throw e;let owner;try{owner=Number(fs.readFileSync(path.join(lock,'owner'),'utf8'));}catch(error){if(error.code==='ENOENT'&&now()-fs.statSync(lock).mtimeMs>30000)fs.rmSync(lock,{recursive:true,force:true});return;}if(owner!==process.pid){try{process.kill(owner,0);}catch(error){if(error.code==='ESRCH')fs.rmSync(lock,{recursive:true,force:true});}}return;}
      for(const sub of list('subscriptions').filter(s=>s.enabled&&(!s.status||s.status==='awaiting')))enqueueTask(readTask(sub.taskId));
      for(const d of list('deliveries').filter(d=>d.status==='pending'&&d.nextAttemptAt<=now()).slice(0,10)) {
        if(stopped)break;const sub=read(file('subscriptions',d.subscriptionId));if(!sub?.enabled)continue;
        d.attempts++;write(file('deliveries',d.id),d);
        try{const target=read(file('targets',d.targetId));if(!target)throw Error('Missing callback target');d.receipt=await send(target,d);d.status='delivered';d.deliveredAt=new Date(now()).toISOString();delete d.lastError;}
        catch{d.lastError='Delivery not acknowledged; check target/auth/network. Duplicate delivery is possible.';d.status=d.attempts>=5?'failed':'pending';d.nextAttemptAt=now()+Math.min(60000,1000*2**d.attempts);}
        write(file('deliveries',d.id),d);
        if(d.status==='delivered'||d.status==='failed'){const latest=read(file('subscriptions',sub.id));if(latest)write(file('subscriptions',sub.id),{...latest,status:d.status});}
      }
    } finally {if(locked)fs.rmSync(lock,{recursive:true,force:true});pumping=false;onSettled();}
  }
  function status(){return {success:true,targets:list('targets').map(t=>({id:t.id,transport:t.transport})),subscriptions:list('subscriptions'),deliveries:list('deliveries').map(({event,...d})=>({...d,eventId:event.id,taskId:event.subject}))};}
  function disable(id){const p=file('subscriptions',id),s=read(p);if(!s)throw Error('Unknown subscription');s.enabled=false;write(p,s);return {success:true};}
  function retry(id){const p=file('deliveries',id),d=read(p);if(!d||d.status!=='failed')throw Error('Only exhausted failed deliveries can be explicitly retried');const sub=read(file('subscriptions',d.subscriptionId));if(!sub?.enabled)throw Error('Subscription disabled');sub.status='queued';write(file('subscriptions',sub.id),sub);d.status='pending';d.attempts=0;d.nextAttemptAt=now();write(p,d);return {success:true,deliveryId:id};}
  return {targetSet,subscribe,enqueueTask,pump,status,disable,retry,hasPending(){return pumping||list('deliveries').some(d=>d.status==='pending'&&read(file('subscriptions',d.subscriptionId))?.enabled);},start(){stopped=false;if(!timer){timer=setInterval(()=>void pump().catch(()=>{}),2000);timer.unref();}void pump().catch(()=>{});},stop(){stopped=true;clearInterval(timer);timer=null;controller?.abort();}};
}
module.exports={createTaskCallbacks};
