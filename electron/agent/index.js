const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AgentStore } = require('./store');
const { AgentRuntime } = require('./runtime');
const { McpConnections } = require('./mcp');
const { extensionInventory, skillDetails } = require('./extensions');
const { createTools } = require('./tools');
function installAgent({ ipcMain, directory, invoke, readState, saveCase, provider, registerUpload, protect, reveal, getMirrorTargets, previewService, saveConfiguration, subscribeOperations, model, deviceOperation, getAgentModelOverride, getAgentModelProviderId }) {
  require('../diagnostics').configure(directory());
  require('../diagnostics').record({event:'agent.start',version:require('../../package.json').version,platform:process.platform,arch:process.arch});
  const store = new AgentStore(() => path.join(directory(), 'agent', 'sessions'));
  const mcp = new McpConnections(); let recovered = false;
  const owners = new Map();
  const comparisons=new Map(),comparisonRuns=new Map();
  const policyFile=()=>path.join(directory(),'agent','request-policy.json');
  const conversationFile=()=>path.join(directory(),'agent','conversation-overrides.json');
  const conversationOverrides=()=>fs.existsSync(conversationFile())?JSON.parse(fs.readFileSync(conversationFile(),'utf8')):{};
  const summaryFile=()=>path.join(directory(),'agent','summary-overrides.json');
  const selectedId=()=>getAgentModelProviderId?.() || readState().selectedLlmProviderId || readState().llmProviders?.[0]?.id;
  const summaryOverrides=()=>fs.existsSync(summaryFile())?JSON.parse(fs.readFileSync(summaryFile(),'utf8')):{};
  const readPolicy=()=>{const settings=fs.existsSync(policyFile())?JSON.parse(fs.readFileSync(policyFile(),'utf8')):{};return require('./request-policy').requestPolicy({...settings,conversationReasoning:conversationOverrides()[selectedId()] || 'inherit',summaryReasoning:summaryOverrides()[selectedId()] || settings.summaryReasoning || 'inherit'});};
  const {sessionView}=require('./session-view');
  const updates = require('./session-updates').createSessionUpdates();
  const configFile = () => path.join(directory(), 'agent', 'extensions.json');
  const config = () => fs.existsSync(configFile()) ? reveal(JSON.parse(fs.readFileSync(configFile(), 'utf8'))) : { mcpServers: [], skillRoots: [] };
  const skillsRoots = () => [...(process.resourcesPath ? [path.join(process.resourcesPath, 'skills')] : []), path.join(__dirname, '../../skills'), path.join(os.homedir(), '.agents/skills'), ...(config().skillRoots || [])];
  async function saveExtensions(next) {
    next = { ...next, disabledSkills: next?.disabledSkills ?? config().disabledSkills ?? [] };
    if (!Array.isArray(next.disabledSkills) || next.disabledSkills.some(n => typeof n !== 'string')) throw Error('Skills启用配置格式错误');
    if (!next || !Array.isArray(next.mcpServers) || !Array.isArray(next.skillRoots) || next.mcpServers.length > 20 || next.skillRoots.length > 20) throw Error('扩展配置格式错误');
    const ids = new Set();
    for (const s of next.mcpServers) {
      if (!s || typeof s !== 'object' || (s.enabled !== undefined && typeof s.enabled !== 'boolean')) throw Error('MCP enabled 必须为布尔值');
      if (!/^[a-zA-Z0-9_]{1,30}$/.test(s.id || '') || ids.has(s.id)) throw Error('MCP id 必须唯一，由字母数字下划线组成'); ids.add(s.id);
      if (Boolean(s.command) === Boolean(s.url)) throw Error('MCP 需要 command 或 url 二选一');
      if (s.command && (typeof s.command !== 'string' || !Array.isArray(s.args || []) || (s.args || []).some(a => typeof a !== 'string'))) throw Error('MCP command/args 格式错误');
      if (s.url && !['http:','https:'].includes(new URL(s.url).protocol)) throw Error('MCP URL 必须为 HTTP(S)');
      if ((s.envKeys !== undefined && (!Array.isArray(s.envKeys) || s.envKeys.some(k => typeof k !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(k)))) || (s.bearerTokenEnv !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(s.bearerTokenEnv))) throw Error('凭据环境变量名称不合法');
      // Credentials come from environment. Do not place secrets in chat or extension JSON.
      if (s.env || s.headers) throw Error('此版本请通过系统环境提供 MCP 凭据，配置文件不接受 env/headers');
    }
    if (next.skillRoots.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw Error('Skill 路径必须为绝对路径');
    const previous = config().mcpServers || [];
    for (const old of previous) if (JSON.stringify(old) !== JSON.stringify(next.mcpServers.find(s => s.id === old.id))) mcp.statuses.delete(old.id);
    const file = configFile(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(protect(next)), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
    return { success: true };
  }
  const runtime = new AgentRuntime({ store, refreshSkills: s => require('./skill-refresh').refreshLoadedSkills(s, skillsRoots(), config()), provider:async()=>require('./reasoning').conversationReasoning({...await provider(),requestPolicy:readPolicy()}), model, tools: createTools({ invoke, readState, saveCase, config, mcp, registerUpload, saveConfiguration, saveExtensions, deviceOperation,
    commandDirectory: directory,
    executeCommand: (args, signal) => require('./command').executeCommand(args, { signal, directory: directory() }),
    installSkill: (args, signal) => require('./skill-install').installSkill(args, { signal, roots: skillsRoots, config, saveExtensions, directory: directory() }),
    downloadFile: (args, signal) => require('./download').downloadFile(args, { directory: path.join(directory(), 'agent', 'downloads'), signal }),
    readAttachment: args => require('./attachments').readAttachment(path.join(directory(), 'agent', 'attachments'), args),
    skillsRoots,
  }), emit: s => {
    const sender = owners.get(s.id);
    if(sender && !sender.isDestroyed() && !sender.isCrashed?.()) {
      try{const started=performance.now();const patch=updates.next(sessionView(s));const prepared=performance.now();sender.send('agent:changed',patch);require('../diagnostics').record({event:'agent.ui-sync',sessionId:s.id,stateUpdateMs:prepared-started,uiSyncMs:performance.now()-prepared,messageCount:patch.messages.length,toolCount:patch.calls.length,payloadBytes:Buffer.byteLength(JSON.stringify(patch)),historyMessageCount:s.messages.length,historyToolCount:s.calls.length,heapUsedBytes:process.memoryUsage().heapUsed,rssBytes:process.memoryUsage().rss});}
      catch(error){require('../diagnostics').record({event:'agent.ui-unavailable',sessionId:s.id,diagnosticText:error.message});}
    }
  } });
  const unsubscribe = subscribeOperations?.((kind, id, detail) => { try { runtime.notify(kind, id, detail); } catch (error) { console.warn('[agent] task continuation failed:', error.message); } });
  async function recoverWaiting(event) {
    for (const summary of store.list().filter(s => s.status === 'waiting')) {
      const s = store.get(summary.id);
      owners.set(s.id, event.sender); runtime.contexts.set(s.id, event);
      if (!s.watch) continue;
      try {
        if (s.watch.kind === 'task') {
          const list = await invoke('workflow-task:list', event, {});
          if (list.success === false) continue;
          let task = list.tasks.find(t => t.id === s.watch.id);
          if (task && s.watch.reviewCases) {
            const loaded = await invoke('workflow-report:load-task', event, {taskId:s.watch.id});
            if (loaded.error || loaded.success === false) continue;
            task = loaded.reviewSnapshot || require('./review-events').reviewSnapshot(loaded.task || loaded);
          }
          runtime.notify('task', s.watch.id, task || { status: 'interrupted', error: '等待的任务已不存在，请核对历史报告' });
        } else {
          let job;
          try { job = await invoke('bugreport:status', event, { id: s.watch.id }); } catch (_) {}
          if (!job || job.error) {
            const history = await invoke('bugreport:history', event, {});
            const report = history.reports?.find(r => r.id === s.watch.id);
            job = report ? { status: 'completed', reportKey: report.key } : { status: 'interrupted', error: '重启前的导入未完成，未自动重跑' };
          }
          runtime.notify('battery', s.watch.id, job);
        }
      } catch (_) { /* Keep persisted wait; next entry retries reconciliation. */ }
    }
  }
  const bound = new WeakSet();
  const rendererMeasurements = new WeakMap();
  for (const action of ['performance','request-policy','save-request-policy','compare-model','comparison','stop-comparison','list','create','get','call-details','send','edit-queued','delete-queued','steer-queued','approve','approval-mode','stop','extensions','extension-inventory','skill-detail','test-mcp','save-extensions','models','select-model','mirror-targets','mirror-start','mirror-stop']) {
    ipcMain.handle(`agent:${action}`, async (event, args = {}) => {
      try {
        if (!recovered) { store.list(true); recovered = true; }
        if (!bound.has(event.sender)) {
          bound.add(event.sender);
          const release = () => { void Promise.resolve(previewService?.stop(event.sender.id)).catch(error=>console.warn('[agent] preview cleanup:',error.message)); for(const run of comparisonRuns.values())if(run.sender===event.sender)run.controller.abort();for (const [id, owner] of owners) if (owner === event.sender) { runtime.disconnect(id); owners.delete(id); } };
          event.sender.once('destroyed', release); event.sender.on('render-process-gone', release);
        }
        if (action === 'performance') {
          const previous=rendererMeasurements.get(event.sender) || 0, now=Date.now();
          if(now-previous<9000)return {success:true,throttled:true};
          rendererMeasurements.set(event.sender,now);
          const measurements={};
          for(const key of ['ipcToFrameMs','renderMs','maxRenderMs','commitCount'])if(Number.isFinite(args[key]) && args[key]>=0 && args[key]<=3600000)measurements[key]=args[key];
          for(const key of ['rendererHeapUsedBytes','rendererHeapLimitBytes'])if(Number.isFinite(args[key]) && args[key]>=0 && args[key]<=1024**4)measurements[key]=args[key];
          require('../diagnostics').record({event:'agent.renderer-performance',...measurements});
          return {success:true};
        }
        if (action === 'list') { await recoverWaiting(event); return { sessions: store.list() }; }
        if (action === 'create') { const s = store.create(); owners.set(s.id, event.sender); return { session: sessionView(s) }; }
        if(action==='request-policy')return {policy:readPolicy()};
        if(action==='save-request-policy'){
          if(runtime.active.size || comparisonRuns.size)throw Error('请等待请求结束或停止后再修改请求设置');
          const policy=require('./request-policy').requestPolicy(args.policy);
          const {summaryReasoning,conversationReasoning,...global}=policy;
          fs.mkdirSync(path.dirname(policyFile()),{recursive:true});fs.writeFileSync(policyFile()+'.tmp',JSON.stringify(global),{mode:0o600});fs.renameSync(policyFile()+'.tmp',policyFile());
          if(selectedId()){fs.writeFileSync(summaryFile()+'.tmp',JSON.stringify({...summaryOverrides(),[selectedId()]:summaryReasoning}),{mode:0o600});fs.renameSync(summaryFile()+'.tmp',summaryFile());}
          if(selectedId()){fs.writeFileSync(conversationFile()+'.tmp',JSON.stringify({...conversationOverrides(),[selectedId()]:conversationReasoning}),{mode:0o600});fs.renameSync(conversationFile()+'.tmp',conversationFile());}
          return {success:true,policy};
        }
        if(action==='comparison')return {report:comparisons.get(args.id) || null};
        if(action==='stop-comparison'){comparisonRuns.get(args.id)?.controller.abort();return {success:true};}
        if(action==='compare-model'){
          if(runtime.active.size || comparisonRuns.size)throw Error('请先等待当前请求结束或停止后再对照');
          const previous=runtime.lastRequest?.get(args.id);
          if(!previous)throw Error('请先在当前对话发送一条消息，再对照该次模型输入；重启后需重新生成输入快照');
          if(!Number.isSafeInteger(args.pairs)||args.pairs<1||args.pairs>5)throw Error('对照轮数必须为1–5');
          const controller=new AbortController();comparisonRuns.set(args.id,{controller,sender:event.sender});
          let snapshot,current;
          try{
            current=await provider();
            if(current.model!==previous.provider.model || current.baseUrl!==previous.provider.baseUrl)throw Error('模型已变化，请先用当前模型发送消息生成输入快照');
            snapshot={...previous,provider:{...current,requestPolicy:readPolicy()},messages:previous.messages.map(m=>require('./attachments').attachmentMessage(m))};
          }catch(error){comparisonRuns.delete(args.id);throw error;}
          const update=report=>{comparisons.set(args.id,report);if(!event.sender.isDestroyed())event.sender.send('agent:comparison',{id:args.id,report});};
          update({status:'running',rows:[],pairs:args.pairs,model:current.model});
          void require('./model-comparison').compareModels(snapshot,{pairs:args.pairs,signal:controller.signal,model:model || require('./model').requestModel,onUpdate:update})
            .catch(error=>update({status:'failed',rows:[],error:error.message})).finally(()=>{comparisonRuns.delete(args.id);if(comparisons.size>4)comparisons.delete(comparisons.keys().next().value);});
          return {success:true,report:comparisons.get(args.id)};
        }
        if (action === 'models') {
          const state = readState();
          const override=getAgentModelOverride?.();
          const models = (state.llmProviders || []).map(p => ({ id: p.id, name: override&&p.id===selectedId()?p.name+' / '+override:p.name, model: override&&p.id===selectedId()?override:p.model }));
          return { models, selectedModelId: models.some(p => p.id === selectedId()) ? selectedId() : models[0]?.id || '' };
        }
        if (action === 'select-model') {
          if(getAgentModelOverride?.())throw Error('本次开发入口固定了 Agent 诊断模型；工作流模型配置未改变。重启时不指定模型覆盖即可正常切换。');
          if (runtime.active.size || comparisonRuns.size) throw Error('请先停止正在执行的对话或对照再切换模型');
          if (typeof args.modelId !== 'string' || !readState().llmProviders?.some(p => p.id === args.modelId)) throw Error('模型配置不存在，请刷新模型列表');
          return await saveConfiguration({ selectedModelId: args.modelId });
        }
        if (action === 'extension-inventory') return extensionInventory(skillsRoots(), protect(config()), mcp.statuses);
        if (action === 'skill-detail') return skillDetails(skillsRoots(), config(), args.name);
        if (action === 'test-mcp') {
          const server = config().mcpServers.find(s => s.id === args.serverId);
          if (!server) throw Error('MCP服务不存在');
          const probe = new McpConnections(); const controller = new AbortController();
          const abort = () => controller.abort(); event.sender.once('destroyed', abort);
          try { const tools = await probe.connect(server, controller.signal); mcp.statuses.set(server.id, { status: 'tested', toolCount: tools.length }); return { tools: tools.map(t => ({ name: t.name, description: t.description })) }; }
          catch (error) { mcp.statuses.set(server.id, { status: 'error', error: error.message }); throw error; }
          finally { event.sender.removeListener('destroyed', abort); await probe.closeAll(); }
        }
        if (action === 'extensions') return { config: protect(config()) };
        if (action === 'save-extensions') {
          if ([...runtime.active.keys()].length) throw Error('请等待当前对话结束再修改扩展');
          const next = args.config;
          return await saveExtensions(next);
        }
        if (action.startsWith('mirror-')) {
          const taskIds = store.taskIds(args.id);
          const targets = taskIds.flatMap(id => getMirrorTargets(id));
          if (action === 'mirror-targets') return { targets };
          if (action === 'mirror-stop') { await previewService.stop(event.sender.id, args.taskId && args.role ? args : undefined, args.force === true); return { success: true }; }
          const target = targets.find(t => t.role === args.role && t.taskId === args.taskId);
          if (!target) throw Error('当前用例未开启此设备投屏或任务已结束');
          return await previewService.start(event.sender, target, args.id);
        }
        owners.set(args.id, event.sender);
        if (action === 'call-details') {
          const started=performance.now();
          const call=runtime.liveSessions.get(args.id)?.calls.find(c=>c.id===args.callId) || store.callDetails(args.id,args.callId);
          require('../diagnostics').record({event:'agent.call-details',sessionId:args.id,durationMs:performance.now()-started,heapUsedBytes:process.memoryUsage().heapUsed});
          return {call};
        }
        if (action === 'get') {
          const s = runtime.liveSessions.get(args.id) || store.get(args.id);
          runtime.refreshSkillSources(s);
          return { session: sessionView(s) };
        }
        if (action === 'send') {
          if(comparisonRuns.size)throw Error('模型对照进行中，请等待或停止对照后发送');
          store.get(args.id);
          const attachments = require('./attachments').importAttachments(path.join(directory(), 'agent', 'attachments'), args.attachments || []);
          if (args.enqueue === true || runtime.active.has(args.id)) return { session: sessionView(runtime.enqueue(args.id, args.text || (attachments.length ? '请查看附件' : ''), attachments)) };
          return { session: sessionView(await runtime.start(args.id, args.text || (attachments.length ? '请查看附件' : ''), event, attachments)) };
        }
        if (action === 'edit-queued') return {session:sessionView(runtime.editQueued(args.id,args.messageId,{text:args.text,editing:args.editing}))};
        if (action === 'delete-queued') return {session:sessionView(runtime.deleteQueued(args.id,args.messageId))};
        if (action === 'steer-queued') return { session: sessionView(await runtime.steerQueued(args.id, args.messageId, event)) };
        if (action === 'approval-mode') return { session: sessionView(await runtime.setApprovalMode(args.id, args.mode, event)) };
        if (action === 'approve') return { session: sessionView(await runtime.approve(args.id, args.callId, args.allow === true, event)) };
        if (action === 'stop') { runtime.stop(args.id); return { success: true }; }
      } catch (error) { return { success: false, error: error.message }; }
    });
  }
  return { stopAll: async () => { for(const run of comparisonRuns.values())run.controller.abort();unsubscribe?.(); runtime.stopAll(); await mcp.closeAll(); } };
}
module.exports = { installAgent };
