'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {createScrcpyCapture,ClientMedia}=require('./media-client.cjs');
const {createWorkflowExecutionGate}=require('../workflow-execution-gate');
const id='01M6JVA2KF08T0VZ0ZZABRAQFJ';
const packet=(flags,b)=>{const h=Buffer.alloc(12);h.writeBigUInt64BE(flags);h.writeUInt32BE(b.length,8);return Buffer.concat([h,b]);};
const config=Buffer.from([0,0,0,1,0x67,0x42,0,0x1f,0,0,0,1,0x68,1]),key=Buffer.from([0,0,0,1,0x65,1]),delta=Buffer.from([0,0,0,1,0x41,1]);
class Socket extends EventTarget {constructor(){super();this.readyState=0;this.bufferedAmount=0;this.sent=[];queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}send(b){this.sent.push(b);}close(){if(this.readyState===3)return;this.readyState=3;this.dispatchEvent(Object.assign(new Event('close'),{code:1000}));}}
const turn=()=>new Promise(r=>setImmediate(r));
function setup(socketFactory){let source,ws,closed=0,opens=0;const gate=createWorkflowExecutionGate(),states=[];
 const capture=createScrcpyCapture({runtime:()=>({}),acquireDevice:t=>gate.acquire(t),openStream:async()=>{opens++;source=new PassThrough();return {socket:source,first:Buffer.concat([packet(1n<<63n,config),packet(1n<<62n,key)]),close:async()=>{closed++;source.destroy();}};}});
 const m=new ClientMedia({connector:{config:{serverUrl:'https://isolated.test'},state:{clientId:id},session:{epoch:1}},resolveDevice:async()=>({serial:'isolated'}),capture,socketFactory:()=>ws=socketFactory?socketFactory():new Socket(),onState:s=>states.push(s)});
 return {m,gate,states,get source(){return source},get ws(){return ws},get closed(){return closed},get opens(){return opens},auth:{mediaSessionId:id,deviceId:id,dataPlanePath:'/ws/media/{ticket}',expiresAt:new Date(Date.now()+60000).toISOString(),clientTicket:{role:'client',oneTimeUse:true,token:'x'.repeat(40),expiresAt:new Date(Date.now()+60000).toISOString()}}};
}
for(const changing of [false,true])test(`source close without end/error releases capture and lease (${changing?'changing':'static'})`,async()=>{
 const x=setup();await x.m.authorize(x.auth);if(changing)x.source.write(packet(33000n,delta));await turn();
 x.source.emit('close');await turn();await turn();
 try{assert.equal(x.m.active,null,'source close must stop active capture');assert.equal(x.closed,1);assert.equal(x.m.state.status,'error');assert.equal(x.m.state.errorCode,'MEDIA_CAPTURE_CLOSED');const lease=x.gate.acquire({id:'after',reservedDeviceSerials:['isolated']});lease.release();assert.equal(x.opens,1,'no automatic ticket reuse or second capture');}
 finally{await x.m.close();}
});
for(const changing of [false,true])test(`abrupt WSS close is explicit and late AU cannot revive (${changing?'changing':'static'})`,async()=>{
 const x=setup();await x.m.authorize(x.auth);if(changing)x.source.write(packet(33000n,delta));await turn();const sent=x.ws.sent.length;
 x.ws.readyState=3;x.ws.dispatchEvent(Object.assign(new Event('close'),{code:1006}));await turn();await turn();
 assert.equal(x.closed,1);assert.equal(x.m.state.status,'error');assert.equal(x.m.state.errorCode,'MEDIA_CONNECTION_FAILED');assert.equal(x.m.active,null);x.source.emit('data',packet(66000n,delta));assert.equal(x.ws.sent.length,sent);const lease=x.gate.acquire({id:'after',reservedDeviceSerials:['isolated']});lease.release();await x.m.close();assert.equal(x.closed,1);
});
test('intentional close stays stopped, suppresses late source close and releases exactly once',async()=>{
 const x=setup();await x.m.authorize(x.auth);await x.m.close();x.source.emit('close');await turn();assert.equal(x.m.state.status,'stopped');assert.equal(x.closed,1);assert.equal(x.states.some(s=>s.status==='error'),false);
});
for(const changing of [false,true])test(`real loopback WebSocket transport reset releases Broker (${changing?'changing':'static'})`,async t=>{
 const http=require('node:http'),crypto=require('node:crypto');let peer;
 const server=http.createServer();server.on('upgrade',(req,socket)=>{peer=socket;const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.on('data',()=>{});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const x=setup(()=>new WebSocket('ws://127.0.0.1:'+server.address().port));
 try{await x.m.authorize(x.auth);if(changing)x.source.write(packet(33000n,delta));const at=performance.now();peer.destroy();while(x.closed!==1&&performance.now()-at<1000)await new Promise(r=>setTimeout(r,5));assert.equal(x.closed,1);assert.equal(x.m.state.status,'error');assert.equal(x.m.state.errorCode,'MEDIA_CONNECTION_FAILED');const lease=x.gate.acquire({id:'after',reservedDeviceSerials:['isolated']});lease.release();t.diagnostic(JSON.stringify({injected:'loopback TCP destroy without close frame',changing,observedCleanupMs:performance.now()-at}));}
 finally{await x.m.close();peer?.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
