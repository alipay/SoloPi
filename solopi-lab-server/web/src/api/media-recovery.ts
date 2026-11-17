// A server-ended subscription is recoverable only with an explicit end reason.
export function recoverableMediaClose(code:number|null,endedReason:string|null){
 return [1006,1012,1013].includes(code??0)||
  code===4409&&endedReason==='expired'||
  code===4404&&['client-closed','media-proc-restart','media-proc-stop'].includes(endedReason??'');
}
