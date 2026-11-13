// UI view is separate from the durable/model history. Full call details are lazy.
const callCache=new WeakMap(),messageCache=new WeakMap();
function projectCall(c){
 const previous=callCache.get(c);
 if(previous && Object.keys(c).length===Object.keys(previous.original).length && Object.keys(c).every(k=>c[k]===previous.original[k]))return previous.view;
 const {args,result,...meta}=c;
 const view={...meta,args:c.status==='pending'?args:undefined,result:result && typeof result==='object'?Object.fromEntries(['success','successScope','errorCode','taskId','submitted'].filter(k=>result[k]!==undefined).map(k=>[k,result[k]])):undefined,detailsAvailable:true};
 callCache.set(c,{original:{...c},view});return view;
}
function projectMessage(m){
 if(Object.isFrozen(m) && messageCache.has(m))return messageCache.get(m);
 if(m.role==='tool'){const view= {role:m.role,tool_call_id:m.tool_call_id,createdAt:m.createdAt};if(Object.isFrozen(m))messageCache.set(m,view);return view;}
 const view={...m,...(m.tool_calls?{tool_calls:m.tool_calls.map(c=>({id:c.id,type:c.type,function:{name:c.function?.name}}))}:{})};if(Object.isFrozen(m))messageCache.set(m,view);return view;
}
function sessionView(s){return {...s,messages:s.messages.map(projectMessage),calls:s.calls.map(projectCall)};}
module.exports={sessionView,projectCall,projectMessage};
