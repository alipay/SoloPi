// Static graph checks shared by discovery, persistence and execution.
function isolatedCaseNodeErrors(testCase, edges = []) {
 if(!Array.isArray(edges)||!edges.length)return [];
 const incoming=new Set(edges.map(e=>String(e?.target||e?.to||'').trim()));
 return (testCase?.steps||[]).filter(s=>s.phase!=='cleanup'&&s.type!=='start'&&!incoming.has(String(s.id||''))).map(s=>({code:'CASE_EDGE_ISOLATED_NODE',field:`steps.${s.id}`,node:s.id,message:`步骤 ${s.id} 没有入边，无法从 start 到达。`}));
}
function caseGraphErrors(testCase,edges=[]){
 let steps;
 try{steps=require('../workflow-cleanup').partitionWorkflowSteps(testCase?.steps||[],Array.isArray(edges)?edges:[]).main;}
 catch(error){return[{code:error.code,field:'steps',node:'cleanup',message:error.message}];}
 const ids=new Set(steps.map(s=>s.id)),outgoing=new Map();
 for(const edge of edges||[]){const source=edge.source||edge.from,target=edge.target||edge.to;if(ids.has(source)&&ids.has(target))outgoing.set(source,[...(outgoing.get(source)||[]),target]);}
 const visiting=new Set(),visited=new Set(),stack=[];let cycle;
 const visit=id=>{if(visiting.has(id)){cycle=stack.slice(stack.indexOf(id)).concat(id);return true;}if(visited.has(id))return false;visiting.add(id);stack.push(id);if((outgoing.get(id)||[]).some(visit))return true;stack.pop();visiting.delete(id);visited.add(id);return false;};
 if([...ids].some(visit))return[{code:'CASE_EDGE_CYCLE',field:'edges',node:'edges',message:'执行图包含环：'+cycle.join(' → '),stepIds:cycle}];
 return isolatedCaseNodeErrors(testCase,edges);
}
module.exports={caseGraphErrors,isolatedCaseNodeErrors};
