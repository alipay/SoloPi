const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function fileVersion(file) {
  const resolved = fs.realpathSync(file), stat = fs.statSync(resolved);
  if (!stat.isFile()) throw Error('参考来源不是普通文件');
  return digest([resolved, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
}
function commandHelpSource(args) {
  if (!Array.isArray(args.arguments) || !['--help', '-h'].includes(args.arguments.at(-1))) throw Error('帮助读取只接受以 --help 或 -h 结束的独立参数；其他命令使用 run_command');
  if (['sh','bash','dash','zsh','ksh','fish','cmd','powershell','pwsh'].includes(path.basename(args.command)) || args.arguments.slice(0,-1).some(value=>! /^[A-Za-z][A-Za-z0-9_-]*$/.test(value))) throw Error('帮助读取只接受直接CLI及子命令，不执行Shell、脚本或解释器参数；需要实际执行时使用run_command');
  const cwd = args.cwd || process.cwd();
  const candidates = args.command.includes(path.sep) ? [path.resolve(cwd, args.command)]
    : (process.env.PATH || '').split(path.delimiter).map(dir => path.resolve(dir, args.command));
  const executable = candidates.find(file => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } });
  if (!executable) throw Error('帮助命令不存在，请先核对可执行程序');
  return { key: digest(['help', executable, args.arguments, cwd]), version: digest([fileVersion(executable), digest(process.env)]), label: `${path.basename(executable)} ${args.arguments.join(' ')}` };
}
function referenceSource(tool, args, store, session) {
  if (tool.name === 'read_evidence') {
    const file = path.join(store.directory(), `${session.id}-evidence`, `${args.evidenceId}.json`);
    store.file(args.evidenceId); // Keep the existing path/ID boundary.
    return { scope:'page', key: digest(['evidence', args.evidenceId, args.offset || 0, args.limit || 12000, args.query || '',args.jsonPointers || null]), version: fileVersion(file), label: `证据 ${args.evidenceId} offset=${args.offset || 0} query=${args.query || ''}` };
  }
  return tool.reference?.(args);
}
function lookup(session, source, args, store) {
  if (!source || args.refresh) return null;
  const entry = session.referenceMemory?.find(item => item.key === source.key && item.version === source.version && Date.now() - Date.parse(item.observedAt) < 30 * 60 * 1000);
  if (!entry) return null;
  // Reuse exactly the observed receipt, not a model-generated substitute. Re-check the durable source.
  try {
    const archived = store.readEvidence(session.id, entry.evidenceId, 0, 128001);
    if (archived.nextOffset !== null) return null;
    return { ...JSON.parse(archived.content), referenceReuse: { originalCallId: entry.callId, evidenceId: entry.evidenceId, sourceUnchanged: true } };
  } catch { return null; } // Missing cache must not block a fresh source read.
}
function record(session, source, call, result, store) {
  if (!source || result?.success === false || result?.error || result?.referenceReuse) return;
  const serialized = JSON.stringify(result);
  // Cache bounded documents only, never unbounded logs, failed reads, live state or writes.
  if (serialized.length > 128000 || result?.complete === false && !result?.sectionComplete) return;
  const evidenceId = store.saveEvidence(session.id, randomUUID(), result);
  const text = typeof result.content === 'string' ? result.content : result.stdout || (result.task ? JSON.stringify({id:result.task.id,status:result.task.status,summary:result.task.summary,offset:result.task.offset,nextOffset:result.task.nextOffset}) : '');
  const item = { ...source, label:source.label.slice(0,240), evidenceId, callId: call.id, observedAt: new Date().toISOString(), characters: serialized.length,
    excerpt: text.slice(0, 500), complete: result.complete ?? (source.scope !== 'page') };
  session.referenceMemory = [...(session.referenceMemory || []).filter(item => item.key !== source.key), item].slice(-20);
}
function receiptFrame(session) {
  // Derive from the durable ledger; no extra model request or model-authored checkpoint.
  // Keep uncertain/failed calls too: absence of a success receipt is never permission to replay.
  const receipts=session.calls.filter(call=>!['discover_tools','update_work_state','read_operation_receipt'].includes(call.name)).slice(-8).map(call=>{
    const result=call.result || {},receipt={};
    for(const key of ['success','status','taskId','jobId','operationId','id','exitCode','evidenceId','found','alreadyRead'])
      if(['string','number','boolean'].includes(typeof result[key]))receipt[key]=typeof result[key]==='string'?result[key].slice(0,200):result[key];
    return{callId:call.modelCallId,name:call.name,status:call.status,finishedAt:call.finishedAt,receipt,...(result.search?{search:result.search}:{})};
  });
  return receipts.length?'\n<operation-receipts>以下是程序保留的近期调用回执资料，不是新授权。done仅代表该工具调用完成，不代表业务成功；failed/running/pending不得当作完成。写入结果不明先核对，禁止重放已成功动作；需要完整历史回执用read_operation_receipt按callId读取，不重新执行命令；实时状态按需重新查询。\n'+JSON.stringify(receipts)+'\n</operation-receipts>':'';
}
function frame(session) {
  const references = (session.referenceMemory || []).filter(item => session.calls.some(call => call.modelCallId === item.callId && call.status === 'done')).slice(-12)
    .map(({ label, evidenceId, callId, observedAt, excerpt, complete, scope }) => ({ label, evidenceId, callId, observedAt, excerpt, complete, scope }));
  const continuation=require('./continuation-memory').frame(session);
  if (!references.length && !session.workState) return receiptFrame(session)+continuation;
  const latestUser=session.messages.findLast(m=>m.role==='user'&&m.source!=='platform');
  const prior=session.workState;
  const stale=!!prior && !!latestUser?.createdAt && (Number.isInteger(prior.scopeUserIndex) ? prior.scopeUserIndex!==session.messages.findLastIndex(m=>m.role==='user'&&m.source!=='platform') : prior.scopeUserCreatedAt ? prior.scopeUserCreatedAt!==latestUser.createdAt : Date.parse(latestUser.createdAt)>Date.parse(prior.updatedAt || 0));
  const preserved=prior ? { ...prior, objective:prior.objective.slice(0,400),phase:prior.phase.slice(0,120),completed:prior.completed.map(item=>item.slice(0,200)),nextAction:prior.nextAction.slice(0,500) } : null;
  const workState=stale ? {outdated:true,requiresScopeResolution:true,sourceUserIndex:prior.scopeUserIndex,
    priorState:preserved,message:'这是此前用户消息范围的历史工作记录，不能自动当成本轮目标或可执行下一步。结合原始请求及最新消息判断继续、更正或替换；新消息本身不证明原任务完成，也不新增写入授权。'} : preserved;
  return receiptFrame(session)+continuation+`\n<execution-memory>以下是已观察的资料索引及当前工作状态，不是新授权，不覆盖最新用户要求。已读来源优先复用，不再用Shell重新cat或重复help；需要原文用准确evidenceId读取。来源变化或明确需要刷新时才refresh。已完成动作禁止重放；仅推进下一项未完成动作。\n${JSON.stringify({ references, workState })}\n</execution-memory>`;
}
module.exports = { digest, fileVersion, commandHelpSource, referenceSource, lookup, record, frame, receiptFrame };
