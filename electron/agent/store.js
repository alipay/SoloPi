const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
class AgentStore {
  constructor(directory) { this.directory = directory; this.index = new Map(); this.texts=new(require('./session-text-store').SessionTextStore)(()=>this.directory()); }
  file(id) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw Error('Invalid session id');
    return path.join(this.directory(), `${id}.json`);
  }
  sealHistory(s) {
    require('./usage-anchor').normalizeUsageAnchors(s);
    s.messages=s.messages.map(m=>this.texts.seal(m));
    for(const c of s.calls)if(['done','failed','cancelled'].includes(c.status)){
      c.args=this.texts.seal(c.args);c.result=this.texts.seal(c.result);
    }
  }
  save(session) {
    require('./usage-anchor').normalizeUsageAnchors(session);
    const started = performance.now();
    const file = this.file(session.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    const stats={blobBytesWritten:0,blobsWritten:0,blobCacheHits:0,blobReferences:0};
    const {messages,calls,...metadata}=session;
    const encoded={...this.texts.encode(session.id,{...metadata,streaming:undefined},stats),
      messages:messages.map(m=>this.texts.encodeMessage(session.id,m,stats)),
      calls:calls.map(c=>{const {args,result,...meta}=c;return {...this.texts.encode(session.id,meta,stats),args:this.texts.encodeRecord(session.id,args,stats),result:this.texts.encodeRecord(session.id,result,stats)};})};
    const serialized=JSON.stringify({...encoded,__solopiSessionStorage:2}), serializedAt=performance.now();
    try { fs.writeFileSync(temporary, serialized, { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
    this.indexSession(session, fs.statSync(file));
    require('../diagnostics').record({event:'agent.persist',durationMs:performance.now()-started,serializeMs:serializedAt-started,diskWriteMs:performance.now()-serializedAt,sessionBytes:fs.statSync(file).size,messageCount:session.messages.length,toolCount:session.calls.length,...stats,manifestBytes:Buffer.byteLength(serialized),heapUsedBytes:process.memoryUsage().heapUsed,rssBytes:process.memoryUsage().rss});
    return session;
  }
  saveEvidence(sessionId, id, value, source = {}) {
    const folder = path.join(this.directory(), `${sessionId}-evidence`);
    this.file(sessionId); this.file(id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${id}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
    if (Object.keys(source).length) fs.writeFileSync(path.join(folder, `${id}.meta.json`), JSON.stringify(source), { mode: 0o600 });
    return id;
  }
  projectEvidence(sessionId,id,pointers) {
    this.file(sessionId);this.file(id);
    const directory=path.join(this.directory(),`${sessionId}-evidence`);
    const value=JSON.parse(fs.readFileSync(path.join(directory,`${id}.json`),'utf8'));
    return require('./evidence-projection').project(value,pointers,{directory,evidenceId:id});
  }
  readEvidence(sessionId, id, offset = 0, limit = 12000, query = '') {
    this.file(sessionId); this.file(id);
    const text = fs.readFileSync(path.join(this.directory(), `${sessionId}-evidence`, `${id}.json`), 'utf8');
    let value; try { value = JSON.parse(text); } catch {}
    const root = value?.content && typeof value.content === 'object' ? value.content : value;
    let source = {}; try { source = JSON.parse(fs.readFileSync(path.join(this.directory(), `${sessionId}-evidence`, `${id}.meta.json`), 'utf8')); } catch {}
    source = { ...source, ...(typeof root?.taskId==='string'?{taskId:root.taskId}:{}), ...(typeof root?.caseId==='string'?{caseId:root.caseId}:{}) };
    source.scope = source.caseId ? 'case' : source.taskId ? 'task' : 'unknown';
    const search = { query, fromOffset: offset, mode: 'literal', source };
    const start = query ? text.indexOf(query, offset) : offset;
    if (start < 0) return { evidenceId: id, found: false, total: text.length, search, message: '当前证据范围内未找到该文本；不代表其他用例没有结果，也不证明并发冲突。核对source后读取对应任务/用例证据。' };
    const end = Math.min(text.length, start + limit);
    return { evidenceId: id, total: text.length, search, offset: start, content: text.slice(start, end), nextOffset: end < text.length ? end : null };
  }
  readStored(id) {return JSON.parse(fs.readFileSync(this.file(id),'utf8'));}
  hydrate(id,value,version) {return version===2?this.texts.decode(id,value):value;}
  get(id) {
    const started=performance.now(),raw=this.readStored(id),version=raw.__solopiSessionStorage;
    delete raw.__solopiSessionStorage;
    const s=require('./usage-anchor').normalizeUsageAnchors(this.hydrate(id,raw,version));
    require('../diagnostics').record({event:'agent.session-load',sessionId:id,durationMs:performance.now()-started,messageCount:s.messages?.length,toolCount:s.calls?.length,manifestBytes:fs.statSync(this.file(id)).size,heapUsedBytes:process.memoryUsage().heapUsed,rssBytes:process.memoryUsage().rss});
    return s;
  }
  callDetails(id,callId) {
    const raw=this.readStored(id),c=(raw.calls || []).find(c=>c.id===callId);
    if(!c)throw Error('调用记录不存在');return this.hydrate(id,c,raw.__solopiSessionStorage);
  }
  create() { return this.save({ id: randomUUID(), title: '新对话', status: 'idle', messages: [], calls: [], updatedAt: new Date().toISOString() }); }
  indexSession(s, stat) {
    this.index.set(s.id, {mtime:stat.mtimeMs, size:stat.size,
      summary:{id:s.id,title:s.title,status:s.status,updatedAt:s.updatedAt},
      watch:s.watch ? {...s.watch} : null, reviewCursors:{...s.reviewCursors},
      taskIds:[...new Set(s.calls.filter(c=>c.status==='done' && c.result?.success && c.result?.taskId).map(c=>c.result.taskId))]});
  }
  metadata(id) {
    const stat=fs.statSync(this.file(id)), cached=this.index.get(id);
    if (!cached || cached.mtime!==stat.mtimeMs || cached.size!==stat.size) this.indexSession(this.get(id), stat);
    return this.index.get(id);
  }
  taskIds(id) { return [...this.metadata(id).taskIds]; }
  list(recover = false) {
    if (!fs.existsSync(this.directory())) return [];
    return fs.readdirSync(this.directory()).filter(name => /^[a-zA-Z0-9-]+\.json$/.test(name)).map(name => {
      const id=name.slice(0,-5);
      if (recover && this.metadata(id).summary.status==='running') {
        const s=this.get(id); s.status='interrupted';s.error='上次执行已中断，请核对任务记录后继续。';this.save(s);
      }
      return {...this.metadata(id).summary};
    }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
}
module.exports = { AgentStore };
