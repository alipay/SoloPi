const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
let directory;
function configure(root) {directory=path.join(root,'diagnostics');}
// Explicit metadata allowlist. Never log messages, tool arguments, headers or raw response bodies.
const strings=new Set(['basePromptRevision','connectionErrorCode','transportPhase','connectionId','connectionUse','clientRequestId','upstreamTraceId','upstreamCode','upstreamType','source','timeoutKind','processType','validationReason','thinking','reasoningEffort','event','sessionId','status','toolName','contextPhase','upstreamRequestId','contentType','requestId','purpose','stage','category','code','finishReason','model','version','platform','arch']);
const numbers=new Set(['retryAfterMs','systemCharacters','basePromptCharacters','toolSchemaCharacters','historyCharacters','skillCharacters','workStateCharacters','recoveryBudgetMs','semanticIdleMs','streamIdleMs','sseDataEventCount','sseCommentCount','semanticDeltaCount','connectionAttemptMs','transportRequestCount','connectionRetryCount','automaticRetryCount','firstOutputMs','connectionEstablishMs','requestSendStartMs','requestBodySentMs','requestUploadMs','responseWaitMs','beforeTokensEstimate','afterTokensEstimate','requestBytes','serializeMs','socketBytesWritten','socketBytesRead','contextWindowTokens','timeoutMs','idleMs','cpuPercent','workingSetKb','eventLoopMaxMs','eventLoopP99Ms','sessionBytes','toolIndex','argumentCharacters','decodedFrames','deliveredFrames','acknowledgedFrames','headersMs','streamBytes','streamElapsedMs','setupMs','decodeWaitMs','maxTokens','durationMs','httpStatus','messageCount','toolCount','outputCharacters','reasoningCharacters','promptTokens','completionTokens','totalTokens','choiceCount','attempt']);
strings.add('taskId');strings.add('caseId');strings.add('libraryId');numbers.add('protectedCaseCount');numbers.add('conflictCount');
for(const key of ['pid','heapUsedBytes','rssBytes','externalBytes','arrayBuffersBytes','uptimeSeconds','manifestBytes','blobBytesWritten','blobsWritten','blobCacheHits','blobReferences','historyMessageCount','historyToolCount','rendererHeapUsedBytes','rendererHeapLimitBytes','diskFreeBytes'])numbers.add(key);
for(const key of ['writeMs','diskWriteMs','indexReadMs','indexMergeMs','indexWriteMs','indexCommitMs','queueMs','uiSyncMs','bytes','coalescedCount','stateUpdateMs','payloadBytes','ipcToFrameMs','renderMs','maxRenderMs','commitCount'])numbers.add(key);
strings.add('runtimeRevision');strings.add('toolChoice');strings.add('modelAdapterRevision');strings.add('wireFinishReason');
for(const key of ['executionContractRevision','approvalMode','taskOpsReadState','cliReadState'])strings.add(key);
for(const key of ['wireToolCallFragments','parsedToolCalls','unexpectedToolCallFrames'])numbers.add(key);
for(const key of ['creationId','sourceTaskId','folderId','node','field','errorName'])strings.add(key);
for(const key of ['caseCount','errorCount','warningCount'])numbers.add(key);
function sanitize(data) {
 const taskFlags=['phonePerformance','glassesPerformance','threadStacks','recordPhoneScreen','recordGlassesScreen','phoneSelected','glassesSelected'];
 const out={};
 for(const key of taskFlags)if(typeof data?.[key]==='boolean')out[key]=data[key];
 if(typeof data?.wireDone==='boolean')out.wireDone=data.wireDone;
 for(const key of ['wireBeforeTokens','wireAfterTokens','newestBatchTokens','meterAfterPruningTokens','inputBudgetTokens'])
  if(typeof data?.[key]==='number' && Number.isFinite(data[key])) out[key]=data[key];
 if(typeof data?.applicationPressure==='boolean') out.applicationPressure=data.applicationPressure;
 if(typeof data?.protectNewestBatch==='boolean') out.protectNewestBatch=data.protectNewestBatch;
 if(['pressure','context-overflow'].includes(data?.trigger)) out.trigger=data.trigger;
 if (typeof data?.upstreamMessage === 'string') out.upstreamMessage=require('./agent/upstream-diagnostics').redactUpstreamMessage(data.upstreamMessage);
 for(const key of ['connectionFailureObserved','requestHeadersSent','requestBodySent'])if(typeof data?.[key]==='boolean')out[key]=data[key];
 if (typeof data?.transportObserved === 'boolean') out.transportObserved=data.transportObserved;
 if (typeof data?.streamRequested === 'boolean') out.streamRequested = data.streamRequested;
 if (typeof data?.diagnosticText === 'string') out.diagnosticText = data.diagnosticText.replace(/(?:Bearer\s+|(?:token|password|secret|api[_-]?key)[=:]\s*)[^\s]+/gi, '[REDACTED]').replace(/\/Users\/[^\s]+/g, '[LOCAL_PATH]').slice(-2000);
 for(const [k,v] of Object.entries(data || {})) {
  if(strings.has(k) && typeof v==='string') out[k]=v.replace(/[^\w.:-]/g,'_').slice(0,160);
  if(numbers.has(k) && typeof v==='number' && Number.isFinite(v)) out[k]=v;
  if(['responseFields','messageFields'].includes(k) && Array.isArray(v)) out[k]=v.filter(x=>typeof x==='string').map(x=>x.replace(/[^\w]/g,'_').slice(0,60)).slice(0,40);
 }
 return out;
}
function record(data) {
 if(!directory)return;
 try {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'runtime.jsonl');
  if(fs.existsSync(file) && fs.statSync(file).size>2*1024*1024) {
   for(let i=3;i>=1;i--) {const src=i===1?file:`${file}.${i-1}`,dst=`${file}.${i}`;if(fs.existsSync(src)){fs.rmSync(dst,{force:true});fs.renameSync(src,dst);}}
  }
  fs.appendFileSync(file,JSON.stringify({time:new Date().toISOString(),...sanitize(data)})+'\n',{mode:0o600});
 } catch (_) { /* Diagnostic I/O must not break execution. */ }
}
function bundle(root, output) {
 const dir=path.join(root,'diagnostics'), records=[],issues=[];
 for(const name of ['runtime.jsonl.3','runtime.jsonl.2','runtime.jsonl.1','runtime.jsonl']) {
  const f=path.join(dir,name);if(!fs.existsSync(f))continue;
  const stat=fs.lstatSync(f);if(!stat.isFile() || stat.isSymbolicLink() || stat.size>3*1024*1024){issues.push(`Skipped ${name}: unsupported file or size`);continue;}
  for(const line of fs.readFileSync(f,'utf8').split('\n').filter(Boolean)) {try{const v=JSON.parse(line);records.push({...sanitize(v),time:/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v.time)?v.time:undefined});}catch{issues.push(`Partial or invalid line in ${name}`);}}
 }
 const payload={format:'solopi-desktop-diagnostics-v1',createdAt:new Date().toISOString(),platform:process.platform,arch:process.arch,node:process.versions.node,records,issues,exclusions:['API keys and configuration files','Chat text, reasoning text and attachments','Tool arguments/results and device business logs']};
 const target=path.resolve(output);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,zlib.gzipSync(JSON.stringify(payload,null,2)),{flag:'wx',mode:0o600});
 return {success:true,path:target,records:records.length,bytes:fs.statSync(target).size,issues,warning:records.length?undefined:'没有新诊断日志：请升级并重启应用，复现后重新导出。',format:payload.format};
}
module.exports={configure,record,bundle,sanitize};
