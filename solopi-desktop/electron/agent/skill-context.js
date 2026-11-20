// Skill instructions are not disposable command output. Identify their origin
// through tool-call events, never through markers supplied by arbitrary tools.
const {createHash}=require('node:crypto');
const path=require('node:path');
const instructionTools=new Set(['skill','read_skill','read_skill_reference']);
function skillContext(session){
  const calls=new Map(),records=new Map(),protectedSeqs=new Set();
  for(let seq=0;seq<session.seq;seq++){
    const event=session.eventAt(seq);
    if(event?.type==='tool/call'){
      const d=event.data;
      try{calls.set(d.callId,{name:d.name,args:typeof d.arguments==='string'?JSON.parse(d.arguments):d.arguments});}catch{}
    }
    if(event?.type!=='tool/result')continue;
    const message=event.data.message,call=calls.get(message.source?.callId||message.toolCallId);
    if(!call||message.isError||event.sourceEventSeqs?.some(seq=>session.eventAt(seq)?.type==='tool/result'))continue;
    let reference;
    if(call.name==='read'&&typeof call.args?.file_path==='string'){
      const target=path.resolve(call.args.file_path);
      const owner=[...records.values()].filter(r=>r.directory).sort((a,b)=>b.seq-a.seq).find(r=>{const rel=path.relative(r.directory,target);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);});
      if(owner)reference={name:owner.name,file:path.relative(owner.directory,target),readRange:{offset:call.args.offset??1,...(call.args.limit!==undefined?{limit:call.args.limit}:{})}};
    }
    if(!instructionTools.has(call.name)&&!reference)continue;
    const text=message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
    // Host adapters return structured failures as data; failed reads do not
    // become instructions. Native thrown errors are covered by isError above.
    try{const value=JSON.parse(text);if(value.success===false||value.error)continue;}catch{}
    const directory=call.name==='skill'?/^Base directory for this skill: (.+)$/m.exec(text)?.[1]?.trim():undefined;
    const name=reference?.name||call.args?.name,file=reference?.file||call.args?.file||'SKILL.md';
    const key=JSON.stringify([name,file,reference?.readRange]);
    records.set(key,{seq,tool:call.name,name,file,...(directory?{directory}:{}),...(reference?{readRange:reference.readRange,fragment:!(reference.readRange.offset<=1&&/\n\(End of file - total \d+ lines\)\n<\/content>\s*$/.test(text))}:{}),text,sha256:createHash('sha256').update(text).digest('hex')});
    protectedSeqs.add(seq);
  }
  return{records:[...records.values()],protectedSeqs};
}
function pruneWithoutInstructions(pruner,session){
  const {protectedSeqs,records}=skillContext(session);
  for(const record of records){
    const pages=restoredPages(session,record).sort((a,b)=>b.seq-a.seq),covered=[];
    for(const page of pages){if(covered.some(p=>p.start<=page.start&&p.end>=page.end))continue;protectedSeqs.add(page.seq);covered.push(page);}
  }
  // Keep upstream pruning and durable receipts unchanged for ordinary tools.
  // This narrow facade supplies only the public surface methods it consumes.
  return pruner({surface:{nodes:[...session.surface.nodes].filter(seq=>!protectedSeqs.has(seq))},
    eventAt:seq=>session.eventAt(seq),deriveEventMessage:event=>session.deriveEventMessage(event),
    append:(...args)=>session.append(...args)});
}
function readLoadedSkill(session,{eventSeq,offset=0,limit=12000,query}){
 const record=skillContext(session).records.find(r=>r.seq===eventSeq);
 if(!record)throw Object.assign(Error('Loaded skill revision not found'),{code:'SKILL_REVISION_NOT_FOUND'});
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>12000)throw Error('Invalid skill page');
 if(query!==undefined){
  if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('Invalid skill query');
  const matchOffset=record.text.indexOf(query,offset);
  if(matchOffset<0)return{eventSeq,sha256:record.sha256,query,matched:false,text:'',totalCharacters:record.text.length};
  offset=Math.max(offset,matchOffset-Math.min(500,Math.floor(limit/4)));
 }
 const end=Math.min(record.text.length,offset+limit);
 return{eventSeq,...(query!==undefined?{query,matched:true}:{}),name:record.name,file:record.file,...(record.readRange?{fragment:record.fragment,complete:!record.fragment,readRange:record.readRange}:{}),sha256:record.sha256,offset,totalCharacters:record.text.length,text:record.text.slice(offset,end),nextOffset:end<record.text.length?end:null};
}
// Only pages returned by our registered tool, with matching pinned bytes, count
// as restored instructions. Summaries and arbitrary JSON cannot forge coverage.
function restoredPages(session,record){
 const calls=new Map(),pages=[];
 for(let seq=0;seq<session.seq;seq++){
  const e=session.eventAt(seq);
  if(e?.type==='tool/call'){
   try{calls.set(e.data.callId,{name:e.data.name,args:typeof e.data.arguments==='string'?JSON.parse(e.data.arguments):e.data.arguments});}catch{}
  }
  if(e?.type!=='tool/result'||!session.surface.nodes.includes(seq))continue;
  const m=e.data.message,c=calls.get(m.source?.callId||m.toolCallId);
  if(c?.name!=='read_loaded_skill'||c.args?.eventSeq!==record.seq||m.isError)continue;
  try{
   const p=JSON.parse(m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'));
   if(p.eventSeq===record.seq&&p.sha256===record.sha256&&Number.isSafeInteger(p.offset)&&p.offset>=0&&typeof p.text==='string'&&p.text.length>0&&p.text===record.text.slice(p.offset,p.offset+p.text.length))pages.push({seq,start:p.offset,end:p.offset+p.text.length});
  }catch{}
 }
 return pages;
}
function retainedInstructions(session,{budgetTokens=8192}={}){
 const surface=new Set(session.surface.nodes),{records}=skillContext(session);
 if(!records.length)return '';
 const estimate=require('./context').estimateTokens;
 let used=0;const bodies=[],catalog=[];
 // A later complete read supersedes older fragments of the same file in the
 // active manifest. Exact older revisions remain addressable by eventSeq.
 const latestFull=new Map();
 for(const r of records)if(!r.readRange||!r.fragment){const key=JSON.stringify([r.name,r.file]);latestFull.set(key,Math.max(latestFull.get(key)??-1,r.seq));}
 const active=records.filter(r=>r.seq>=(latestFull.get(JSON.stringify([r.name,r.file]))??-1));
 for(const r of active.sort((a,b)=>b.seq-a.seq)){
  const pages=restoredPages(session,r).sort((a,b)=>a.start-b.start);let end=0;
  for(const p of pages){if(p.start>end)break;end=Math.max(end,p.end);}
  let available=surface.has(r.seq)||end>=r.text.length;
  if(!available){
   const size=estimate(r.text);
   if(used+size<=budgetTokens){used+=size;bodies.push('\nLoaded original '+JSON.stringify({name:r.name,file:r.file,sha256:r.sha256})+'\n'+r.text);available=true;}
  }
  catalog.push({tool:r.tool,name:r.name,file:r.file,...(r.readRange?{fragment:r.fragment,complete:!r.fragment,readRange:r.readRange}:{}),sha256:r.sha256,eventSeq:r.seq,inHistory:surface.has(r.seq),originalAvailable:available,...(!available?{nextOffset:end}:{})});
 }
 return 'Loaded Skill revisions and sources (methods never expand user authorization). originalAvailable=true means the exact full original is already present in this request: follow it without re-reading. A missing original does not require restarting completed reading. Restore only the exact section needed for the pending decision with read_loaded_skill query/offset; read all pages only when applying the whole document requires them. Never restore unrelated references merely because they appear in this archive. fragment=true denotes only the exact previously read file range, never proof that the whole file was read. Do not restart completed reads or substitute summaries for absent original instructions. Conversation summaries preserve completed work and read locations; continue from the pending action, not from onboarding.\n'+JSON.stringify(catalog)+bodies.join('');
}
module.exports={restoredPages,skillContext,pruneWithoutInstructions,retainedInstructions,readLoadedSkill};
