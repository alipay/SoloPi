const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const pools=new Map();
async function scheduledRequest(options,run){
  if(!options.provider.requestPolicy) return run();
  const key=createHash('sha256').update(JSON.stringify([options.provider.baseUrl,options.provider.model,options.provider.apiKey])).digest('hex');
  let pool=pools.get(key);if(!pool){pool={tail:Promise.resolve(),last:0,users:0};pools.set(key,pool);}
  pool.users++;let release;const previous=pool.tail;pool.tail=new Promise(r=>{release=r;});
  options.onDelta?.({stage:'queued'});
  let acquired=false;
  try {
    // Cancellation must not let the next waiter overtake a still active predecessor.
    if(options.signal?.aborted)options.signal.throwIfAborted();
    await new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(options.signal.reason);},cleanup=()=>options.signal?.removeEventListener('abort',abort);options.signal?.addEventListener('abort',abort,{once:true});previous.then(()=>{cleanup();resolve();});});
    acquired=true;
    options.signal?.throwIfAborted();
    const wait=Math.max(0,Math.max(pool.cooldown || 0,pool.last+(options.provider.requestPolicy.minIntervalMs ?? 1000))-Date.now());
    if(wait)await delay(wait,undefined,{signal:options.signal});
    options.signal?.throwIfAborted();pool.last=Date.now();
    try{return await run();}catch(error){if(require('./rate-limit-retry').isRateLimit(error))pool.cooldown=Date.now()+5000;throw error;}
  } finally {
    if(acquired)release();else void previous.then(release);
    pool.users--;
    if(pools.size>64)for(const [old,value] of pools){if(value.users===0&&old!==key){pools.delete(old);break;}}
  }
}
module.exports={scheduledRequest};
