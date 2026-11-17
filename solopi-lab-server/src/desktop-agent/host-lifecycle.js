const {createHash}=require('node:crypto');
// Host transports differ; reuse/invalidation and concurrent creation do not.
function hostKey({provider,tools,screenMode,skills}){
 return createHash('sha256').update(JSON.stringify({provider,screenMode,skills,tools:tools?.map(t=>({name:t.name,description:t.description,schema:t.schema,readOnly:t.readOnly}))})).digest('hex');
}
class HarnessHostCache{
 constructor({hosts=new Map(),creating=new Map()}={}){this.hosts=hosts;this.creating=creating;this.closed=false;}
 async get(id,key,create){
  if(this.closed)throw Error('Harness host cache closed');
  if(this.creating.has(id)){await this.creating.get(id);return this.get(id,key,create);}
  const existing=this.hosts.get(id);if(existing?.reuseKey===key)return existing;
  const pending=(async()=>{if(existing){this.hosts.delete(id);await existing.dispose();}const host=await create();if(this.closed){await host.dispose();throw Error('Harness host cache closed');}host.reuseKey=key;this.hosts.set(id,host);return host;})();
  this.creating.set(id,pending);try{return await pending;}finally{if(this.creating.get(id)===pending)this.creating.delete(id);}
 }
 async drop(id){const host=this.hosts.get(id);this.hosts.delete(id);await host?.dispose();}
 async close(){this.closed=true;await Promise.allSettled([...this.creating.values()]);await Promise.allSettled([...this.hosts.keys()].map(id=>this.drop(id)));}
}
module.exports={hostKey,HarnessHostCache};
