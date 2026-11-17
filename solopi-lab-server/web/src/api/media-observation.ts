import {recordMediaDiagnostic} from './media-diagnostics';
type Emit=(stage:string,code:string,durationMs:number,failed:boolean)=>void;
/** One connection attempt, from user/automatic intent to an actual canvas frame. */
export function mediaObservation(clientId:string,trigger:'initial'|'recovery',options:{now?:()=>number;emit?:Emit;attemptId?:string}={}){
 const now=options.now??(()=>performance.now()),started=now(),attemptId=options.attemptId??crypto.randomUUID();
 const send:Emit=options.emit??((stage,code,durationMs,failed)=>recordMediaDiagnostic(attemptId,clientId,stage,code,durationMs,!failed,'media.observation'));
 const seen=new Set<string>();let outcome=false,ended=false,hasFrame=false;
 const emit=(stage:string,code:string,failed=false)=>{if(ended||seen.has(stage))return;seen.add(stage);send(stage,code,Math.max(0,now()-started),failed);};
 emit('attempt',trigger);
 return {
  authorized(){emit('authorized','ok');},
  connected(){emit('connected','ok');},
  rendered(){if(outcome||ended)return;outcome=true;hasFrame=true;emit('first-frame','rendered');},
  timeout(){emit('first-frame-timeout','no-frame',true);},
  reason(code:string){emit('disconnect',code,true);},
  fail(code:string){if(ended)return;emit('abnormal',code,true);if(!outcome){outcome=true;emit('failed',code,true);}},
  end(reason:'user-stop'|'page-exit'|'replaced'){
   if(ended)return;
   if(!outcome){outcome=true;emit('cancelled',reason);}
   emit('ended',hasFrame?'after-frame:'+reason:reason);ended=true;
  },
 };
}
