const listeners=new WeakMap();
export function subscribeTaskUpdates(db,listener){const set=listeners.get(db)||new Set();set.add(listener);listeners.set(db,set);return()=>{set.delete(listener);if(!set.size)listeners.delete(db);};}
export function notifyTaskUpdate(db,task){for(const listener of [...(listeners.get(db)||[])]){try{listener(task);}catch{/* The persisted push remains authoritative; periodic reconciliation recovers. */}}}
