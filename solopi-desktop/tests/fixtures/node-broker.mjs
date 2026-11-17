import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
// The production broker must run Electron in app mode. These fixtures are plain
// Node scripts, including when the test runner itself is Electron-as-Node.
export function nodeFixtureSpawn(t) {
 const children=[];
 t.after(async()=>{
  for(const {child,closed} of children){
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
   let timer;const stopped=await Promise.race([closed.then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),2000);})]);clearTimeout(timer);
   if(!stopped){child.kill('SIGKILL');await closed;}
   assert.ok(child.exitCode!==null||child.signalCode!==null,'fixture process must be reaped');
  }
 });
 return (command,args,options)=>{
  assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined,'real broker must retain app-mode environment');
  const child=spawn(command,args,{...options,detached:false,env:{...options.env,ELECTRON_RUN_AS_NODE:'1'}});
  const closed=new Promise(resolve=>child.once('close',resolve));
  children.push({child,closed});return child;
 };
}
