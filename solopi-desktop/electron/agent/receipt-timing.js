// Deterministic receipt arithmetic, with no effect on execution control.
function timestamp(value){
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const n=Date.parse(value);return Number.isFinite(n)?n:null;
}
function interval(startedAt,finishedAt){
 const start=timestamp(startedAt),end=timestamp(finishedAt),complete=start!==null&&end!==null&&end>=start;
 return{startedAt:startedAt??null,finishedAt:finishedAt??null,durationMs:complete?end-start:null,complete};
}
function summarize(input){
 const phases=(input.phases||[]).map(p=>({name:p.name,source:p.source||null,...interval(p.startedAt,p.finishedAt)}));
 const total=interval(input.startedAt,input.finishedAt),device=interval(input.executionStartedAt,input.executionFinishedAt);
 const contained=total.complete&&device.complete&&timestamp(input.executionStartedAt)>=timestamp(input.startedAt)&&timestamp(input.executionFinishedAt)<=timestamp(input.finishedAt);
 return{total,device,nonExecutionMs:contained?total.durationMs-device.durationMs:null,phases};
}
module.exports={timestamp,interval,summarize};
if(require.main===module){const fs=require('node:fs');console.log(JSON.stringify(summarize(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}
