// Offline authoring assessment. The oracle is never given to the drafting model.
// Business scenarios and grading criteria are supplied by a private suite.
import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const conditionPath=value=>String(value).trim().replace(/^\$\.?/,'').replace(/\[(\d+)\]/g,'.$1').replace(/\[['"]([^'"]+)['"]\]/g,'.$1').split('.').filter(Boolean).join('.');
export function gradeDrafts(submission,oracle,catalog){
 const failures=[],checks=[],proofs=[];const check=(name,ok,detail)=>{checks.push({name,passed:!!ok,...ok?{}:{detail}});if(!ok)failures.push(name);};
 const cases=Array.isArray(submission?.cases)?submission.cases:[];
 check('scenario set',cases.length===oracle.scenarios.length&&new Set(cases.map(c=>c.scenarioId)).size===cases.length&&oracle.scenarios.every(s=>cases.some(c=>c.scenarioId===s.id)),'Missing, duplicate or unexpected scenario');
 for(const expected of oracle.scenarios){
  const candidate=cases.find(c=>c.scenarioId===expected.id);if(!candidate)continue;const d=candidate.document||{},steps=d.steps||[],edges=d.edges||[],byId=new Map(steps.map(s=>[s.id,s])),components=new Map(catalog.map(c=>[c.id,c]));
  for(const c of d.components||[]){const source=components.get(c.id);check(expected.id+': component contract '+c.id,source&&hash(source)===hash(c),'Unknown or altered component');components.set(c.id,c);}
  const adjacency=new Map();for(const e of edges){check(expected.id+': edge '+e.source+'->'+e.target,byId.has(e.source)&&byId.has(e.target),'Dangling edge');if(!adjacency.has(e.source))adjacency.set(e.source,[]);adjacency.get(e.source).push(e.target);}
  const reachable=(a,b)=>{if(!byId.has(a)||!byId.has(b))return false;const seen=new Set(),queue=[a];while(queue.length){const id=queue.shift();if(id===b)return true;if(seen.has(id))continue;seen.add(id);queue.push(...adjacency.get(id)||[]);}return false;};
  const start=steps.filter(s=>s.type==='start'),end=steps.filter(s=>s.type==='end');check(expected.id+': graph',new Set(steps.map(s=>s.id)).size===steps.length&&start.length===1&&end.length===1&&steps.every(s=>reachable(start[0]?.id,s.id)&&reachable(s.id,end[0]?.id)),'Unreachable node, duplicate ID or missing boundary');
  check(expected.id+': workflow',d.schemaVersion==='glassbox.workflow.v1'&&d.reviewStatus==='draft','Draft workflow required');
  for(const s of steps)if(s.type==='component')check(expected.id+': resolve '+s.id,components.has(s.componentId),'Unknown component');
  const values=s=>s?.type==='component'?({...Object.fromEntries((components.get(s?.componentId)?.params||[]).map(p=>[p.key,p.defaultValue])),...s?.inputs,...s?.config,postDelayMs:s?.postDelayMs}):({...s?.config,postDelayMs:s?.postDelayMs});
  const resolve=v=>typeof v==='string'?v.replace(/\$\{variables\.([^}]+)\}|\{\{variables\.([^}]+)\}\}/g,(all,a,b)=>d.variables?.[a||b]??all):v;
  const comparable=v=>v&&typeof v==='object'?JSON.stringify(v):String(v??'');
  // Bindings are locator hints, not evidence. Find actual proofs, allowing
  // renamed nodes and separate assertions for independent outcome fields.
  const groups=new Map(),expanded=new Map();
  for(const c of expected.criteria){const roles=c.conditions?.length?c.conditions.map((_,i)=>c.role+'#'+i):[c.role];expanded.set(c.role,[...new Set([...(expanded.get(c.role)||[]),...roles])]);for(let i=0;i<roles.length;i++){const role=roles[i];if(!groups.has(role))groups.set(role,[]);groups.get(role).push({...c,...c.conditions?{conditions:[c.conditions[i]]}:{}});}}
  for(const c of expected.criteria)if(c.audioFrom&&!groups.has(c.audioFrom))groups.set(c.audioFrom,[]);
  const order=(expected.before||[]).flatMap(([a,b])=>(expanded.get(a)||[a]).flatMap(x=>(expanded.get(b)||[b]).map(y=>[x,y])));
  const matches=(step,criteria,assignment={},includeAudio=false)=>criteria.every(c=>{
   const component=components.get(step?.componentId);if(!step)return false;
   if(c.kind&&component?.kind!==c.kind&&step.type!==c.kind)return false;
   if(c.field&&(!Object.hasOwn(values(step),c.field)||resolve(values(step)[c.field])!==c.equals))return false;
   if(c.blocking&&(step.config?.assertBlocking===false||step.config?.assertBlocking==='false'))return false;
   if(c.conditions){let conditions;try{const raw=values(step).conditions;conditions=typeof raw==='string'?JSON.parse(raw):raw;}catch{}if(!Array.isArray(conditions)||!c.conditions.every(required=>conditions.some(x=>conditionPath(x.path)===conditionPath(required.path)&&x.operator===required.operator&&comparable(x.value)===comparable(required.value))))return false;}
   if(includeAudio&&c.audioFrom){const producer=assignment[c.audioFrom],key=producer?.config?.nodeKey;if(producer?.type!=='tts_synthesize'||!key||values(step).localPath!=='${variables.'+key+'.audioPath}')return false;}
   return true;
  });
  const candidates=new Map([...groups].map(([name,criteria])=>{const found=steps.filter(s=>matches(s,criteria));const hint=candidate.bindings?.[name.split('#')[0]];found.sort((a,b)=>(b.id===hint?1:0)-(a.id===hint?1:0));check(expected.id+': evidence '+name,found.length>0,'No actual node proves the required action or assertion');return[name,found];}));
  const names=[...groups.keys()];let visited=0,proof;
  function solve(i,assignment){if(++visited>10000)return false;if(i===names.length){if(!names.every(name=>matches(assignment[name],groups.get(name),assignment,true)))return false;proof={...assignment};return true;}const name=names[i];for(const step of candidates.get(name)){const next={...assignment,[name]:step};if(order.some(([a,b])=>next[a]&&next[b]&&(next[a].id===next[b].id||!reachable(next[a].id,next[b].id))))continue;if(solve(i+1,next))return true;}return false;}
  check(expected.id+': action/evidence order and output links',solve(0,{}),'Required action/evidence sequence or generated material reference is invalid');
  if(proof)proofs.push({scenarioId:expected.id,steps:Object.fromEntries(Object.entries(proof).map(([role,s])=>[role,s.id]))});
  for(const forbidden of expected.forbiddenComponents||[])check(expected.id+': exclude '+forbidden,!steps.some(s=>s.componentId===forbidden),'Unexpected user action');
  for(const prep of steps.filter(s=>['tts_synthesize','http_request','llm_text_generate'].includes(s.type)))for(const action of steps.filter(s=>(expected.businessKinds||[]).includes(components.get(s.componentId)?.kind)))check(expected.id+': prepare '+prep.id+' before '+action.id,reachable(prep.id,action.id),'Material preparation occurs during business interaction');
 }
 return{passed:failures.length===0,passedChecks:checks.filter(c=>c.passed).length,totalChecks:checks.length,failures,checks,proofs,meaning:'Offline structural/contract assessment; not device execution or business acceptance'};
}
