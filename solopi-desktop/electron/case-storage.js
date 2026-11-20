// Persist one versioned execution graph. Existing editor/engine contracts remain
// decoded at their boundaries; this module never executes or validates a case.
const {createHash}=require('node:crypto');
const FORMAT='solopi.workflow.v2',STORE='solopi.case-store.v2';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=message=>{throw Object.assign(Error(message),{code:'CASE_STORAGE_INVALID'});};
const policyKeys=['timeoutMs','postDelayMs','retry','continueOnError','acceptedExitCodes','onError','outputMapping'];
const edgeEditorKeys=['id','type','animated','style','labelStyle','labelBgStyle','selected'];
const sampleKeys=['sampleLog','sampleExtractText','samplePayload'];
// Revision hashes include JSON property order; content reuse must preserve it.
function sameRevisionValue(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const ka=Object.keys(a),kb=Object.keys(b);return ka.length===kb.length&&ka.every((k,i)=>k===kb[i]&&sameRevisionValue(a[k],b[k]));}
const revision=c=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
function split(value,keys){const a={},b={};for(const [k,v] of Object.entries(value||{})){const target=keys.includes(k)?a:b;if(k==='__proto__')Object.defineProperty(target,k,{value:v,enumerable:true,writable:true,configurable:true});else target[k]=v;}return [a,b];}
function encodeCase(testCase,edges,components=[],catalog={},hashes=new WeakMap(),versionsById=new Map()){
 if(testCase?.format===FORMAT)return testCase;
 if(!Array.isArray(testCase?.steps))return testCase; // Preserve incomplete drafts.
 const {steps,edges:ignored,components:local,...metadata}=testCase;
 const ids=steps.map(s=>s.id),indices=new Map(ids.map((id,i)=>[id,i]));
 if(indices.size!==ids.length||ids.some(id=>typeof id!=='string'||!id))fail('Cannot encode missing/duplicate node IDs');
 const effective=new Map([...components,...(local||[])].map(c=>[c.id,c]));
 const refs=new Map();
 const remember=c=>{let hash=hashes.get(c);if(hash)return hash;const known=versionsById.get(c.id)||[];for(const item of known)if(sameRevisionValue(c,item.component)){hashes.set(c,item.hash);return item.hash;}const serialized=JSON.stringify(c);hash=createHash('sha256').update(serialized).digest('hex');if(own(catalog,hash)){if(JSON.stringify(catalog[hash])!==serialized)fail('Component revision conflict');}else catalog[hash]=structuredClone(c);hashes.set(c,hash);known.push({component:c,hash});versionsById.set(c.id,known);return hash;};
 const editor=Object.create(null),nodes=Object.create(null),cleanup=Object.create(null);
 for(const step of steps){
  const {id,type,device,componentId,inputs,config,phase,argumentEncoding,...rest}=step;
  const typed=argumentEncoding?.protocol==='solopi.args.v1'?argumentEncoding.types:null;
  if(argumentEncoding!==undefined&&!typed)rest.argumentEncoding=argumentEncoding;
  const [policy,attributes]=split(rest,policyKeys),{name,...extra}=attributes;
  const node={op:type,...(device!==undefined?{device}:{}),...(name!==undefined?{name}:{}),...(Object.keys(extra).length?{extra}:{})};
  if(componentId!==undefined){if(!refs.has(componentId)&&effective.has(componentId))refs.set(componentId,remember(effective.get(componentId)));node.use={id:componentId,...(refs.has(componentId)?{revision:refs.get(componentId)}:{})};}
  if(inputs!==undefined){const [samples,args]=split(inputs,sampleKeys);node.args=args;if(Object.keys(samples).length)editor[id]={samples};}
  if(typed){node.typedArgs=Object.keys(typed);for(const key of node.typedArgs){const target=own(node.args||{},key)?node.args:editor[id]?.samples;if(!target||!own(target,key))fail('Missing typed argument');let value;try{value=JSON.parse(target[key]);}catch{fail('Typed argument is not valid JSON: '+key);}if((typed[key]==='number'&&typeof value!=='number')||(typed[key]==='null'&&value!==null)||(typed[key]==='json'&&(!value||typeof value!=='object')))fail('Typed argument type changed: '+key);target[key]=value;}}
  // Omit only exact defaults of this pinned component revision, and only when
  // the explicit inheritance record is smaller. Restore the original key set.
  if(node.use?.revision&&node.args){
   const params=effective.get(componentId)?.params||[];
   for(let i=0;i<params.length;i++){
    const p=params[i];if(!own(node.args,p.key)||!own(p,'defaultValue'))continue;
    const value=node.args[p.key],expected=p.defaultValue;
    if(value!==expected&&((!value||typeof value!=='object')||JSON.stringify(value)!==JSON.stringify(expected)))continue;
    // All other node fields are unchanged. Compare only the removed argument
    // and the added inheritance index, rather than serializing both full nodes.
    const removed=JSON.stringify(p.key).length+1+JSON.stringify(node.args[p.key]).length+(Object.keys(node.args).length>1?1:0);
    const added=node.inherit?String(i).length+1:'inherit'.length+4+String(i).length+2;
    if(added<removed){delete node.args[p.key];(node.inherit||(node.inherit=[])).push(i);}
   }
  }
  if(config!==undefined)node.settings=config;
  if(Object.keys(policy).length)node.policy=policy;
  if(phase!==undefined&&phase!=='cleanup')node.phase=phase;
  (phase==='cleanup'?cleanup:nodes)[id]=node;
 }
 const routes=[],routeEditor=[];
 for(const edge of edges||[]){
  if(!indices.has(edge.source)||!indices.has(edge.target))fail('Cannot encode an edge referencing a missing node');
  const {source,target,...rest}=edge,[appearance,attributes]=split(rest,edgeEditorKeys);
  routes.push(Object.keys(attributes).length?[indices.get(source),indices.get(target),attributes]:[indices.get(source),indices.get(target)]);
  routeEditor.push(appearance);
 }
 const defaultOrder=[...Object.keys(nodes),...Object.keys(cleanup)];
 const out={...metadata,format:FORMAT,nodes,...(Object.keys(cleanup).length?{cleanup}:{}),routes,
  ...(ids.some((id,i)=>id!==defaultOrder[i])?{order:ids}:{}),
  ...(local!==undefined?{localComponents:local.map(c=>remember(c))}:{}),
  ...((Object.keys(editor).length||routeEditor.some(e=>Object.keys(e).length))?{editor:{...(Object.keys(editor).length?{nodes:editor}:{}),...(routeEditor.some(e=>Object.keys(e).length)?{routes:routeEditor}:{})}}:{})};
 return out;
}
function decodeCase(document,catalog={},globalComponents=[],verified=new Set(),hashes=new WeakMap()){
 if(document?.format!==FORMAT){if(document?.format?.startsWith('solopi.workflow.'))fail('Unsupported workflow format');return document;}
 const {format,nodes,cleanup={},routes,order,editor={},localComponents,...metadata}=document;
 if(!nodes||typeof nodes!=='object'||Array.isArray(nodes)||!Array.isArray(routes))fail('Malformed compact workflow');
 const all={...nodes,...cleanup},ids=order||[...Object.keys(nodes),...Object.keys(cleanup)];
 if(ids.length!==Object.keys(all).length||new Set(ids).size!==ids.length||ids.some(id=>!own(all,id))||Object.keys(cleanup).some(id=>own(nodes,id)))fail('Invalid compact node order');
 const resolve=hash=>{const c=catalog[hash];if(!verified.has(hash)){if(!c||revision(c)!==hash)fail('Missing or corrupt component revision');verified.add(hash);}return c;};
 const currentHash=c=>{if(!hashes.has(c))hashes.set(c,revision(c));return hashes.get(c);};
 const steps=ids.map(id=>{
  const {op,device,use,args,settings,policy,inherit,typedArgs,extra={},...metadata}=all[id];
  if(use?.revision&&resolve(use.revision).id!==use.id)fail('Component identity differs from revision');
  const inherited=Object.create(null);
  if(inherit){if(!Array.isArray(inherit)||!use?.revision)fail('Invalid inherited component defaults');for(const index of inherit){const p=resolve(use.revision).params?.[index];if(!Number.isInteger(index)||!p||!own(p,'defaultValue')||own(args||{},p.key))fail('Invalid inherited parameter');inherited[p.key]=structuredClone(p.defaultValue);}}
  const values={...args,...inherited,...(editor.nodes?.[id]?.samples||{})},types={};
  if(typedArgs){if(!Array.isArray(typedArgs))fail('Invalid typed argument index');for(const key of typedArgs){if(!own(values,key))fail('Missing typed argument value');const v=values[key],type=v===null?'null':typeof v==='number'?'number':typeof v==='object'?'json':null;if(!type)fail('Invalid typed argument value');types[key]=type;values[key]=JSON.stringify(v);}}
  return {id,type:op,...(device!==undefined?{device}:{}),...metadata,...extra,...(own(cleanup,id)?{phase:'cleanup'}:{}),
   ...(use?{componentId:use.id}:{}),...(args!==undefined?{inputs:values}:{}),...(Object.keys(types).length?{argumentEncoding:{protocol:'solopi.args.v1',types}}:{}),
   ...(settings!==undefined?{config:settings}:{}),...(policy||{})};
 });
 const edges=routes.map((r,i)=>{
  if(!Array.isArray(r)||!Number.isInteger(r[0])||!Number.isInteger(r[1])||!ids[r[0]]||!ids[r[1]]||r.length>3)fail('Invalid compact route');
  return {...(editor.routes?.[i]||{}),...(r[2]||{}),source:ids[r[0]],target:ids[r[1]]};
 });
 const local=localComponents?.map(resolve);
 const globals=new Map(globalComponents.map(c=>[c.id,c]));
 const pinned=new Map((local||[]).map(c=>[c.id,c]));
 for(const node of Object.values(all))if(node.use?.revision){const c=resolve(node.use.revision);if(!globals.has(c.id)||currentHash(globals.get(c.id))!==node.use.revision)pinned.set(c.id,c);}
 return {...metadata,steps,edges,...(local!==undefined||pinned.size?{components:[...pinned.values()]}:{})};
}
function compileDocument(document,state={}){
 if(document?.format!==FORMAT)return document;
 const versions={};
 for(const c of [...(state.components||[]),...(state.cases||[]).flatMap(c=>c.components||[])])versions[revision(c)]=c;
 for(const [hash,c]of Object.entries(document.componentVersions||{})){if(revision(c)!==hash)fail('Invalid supplied component version');versions[hash]=c;}
 const copy=structuredClone(document);delete copy.componentVersions;
 const existing=state.cases?.find(x=>x.id===copy.id),oldSteps=new Map((existing?.steps||[]).map(s=>[s.id,s]));
 for(const [id,node]of [...Object.entries(copy.nodes||{}),...Object.entries(copy.cleanup||{})]){
  const keys=Object.entries(node.args||{}).filter(([key,v])=>(v===null||typeof v==='number'||typeof v==='object')&&!(oldSteps.has(id)&&JSON.stringify(oldSteps.get(id).inputs?.[key])===JSON.stringify(v)&&oldSteps.get(id).argumentEncoding?.protocol!=='solopi.args.v1')).map(([k])=>k);
  if(keys.length)node.typedArgs=[...new Set([...(node.typedArgs||[]),...keys])];
 }
 const c=decodeCase(copy,versions,state.components||[]);
 if(copy.localComponents===undefined&&existing?.components){const local=new Map(existing.components.map(c=>[c.id,c]));for(const component of c.components||[])local.set(component.id,component);c.components=[...local.values()];}
 return c;
}
function encodeState(state){
 if(!state||!Array.isArray(state.cases)||state.caseStorage?.format===STORE)return state;
 const {caseEdges={},nodePositions,...rest}=state,catalog={},locations=Object.create(null),hashes=new WeakMap(),versionsById=new Map();
 const cases=state.cases.map(c=>{
  const inCase=own(c,'edges'),inState=own(caseEdges,c.id);
  if(inCase&&inState&&JSON.stringify(c.edges)!==JSON.stringify(caseEdges[c.id]))fail('Conflicting case and state edges: '+c.id);
  locations[c.id]=[inCase,inState];
  return encodeCase(c,inState?caseEdges[c.id]:c.edges,state.components||[],catalog,hashes,versionsById);
 });
 const orphanEdges=Object.fromEntries(Object.entries(caseEdges).filter(([id])=>!state.cases.some(c=>c.id===id)));
 return {...rest,cases,caseStorage:{format:STORE,components:catalog,edgeLocations:locations,
  ...(own(state,'caseEdges')?{hadCaseEdges:true}:{}),...(Object.keys(orphanEdges).length?{orphanEdges}:{}),
  ...(nodePositions!==undefined?{editor:{nodePositions}}:{})}};
}
function decodeState(state){
 if(!state?.caseStorage)return state;
 if(state.caseStorage.format!==STORE)fail('Unsupported case store format');
 const {caseStorage,...rest}=state,{components={},edgeLocations={},orphanEdges={},editor={}}=caseStorage;
 const caseEdges={...orphanEdges},verified=new Set(),hashes=new WeakMap();
 const cases=state.cases.map(document=>{
  const c=decodeCase(document,components,state.components||[],verified,hashes),where=edgeLocations[c.id];
  if(!where||where.length!==2)fail('Missing edge ownership');
  if(where[1])Object.defineProperty(caseEdges,c.id,{value:c.edges,enumerable:true,writable:true,configurable:true});
  if(!where[0]){const {edges,...without}=c;return without;}
  return c;
 });
 return {...rest,cases,...(caseStorage.hadCaseEdges?{caseEdges}:{}),...(own(editor,'nodePositions')?{nodePositions:editor.nodePositions}:{})};
}
module.exports={FORMAT,STORE,encodeCase,decodeCase,compileDocument,encodeState,decodeState,revision};
