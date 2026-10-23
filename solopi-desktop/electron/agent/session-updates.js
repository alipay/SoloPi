// Keep a lightweight snapshot of immutable messages and shallow ledger fields.
// Changed history sends a replacement suffix; completed calls are not retransmitted.
const {isDeepStrictEqual}=require('node:util');
function sameContent(a,b) {
  if(a===b || isDeepStrictEqual(a,b))return true;
  // Disk rehydration omits undefined object fields just as IPC JSON does.
  return JSON.stringify(a)===JSON.stringify(b);
}
function createSessionUpdates() {
  const snapshots = new Map();
  return {
    next(s) {
      const old=snapshots.get(s.id);
      const {messages,calls}=s;
      const metadata=Object.fromEntries(['id','title','status','updatedAt','error','errorDetails','streaming','retry','watch','approvalMode','contextState','queuedMessages','pendingMessages'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
      let from=0;
      if(old) while(from<old.messages.length && from<messages.length && sameContent(old.messages[from],messages[from])) from++;
      const changed=calls.filter(c=>{
        const previous=old?.calls.get(c.id);
        if(!previous)return true;
        if(Object.keys(c).length===Object.keys(previous).length && Object.keys(c).every(k=>c[k]===previous[k]))return false;
        return !sameContent(c,previous);
      });
      snapshots.set(s.id,{messages:[...messages],calls:new Map(calls.map(c=>[c.id,{...c}]))});
      // Keep only the most recently updated sessions, not an unbounded second history.
      if(snapshots.size>4) snapshots.delete(snapshots.keys().next().value);
      return {metadata,from,messages:messages.slice(from),calls:changed,callIds:calls.map(c=>c.id),reset:!old};
    }
  };
}
module.exports={createSessionUpdates};
