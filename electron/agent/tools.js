const path = require('node:path');
const { normalizeStressOptions } = require('../stress-task');
const { readSkill, readSkillReference } = require('./skills');
const { skillCatalog } = require('./extensions');
const { listCases } = require('./case-discovery');
const { taskOverview, searchTaskLog } = require('./evidence');
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string', minLength: 1, maxLength: 1000 };
const anyObject = { type: 'object' };
const commandTimeoutSchema = { type: 'integer', minimum: 1, maximum: 900 };
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !/apiKey|token|password|passphrase|secret|authorization/i.test(k)).map(([k, v]) => [k, redact(v)]));
}
function createTools({ invoke, readState, saveCase, config, skillsRoots, mcp, registerUpload, saveConfiguration, saveExtensions, deviceOperation, downloadFile, installSkill, executeCommand, readAttachment, commandDirectory }) {
  return async (event, signal) => {
    const tools = [];
    const selectionDomain = () => commandDirectory?.() || '';
    const selectionIdSchema = {type:'string',minLength:1,maxLength:16000,description:'直接使用list_cases返回的selectionId，覆盖整个查询集合，不受分页影响。'};
    const scopeSchema = {type:'array',minItems:1,maxItems:40,uniqueItems:true,items:{type:'string',pattern:'^/',maxLength:1000},description:'允许修改的document JSON Pointer路径；*匹配一个数组索引或对象键，如/steps/*/config/conditions/0/value。未列字段保持不变。'};
    const add = (name, description, schema, execute, confirm = false, interruptOnSteering = false) => tools.push({ name, description, schema, execute, confirm, interruptOnSteering });
    const ipc = channel => async args => redact(await invoke(channel, event, args));
    for (const [action, definition] of Object.entries(require('../quick-action-api').definitions)) {
      add(`quick_action_${action.replaceAll('-', '_')}`, definition.description, definition.schema,
        (args, { signal } = {}) => ipcQuickAction(action, args, signal), !!definition.write);
    }
    const ipcQuickAction = async (action, args, signal) => redact(await invoke('quick-actions:api', { quickActionSignal: signal }, { action, args }));
    for(const [action,definition] of Object.entries(require('../case-library-api').definitions)) {
      add(`case_library_${action}`,definition.description,definition.schema,async args=>redact(await invoke('case-library:api',event,{action,args})),action!=='list');
    }
    add('list_devices', '查询设备；phone手机、glasses眼镜(smart glasses)，runtime为android/harmony/ios。', object({ runtime: { enum: ['android','harmony'] } }), ipc('performance:list-devices'));
    add('run_command', '执行本机程序；command/arguments分开，Shell须显式调用。默认60秒，长命令指定timeoutSeconds。返回stdout/stderr/退出码，不重试，退出0不代表业务成功。未知CLI按需读帮助；Skill命令声明skillContext。', object({ skillContext:{...object({name:str,files:{type:'array',items:str}},['name']),description:'Skill声明准确名称及已读路径；普通命令省略。'}, command: str, arguments: { type: 'array', items: { type: 'string', maxLength: 10000 }, maxItems: 100 }, cwd: str, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 900 } }, ['command','arguments']), (args, { signal }) => executeCommand(args, signal), true, true);
    add('run_commands', '顺序执行命令，返回各条stdout/stderr/退出码；任一失败即停、不重试。timeoutSeconds默认每条60秒，可单条覆盖。Skill命令声明skillContext，进程成功不代表业务成功。', object({ skillContext:{...object({name:str,files:{type:'array',items:str}},['name']),description:'Skill声明准确名称及已读路径；普通命令省略。'}, timeoutSeconds:{...commandTimeoutSchema,description:'每条命令默认秒数，默认60，可单条覆盖。'}, commands:{type:'array',minItems:1,maxItems:20,items:object({command:str,arguments:{type:'array',items:{type:'string',maxLength:10000},maxItems:100},cwd:str,timeoutSeconds:{...commandTimeoutSchema,description:'本条超时秒数，覆盖默认值。'}},['command','arguments'])} },['commands']), (args,{signal})=>require('./command').executeCommands(args,{signal,execute:command=>executeCommand(command,signal)}),true,true);
    const helpArgs=args=>({...args,cwd:args.cwd || commandDirectory?.() || process.cwd()});
    add('read_command_help', '读取并缓存CLI帮助，按程序/环境/参数区分，跨重启保留；arguments以--help或-h结尾，refresh重读。不接受Shell；普通查询或写入用run_command，不缓存。', object({command:str,arguments:{type:'array',items:str,minItems:1,maxItems:100},cwd:str,refresh:{type:'boolean'}},['command','arguments']), (args,{signal})=>executeCommand({...helpArgs(args),timeoutSeconds:60},signal),true,true);
    tools.at(-1).reference = args=>require('./reference-memory').commandHelpSource(helpArgs(args));
    add('update_work_state', '记录目标与进度，sourceCallIds引用成功回执，sourceUserIndices指向用户请求；completionMode区分执行/分析，finish_work收尾，不产生授权。', object({objective:str,phase:str,completionMode:{enum:['action','analysis'],description:'默认action，分析用analysis'},completed:{type:'array',items:str,maxItems:12},nextAction:str,target:anyObject,editScope:scopeSchema,sourceUserIndices:{type:'array',items:{type:'integer',minimum:0},maxItems:20},sourceCallIds:{type:'array',items:str,minItems:1,maxItems:20}},['objective','phase','completed','nextAction','sourceCallIds']), args=>({success:true,workState:args}));
    add('install_skill', '执行已授权的Skill安装程序与参数；skillRoots为实际安装的绝对根目录，expectedSkill为目标名称。完成后扫描验证并纳入平台，返回退出码/输出/诊断；保持指定目标，不创建用例。', object({ command: str, arguments: { type: 'array', items: str, maxItems: 100 }, cwd: str, skillRoots: { type: 'array', items: str, minItems: 1, maxItems: 10 }, expectedSkill: str, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 900 } }, ['command','arguments','skillRoots','expectedSkill']), (args, { signal }) => installSkill(args, signal), true);
    add('download_file', '下载HTTP(S)文件到solopi-desktop管理目录，返回本地绝对路径、字节数和SHA256。网络APK先下载，再把返回path传给install_apk；下载不会执行文件或安装依赖。', object({ url: { type: 'string', minLength: 1, maxLength: 8192 }, fileName: str }, ['url']), (args, { signal }) => downloadFile(args, signal), true);
    add('install_apk', '直接安装本地 APK 到指定 Android 设备，复用 solopi-desktop 快速安装；无需查询组件、读取 Skill 或创建用例。', object({ serial: str, apkPath: str }, ['serial','apkPath']), (args, { signal }) => deviceOperation('install', args, signal), true);
    add('uninstall_package', '直接卸载指定 Android 设备的应用（会删除应用数据），执行 adb uninstall；无需创建用例。卸载成功后才继续安装。', object({ serial: str, packageName: str }, ['serial','packageName']), (args, { signal }) => deviceOperation('uninstall', args, signal), true);
    add('list_packages', '查询设备已安装包名', object({ serial: str, runtime: { enum: ['android','harmony'] } }, ['serial']), ipc('performance:list-packages'));
    add('list_cases', '查询当前平台用例摘要；目录含子目录，排除范围须指定libraryId。返回total、selectionId和selectionRevision。运行或批量导出直接传selectionId，无需抄写分页ID、读取完整配置或Git文件。caseIds仅当前页，nextOffset非空表示还有页。', object({ query: str, libraryId: str, folderId: str, excludeFolderIds:{type:'array',items:str,uniqueItems:true},excludeCaseIds:{type:'array',items:str,uniqueItems:true}, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }), args => listCases(readState(), args, selectionDomain()));
    add('query_case_steps', '查询平台当前步骤字段，不读Git。fields以步骤为根，如/inputs/lineRegex，禁用/steps/*及通配符，支持JSON字符串。componentKind/Name/Source取真实定义且用例优先；Source不是参数路径，不按ID猜类型。fieldFilters跨组件，componentIds限定ID；total/matchedCaseCount为全页命中数，caseCount为查询用例数。', object({selectionId:selectionIdSchema,caseIds:{type:'array',items:str,minItems:1,maxItems:100,uniqueItems:true},fields:{type:'array',items:{type:'string',pattern:'^/',maxLength:1000},minItems:1,maxItems:20},componentIds:{type:'array',items:str,maxItems:50},componentKinds:{type:'array',items:str,maxItems:50},fieldFilters:{type:'array',minItems:1,maxItems:20,description:'AND筛选；contains为字面包含，非正则。',items:object({path:{type:'string',pattern:'^/'},operator:{enum:['equals','contains']},value:{type:'string'}},['path','operator','value'])},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}},['fields']), args=>redact(require('./case-step-query').query(readState(),args,selectionDomain())));
    tools.at(-1).schema.oneOf=[{required:['selectionId'],not:{required:['caseIds']}},{required:['caseIds'],not:{required:['selectionId']}}];
    add('read_case', '读取用例完整步骤与连线，默认仅返回步骤引用的有效组件（随用例保存的定义优先于全局）。includeComponents=none省略组件，all用于编辑用例保存的完整组件定义。顶层components仅为参考，不要复制保存。', object({ caseId: str, includeComponents: {enum:['referenced','none','all']} }, ['caseId']), args => redact(require('./case-contract').readCase(readState(), args)));
    add('list_components', '查询当前可用组件定义，用来生成用例，禁止臆造命令。', object(), () => redact(readState().components || []));
    add('export_cases', '批量编辑：传list_cases的selectionId，或明确caseIds/库范围。allowedPaths限定本次允许修改的字段，其余字段改动会在保存前拒绝。返回完整文档文件路径，不修改用例。脚本保留版本和未改字段，再save_cases_from_file；不直接编辑用例库存储。', object({ selectionId:selectionIdSchema, caseIds: { type: 'array', items: str, minItems: 1, uniqueItems: true }, libraryId: str, folderId: str, expectedCaseCount:{type:'integer',minimum:1},expectedSelectionRevision:str,excludeFolderIds:{type:'array',items:str,uniqueItems:true},excludeCaseIds:{type:'array',items:str,uniqueItems:true},allowedPaths:scopeSchema }, []), async args => {
      const state=readState();
      return require('./case-batch').exportCases(state, require('./case-selection').resolveCaseSelection(state,args,selectionDomain()), {allowedPaths:args.allowedPaths});
    });
    tools.at(-1).schema.oneOf=[{required:['selectionId'],not:{anyOf:['caseIds','libraryId','folderId','query','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['caseIds'],not:{anyOf:['selectionId','libraryId','folderId','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['libraryId','expectedCaseCount'],not:{anyOf:[{required:['caseIds']},{required:['selectionId']}]}}];
    add('save_cases_from_file', '保存export_cases生成的JSON文件，仅更新updates所列用例。先全量校验版本及字段范围，再逐条保存并同步UI；dryRun只校验。保留caseId/expectedRevision/未改字段，可排除未修改条目。返回saved/remaining/changedFields；部分失败仅处理剩余项，不是跨用例原子事务。', object({ filePath: str, dryRun: { type: 'boolean' } }, ['filePath']), async (args, context = {}) => {const result=await require('./case-batch').saveCasesFromFile(args, { readState, saveCase, signal: context.signal || signal });return {...result,savedScopeSummary:require('./case-scope-summary').summarize(readState(),result.saved || [])};}, true);
    add('save_case', '创建/修改单个平铺document，id须等于caseId；先read_case。省略字段保留；steps/edges/components数组整体替换，已有步骤须保留原字段。复制传sourceCaseId继承素材上下文，不让用户重复配置已有素材。dryRun仅校验，新建为draft；批量编辑用export_cases与save_cases_from_file。', object({ action: { enum: ['create-case', 'update-case'] }, sourceCaseId:{...str,description:'复制已有用例时填写明确来源caseId，平台继承素材基准目录；不得从仓库JSON只复制相对路径。'}, caseId: str, libraryId: str, folderId: str, document: require('./case-contract').documentSchema, dryRun: { type: 'boolean' } }, ['action', 'caseId', 'document']), args => {
      if(args.action === 'update-case') require('./case-contract').assertPreservedStepFields(readState().cases?.find(c=>c.id===args.caseId), args.document, readState().components || []);
      const state=readState(),existing=state.cases?.find(c=>c.id===args.caseId);
      require('./case-contract').assertLogSampleExtraction(state,{...existing,...args.document},existing);
      return saveCase(args);
    }, true);
    add('submit_task', '修改后重跑用editScope(saved-cases,saveCallId)绑定保存回执并仅提交saved与指定库的交集；明确独立任务才用independent-task。提交现有用例：优先传list_cases的selectionId，无需读完整配置；也支持caseIds或libraryId+expectedCaseCount。未指定SN用顶部设备，显式SN优先；不推测替换包名。设备按实际SN互斥，TEST_TASK_BUSY只查询已有任务，不绕过执行。startOptions控制本次录屏/投屏；performanceOptions控制随任务采集，采样不等于压测。压测必须传用户指定的stress轮数或分钟数。提交后只按真实回执说明taskId/taskType/devices/startOptions/performanceOptions，performanceAcknowledged=false不能宣称开启，完成后核查实际视频和样本。失败返回校验结果，不盲目重提。', object({ selectionId:selectionIdSchema, caseIds: { type: 'array', items: str, minItems: 1, maxItems: 100, uniqueItems: true }, libraryId: str, folderId: str, expectedCaseCount: {type:'integer',minimum:1},expectedSelectionRevision:str,excludeFolderIds:{type:'array',items:str,uniqueItems:true},excludeCaseIds:{type:'array',items:str,uniqueItems:true}, editScope:object({saveCallId:str,mode:{enum:['saved-cases','independent-task']}},['saveCallId','mode']), taskName: str, devices: object({ phone: object({ serial: str, runtime: { enum: ['android','harmony','ios'] }, packageName: str }, ['serial']), glasses: object({ serial: str, runtime: { enum: ['android','harmony','ios'] }, packageName: str }, ['serial']) }), performanceOptions: require('../workflow-performance').performanceOptionsSchema, startOptions:object({keepScreenAwake:{type:'boolean'},recordPhoneScreen:{type:'boolean'},recordGlassesScreen:{type:'boolean'},showPhoneScreen:{type:'boolean'},showGlassesScreen:{type:'boolean'}}), stress: object({ mode: { enum: ['rounds','duration'], description: 'rounds按轮数；duration按分钟数' }, value: { type: 'integer', minimum: 1, maximum: 100000, description: '轮数或分钟数，由用户目标确定' }, phoneLog: { type: 'boolean', description: '采集手机完整日志，默认false' }, glassesLog: { type: 'boolean', description: '采集眼镜完整日志，默认true' } }, ['mode','value']) }, []), async (args, { operationId }) => {
      let submissionDispatched = false;
      try {
        const stress = normalizeStressOptions(args.stress);
        if(args.performanceOptions!==undefined) {
          const schema=tools.find(t=>t.name==='submit_task').schema.properties.performanceOptions;
          if(!new (require('ajv'))().validate(schema,args.performanceOptions)) throw Error('performanceOptions无效：使用phone/glass布尔开关和targets.<role>的serial/packageName，不支持enabled。');
          require('../workflow-performance').validateWorkflowPerformanceTargets(args.performanceOptions);
        }
        if(args.startOptions!==undefined){const schema=tools.find(t=>t.name==='submit_task').schema.properties.startOptions;const Ajv=require('ajv');if(!new Ajv().validate(schema,args.startOptions))throw Error('startOptions仅接受已声明的布尔采集/显示参数');}
        const s = readState();
        const caseIds = require('./case-selection').resolveCaseSelection(s,args,selectionDomain());
        const definitionRevision=require('./task-execution-state').definitionRevision(s,args,selectionDomain());
        const cases = caseIds.map(id => {
          const c = s.cases?.find(c => c.id === id); if (!c) throw Error(`用例不存在：${id}`);
          const defaults = { ...c.defaults };
          for (const role of ['phone','glasses']) {
            if (args.devices?.[role]?.serial) defaults[`${role}Serial`] = args.devices[role].serial;
            if (args.devices?.[role]?.packageName) defaults[`${role}Package`] = args.devices[role].packageName;
          }
          return require('../case-assets').withAssetContext(s,{...c,defaults});
        });
        // Embedded previews honor the saved case flags; suppress duplicate native scrcpy windows.
        let payload = { ...args, startConfigOverride:args.startOptions, caseIds, stress, taskId: `agent-${operationId}`, source: 'agent', cases, components: s.components || [], caseEdges: s.caseEdges || {}, llmProviders: s.llmProviders || [], selectedLlmProviderId: s.selectedLlmProviderId, disableScreenMirror: true };
        const validation = await invoke('workflow:validate-task-selection', event, payload);
        if (!validation.success) return redact(validation);
        require('./case-selection').resolveCaseSelection(readState(),{...args,...(args.libraryId?{expectedSelectionRevision:listCases(s,args).selectionRevision}:{})},selectionDomain());
        if(definitionRevision!==require('./task-execution-state').definitionRevision(readState(),args,selectionDomain()))throw Object.assign(Error('目标用例或引用组件在校验期间发生变化，请基于当前版本重新提交；未创建任务'),{code:'CASE_DEFINITION_CHANGED'});
        if (validation.devices) {
          payload.devices = validation.devices;
          for (const c of payload.cases) for (const role of ['phone','glasses']) {
            const target = payload.devices[role];
            if (target?.serial) c.defaults = {...c.defaults,[`${role}Serial`]:target.serial};
          }
        }
        submissionDispatched = true;
        const result = await invoke('workflow-task:submit', event, payload);
        return redact({ success: result.success, submitted: result.submitted, taskId: result.taskId, status: result.status, caseCount: result.caseCount, taskType: result.task?.taskType, stress: result.task?.stress || null, devices:result.task?.devices,caseIds:result.task?.caseIds,uiVisibility:result.task?.uiVisibility,startOptions:result.task?.startOptions,performanceOptions:result.task?.performanceOptions,performanceAcknowledged:args.performanceOptions!==undefined ? result.task?.performanceOptions!==undefined : undefined,error: result.error, errorCode: result.errorCode, activeTask: result.activeTask, activeTasks: result.activeTasks, conflictingDevices: result.conflictingDevices, reservedDeviceSerials: result.task?.reservedDeviceSerials });
      } catch (error) {
        if (!submissionDispatched) error.submissionOutcome = 'not-submitted';
        throw error;
      }
    }, true);
    tools.at(-1).taskIdForOperation = operationId => `agent-${operationId}`;
    tools.at(-1).taskCaseIds = args => require('./case-selection').resolveCaseSelection(readState(),args,selectionDomain());
    tools.at(-1).taskDefinitionRevision = args => require('./task-execution-state').definitionRevision(readState(), args, selectionDomain());
    tools.at(-1).schema.oneOf=[{required:['selectionId'],not:{anyOf:['caseIds','libraryId','folderId','query','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['caseIds'],not:{anyOf:['selectionId','libraryId','folderId','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['libraryId','expectedCaseCount'],not:{anyOf:[{required:['caseIds']},{required:['selectionId']}]}}];
    add('start_performance', '独立时段性能采集：仅用于用户单独要求采集当前应用性能，不执行业务用例。随业务回归采集应在submit_task设置performanceOptions，不用本工具另开等待任务，也不能补回过去运行期数据。与测试任务共用按实际SN互斥保护，同一SN有任务（含收尾）时不得另开，不同SN可并行。采集CPU/内存/线程及电池温度，返回taskId；不等于应用耗电报告。', object({ serial: str, packageName: str, role: { enum: ['phone','glasses'] }, durationSeconds: { type: 'integer', minimum: 5, maximum: 3600 }, intervalSeconds: { type: 'integer', minimum: 1, maximum: 60 } }, ['serial','packageName','role','durationSeconds']), async (args, { operationId }) => {
      const id = `agent-perf-${operationId}`;
      const testCase = { schemaVersion: 'glassbox.workflow.v1', id, name: '性能采集', steps: [
        { id: 'start', name: '开始', type: 'start', device: 'phone', config: {} },
        { id: 'collect', name: '采集性能', type: 'wait', device: 'phone', config: { durationMs: args.durationSeconds * 1000 } },
        { id: 'end', name: '结束', type: 'end', device: 'phone', config: {} },
      ] };
      const payload = { taskId: id, taskName: 'Agent 性能采集', source: 'agent', cases: [testCase], components: [], disableScreenMirror: true,
        performanceOptions: { [args.role]: true, intervalMs: (args.intervalSeconds || 5) * 1000, targets: { [args.role]: { serial: args.serial, packageName: args.packageName, runtime: 'android' } } } };
      const validation = await invoke('workflow:validate-task-selection', event, payload);
      if (!validation.success) return redact(validation);
      const r = await invoke('workflow-task:submit', event, payload);
      return { success: r.success, submitted: r.submitted, taskId: r.taskId, status: r.status, error: r.error, errorCode: r.errorCode, activeTask: r.activeTask, activeTasks: r.activeTasks, conflictingDevices: r.conflictingDevices, reservedDeviceSerials: r.task?.reservedDeviceSerials };
    }, true);
    add('list_tasks', '按taskId/query分页查任务摘要；详情用read_task_report。', object({ taskId: str, query: str, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }), async args => {
      if (args.taskId) {
        const r = await invoke('workflow-report:load-task', event, { taskId: args.taskId });
        return r.success ? { success: true, task: redact(taskOverview(r.task)) } : r;
      }
      const result = await invoke('workflow-task:list', event, {});
      if (result.success === false || result.error) return redact(result);
      const tasks = (result.tasks || []).filter(t => (!args.taskId || t.id === args.taskId) && (!args.query || String(t.name || '').includes(args.query)));
      const offset = args.offset || 0, end = offset + (args.limit || 20);
      return redact({ success: true, total: tasks.length, nextOffset: end < tasks.length ? end : null,
        tasks: tasks.slice(offset, end).map(t => ({ id: t.id, name: t.name, status: t.status, error: t.error, summary: t.summary, updatedAt: t.updatedAt })) });
    });
    add('read_task_result', '按taskId读取状态/计数/通过率/设备/报告路径。终态先交付回执再分析；success仅查询成功，业务看status/counts；失败清单nextOffset分页，未知不猜成功、不重复提交。', object({taskId:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:20}},['taskId']), async args => {
      const r = await invoke('workflow-report:load-task', event, { taskId: args.taskId });
      return r.success ? redact(require('../task-case-query').taskResultReceipt(r.task,args)) : r;
    });
    add('read_task_report', '按taskId查询；cases按statuses筛选并按nextOffset翻页，selectionComplete才是完整清单，部分不能推断无失败；validate_case_coverage核对。summary含附件/性能；steps批量返回caseIds执行步骤精简表，details含失败摘要，原输出用read_case_results。终态复用快照，refresh重读；success仅查询成功。', object({ taskId: str,refresh:{type:'boolean'},caseIds:{type:'array',items:str,minItems:1,uniqueItems:true},statuses:{type:'array',items:{enum:require('../task-case-query').CASE_STATUSES},minItems:1,uniqueItems:true},view:{enum:['cases','summary','details','steps'],default:'cases'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50} }, ['taskId']), async args => {
      const r = await invoke('workflow-report:load-task', event, args);
      return r.success ? { success: true, successScope:'query', executionReceipt: redact(require('../task-case-query').taskResultReceipt(r.task,{limit:1})), task: redact(taskOverview(r.task,{...args,view:args.view || 'cases'})) } : r;
    });
    tools.at(-1).reference = args => {
      const task=readState?.()?.automationTasks?.find(task=>task.id===args.taskId);
      if(!task || !['success','failed','stopped'].includes(task.status) || !task.reportDetailPath)return;
      const memory=require('./reference-memory');
      return {key:memory.digest(['terminal-report',args.taskId,args.caseIds || [],args.statuses || [],args.view || 'cases',args.offset || 0,args.limit || 20]),
        version:memory.digest([memory.fileVersion(task.reportDetailPath),task.status,task.taskRevision,task.eventRevision,task.updatedAt]),label:`终态报告 ${args.taskId} offset=${args.offset || 0}`};
    };
    add('validate_case_coverage','对当前任务的完整分析清单做确定性核对：按statuses筛选原始报告，检查caseId漏项/重复/超范围及原始name/status差异。错误ID/漏项/重复/名称或状态不符时success=false并返回原始canonicalCases；丢弃无效清单，不基于错误行继续归因。category只检查是否填写，待分类仍列出；不验证业务归属或根因。coverageComplete与classificationComplete分开返回，未知不得算已分析完成。',object({taskId:str,statuses:{type:'array',items:{enum:require('../task-case-query').CASE_STATUSES},minItems:1,uniqueItems:true},rows:{type:'array',maxItems:10000,items:object({caseId:str,name:{type:'string'},status:{enum:require('../task-case-query').CASE_STATUSES},category:{type:'string'}},['caseId','name','status'])}},['taskId','rows']),async args=>{
      const r=await invoke('workflow-report:load-task',event,{taskId:args.taskId});
      return r.success?require('../task-case-coverage').validateCaseCoverage(r.task,args):r;
    });
    add('clean_tasks','按taskIds或筛选直接清理，无需token。dryRun只预览；默认limit50，keep豁免。默认保留产物，purgeArtifacts才删除专属产物，backup指定备份。运行中整批拒绝、不自动stop；回执未知不重试。',object({taskIds:{type:'array',items:str,minItems:1},query:str,olderThan:str,before:str,status:{enum:['success','failed','stopped']},keep:{type:'array',items:str},limit:{type:'integer',minimum:1,maximum:100000},purgeArtifacts:{type:'boolean'},backup:str,dryRun:{type:'boolean'}}),async args=>redact(await invoke('workflow-task:clean',event,args)),true);
    add('read_case_results', '按taskId/caseId读取：summary步骤/附件摘要，timeline顺序与UTC，configuration+stepId配置，details+stepId命令输出，artifacts+artifactKind/artifactIndex产物。nextOffset分页，includeSnapshot=true返回快照；日志限本例，success非业务通过。', object({ taskId: str, caseId: str, view:{enum:['summary','details','configuration','artifacts','timeline'],default:'summary'}, artifactKind:str,artifactIndex:{type:'integer',minimum:0}, stepId:str, includeSnapshot:{type:'boolean'}, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['taskId','caseId']), async args => {
      const r = await invoke('workflow-report:load-task', event, args);
      if (!r.success) return r;
      const c = (r.task.cases || []).find(c => c.id === args.caseId || c.caseId === args.caseId);
      if (!c) throw Error('报告用例不存在');
      const offset = args.offset || 0, end = offset + (args.limit || 5);
      const results=args.stepId?(c.results || []).filter(result=>result.stepId===args.stepId):(c.results || []);
      if(args.stepId && !results.length && args.view!=='configuration')throw Error('报告步骤不存在，请使用该用例报告中的stepId，不猜测ID');
      const {caseSnapshot}=c;
      const projection=require('./case-evidence-summary');
      const view=args.view || (args.includeSnapshot?'details':'summary');
      if(view==='timeline')return redact(projection.caseTimeline(c,args));
      if(view==='summary')return redact(projection.caseEvidenceSummary(c,args));
      if(view==='configuration')return redact(projection.caseConfiguration(c,args));
      if(view==='artifacts')return redact(projection.caseArtifacts(c,args));
      return redact({ ...projection.caseEvidenceSummary(c,args), ...(args.includeSnapshot?{caseSnapshot}:{}), success: true, successScope:'query', results: results.slice(offset, end), total: results.length, nextOffset: end < results.length ? end : null });
    });
    add('export_case_evidence', '按报告边界导出本例日志gzip与录屏来源manifestPath/reportPath，缺失明示，不上传。',object({taskId:str,caseIds:{type:'array',items:str,minItems:1,maxItems:50,uniqueItems:true},deviceTypes:{type:'array',items:{enum:['phone','glasses']},minItems:1,uniqueItems:true}},['taskId','caseIds']),async(args,{signal})=>{
      const r=await invoke('workflow-report:load-task',event,{taskId:args.taskId});
      return r.success?require('./case-evidence-export').exportCaseEvidence(r.task,args,{root:path.join(commandDirectory?.() || require('node:os').tmpdir(),'evidence-exports'),signal}):r;
    });
    add('search_task_logs', '批量最多12项文本查询，countOnly统计，nextLine分页。单例传caseId按报告边界查，缺边界失败；省略为整场，不能当单例证据。多来源须指定deviceType/fileIndex。',object({taskId:str,caseId:str,deviceType:{enum:['phone','glasses']},fileIndex:{type:'integer',minimum:0},queries:{type:'array',minItems:1,maxItems:12,items:object({id:{type:'string',minLength:1,maxLength:100},query:{type:'string',maxLength:500},timeText:{type:'string',maxLength:50},startTime:{type:'string',pattern:'^\\d{2}:\\d{2}:\\d{2}$'},endTime:{type:'string',pattern:'^\\d{2}:\\d{2}:\\d{2}$'},fromLine:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:80},countOnly:{type:'boolean'}},['query'])}},['taskId','queries']),async(args,{signal})=>{const r=await invoke('workflow-report:load-task',event,args);return r.success?require('./log-search-batch').searchTaskLogs(r.task,args,signal):r;});
    add('search_task_log', '按query/时间/fromLine查任务日志；多来源指定deviceType/fileIndex，nextLine分页。', object({ taskId: str, caseId:str, deviceType:{enum:['phone','glasses']}, fileIndex: { type: 'integer', minimum: 0 }, query: { type: 'string', maxLength: 500 }, timeText: { type: 'string', maxLength: 50 }, startTime: { type: 'string', pattern: '^\\d{2}:\\d{2}:\\d{2}$' }, endTime: { type: 'string', pattern: '^\\d{2}:\\d{2}:\\d{2}$' }, fromLine: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['taskId']), async (args, { signal }) => {
      const r = await invoke('workflow-report:load-task', event, args);
      if(!r.success)return r;
      if(args.caseId){const result=await require('./log-search-batch').searchTaskLogs(r.task,{...args,queries:[{query:args.query || '',timeText:args.timeText,startTime:args.startTime,endTime:args.endTime,fromLine:args.fromLine,limit:Math.min(args.limit || 40,80)}]},signal);return redact(result.success?{...result,...result.results[0]}:result);}
      return redact(await searchTaskLog(r.task, args, signal));
    });
    add('read_performance_report', '分页读取任务性能采样，包含CPU、内存、线程和电池温度；target取read_task_report的performanceTargets；该报告摘要同时含performanceStatus与各目标样本计数，不能因旧任务无数据推断当前采集失效。', object({ taskId: str, target: str, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['taskId','target']), async args => {
      const r = await invoke('workflow-report:load-task', event, args);
      if (!r.success) return r;
      const report = r.task.performanceReports?.[args.target];
      if (!report) throw Error('性能报告目标不存在');
      const { samples = [], ...summary } = report;
      const offset = args.offset || 0, end = offset + (args.limit || 50);
      return redact({ success: true, ...summary, samples: samples.slice(offset, end), total: samples.length, nextOffset: end < samples.length ? end : null });
    });
    add('watch_operation', '订阅task/battery；task默认终态通知，逐条分析传reviewCases=true，执行器不等分析。已有订阅无需重复调用，断连补状态用refresh。分析失败或停止监听不停止任务；终止需显式stop_task及授权。', object({ kind: { enum: ['task','battery'] }, id: str, reviewCases: { type: 'boolean' },refresh:{type:'boolean'} }, ['kind','id']), async args => {
      const r = args.kind === 'task' ? await invoke('workflow-report:load-task', event, { taskId: args.id }) : await invoke('bugreport:status', event, { id: args.id });
      if (r.error || r.success === false) return redact(r);
      const status = r.task?.status || r.status;
      const {refresh,...identity}=args;
      const subscription = { ...identity, reviewCases: args.kind === 'task' && args.reviewCases === true };
      if (args.kind === 'task' && args.reviewCases) return {success:true,waiting:subscription,taskSnapshot:r.reviewSnapshot || require('./review-events').reviewSnapshot(r.task || r)};
      return ['submitted','running','stopping','collecting','parsing','saving'].includes(status)
        ? { success: true, waiting: subscription } : { success: true, id: args.id, status, reportKey: r.reportKey, message: '任务已结束，请读取结果' };
    });
    add('stop_task', '停止指定测试任务及所属进程', object({ taskId: str }, ['taskId']), ipc('workflow-task:stop'), true);
    add('sample_performance', '单次采集指定应用 CPU/内存/线程及设备电池温度；连续采集请 submit_task 开启 performanceOptions', object({ serial: str, packageName: str, runtime: { enum: ['android','harmony'] } }, ['serial','packageName']), ipc('performance:sample'));
    add('start_battery_import', '后台导入设备 Bugreport 或用户指定本地 zip/txt/log，返回 jobId。设备导出期间保持连接。', object({ mode: { enum: ['device','upload'] }, serial: str, path: str }, ['mode']), args => {
      const payload = { mode: args.mode, serial: args.serial };
      if (args.mode === 'upload') { if (!path.isAbsolute(args.path || '')) throw Error('请提供日志绝对路径'); payload.token = registerUpload(event.sender.id, args.path).token; }
      return ipc('bugreport:start')(payload);
    }, true);
    add('battery_import_status', '查询后台导入任务（按需查询，不循环轮询）', object({ id: str }, ['id']), ipc('bugreport:status'));
    add('battery_reports', '查询已保存耗电报告', object(), ipc('bugreport:history'));
    add('open_battery_report', '读取耗电报告及日志证据', object({ key: str }, ['key']), ipc('bugreport:open-report'));
    add('read_environment', '读取环境配置（敏感字段不提供给模型）', object(), ipc('environment:get-config'));
    add('save_environment', '修改ADB路径或TTS非密钥参数，保留其他配置。先读配置；密钥在设置中心填写。', object({ adbPath: str, ttsProvider: anyObject }), async args => {
      if (args.ttsProvider && JSON.stringify(args.ttsProvider).match(/apiKey|token|secret|password/i)) throw Error('TTS密钥请在设置中心填写');
      const current = await invoke('environment:get-config', event, {});
      if (args.ttsProvider) args = { ...args, ttsProvider: { ...current.config.ttsProvider, ...args.ttsProvider } };
      const saved = await invoke('environment:save-config', event, { ...current.config, ...args });
      if (saved.success) event.sender.send('agent:environment-update', saved);
      return redact(saved);
    }, true);
    add('read_attachment', '按附件本机路径读取UTF-8文本/日志/JSON/代码，可分页；二进制文档需对应解析工具，不把二进制当文本。', object({path:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:64000}},['path']), args=>readAttachment(args));
    add('read_device_settings', '设置中心设备管理：读取手机/眼镜默认包名及固定SN；默认包名与单个用例包名不同。', object(), () => ({deviceBindings: readState().deviceBindings || {}}));
    add('save_device_settings', '差量保存设置中心设备管理并同步顶部设备区。默认包名须完整包名；简称先用list_packages查询实际设备，多个匹配需用户选择。SN数组为完整替换。', object({phoneDefaultPackage:str,glassesDefaultPackage:str,phoneSerials:{type:'array',items:str},glassesSerials:{type:'array',items:str}}), async args => ({...await saveConfiguration({deviceBindings:args}), deviceBindings:readState().deviceBindings}), true);
    add('describe_capabilities', 'solopi-desktop内部功能导航：不确定设置在哪或该调用哪个工具时查询，不读取历史任务。', object(), () => ({sections: [
      {name:'设备管理/默认包名/固定SN',read:'read_device_settings',write:'save_device_settings'},
      {name:'模型/组件',read:'read_configuration',write:'save_configuration'},
      {name:'ADB环境/TTS',read:'read_environment',write:'save_environment'},
      {name:'快捷操作/切环境/历史日志',read:'quick_action_list + quick_action_show',write:'quick_action_execute'},
      {name:'MCP/Skills',read:'read_configuration/list_skills',write:'save_extensions/install_skill'},
      {name:'用例库Git同步',read:'case_library_list',write:'case_library_configure/case_library_pull/case_library_push',rule:'CLI cases configure/pull/push；与quick_action_export_git不同，export_cases只是本地导出。'},
      {name:'用例编写运行',read:'list_cases/read_case',write:'save_case/submit_task'},
      {name:'任务录屏/视频证据',read:'read_task_report/read_case_results',write:'submit_task(startOptions.recordPhoneScreen/recordGlassesScreen)',rule:'任务层已有连续录屏与逐例切片；不是组件，省略沿用配置，提交后核对startOptions、完成后核对recordings。'},
      {name:'性能测试/耗电分析',read:'read_performance_report/read_task_report',write:'start_performance/start_battery_import'}
    ], rule:'仅已注册工具代表可执行能力；未覆盖设置明确说明，不通过猜测字段或修改其他配置代替。'}));
    add('read_configuration', '查询模型列表、当前模型、组件和扩展配置，不返回密钥。模型密钥在设置中心安全表单填写。', object(), () => {
      const s = readState(); return redact({ models: s.llmProviders || [], selectedModelId: s.selectedLlmProviderId, components: s.components || [], extensions: config() });
    });
    add('save_configuration', '保存模型非密钥参数、选择模型或新建/修改通用组件。component必须按现有组件格式包含id/name/kind/device/commandTemplate/params/timeoutSeconds，先读取现有定义。', object({ model: object({ id: str, name: str, model: str, baseUrl: str }, ['id','name','model','baseUrl']), selectedModelId: str, action: { enum: ['create','update'] }, component: anyObject }), async args => redact(await saveConfiguration(args)), true);
    add('save_extensions', '保存MCP/Skill配置。先读再合并；凭据仅引用环境变量，不接受密钥。', object({ mcpServers: { type: 'array', items: anyObject, maxItems: 20 }, skillRoots: { type: 'array', items: str, maxItems: 20 } }, ['mcpServers','skillRoots']), args => saveExtensions(args), true);
    add('cancel_battery_import', '取消指定后台耗电导入及所属进程', object({ id: str }, ['id']), ipc('bugreport:cancel'), true);
    const catalog = () => { const c = skillCatalog(skillsRoots(), config()); return { ...c, skills: c.skills.filter(s => s.enabled) }; };
    add('list_skills', '列出 Agent Skills 元数据和依赖说明，按需加载正文', object(), () => ({ skills: catalog().skills.map(({ directory, ...meta }) => meta), diagnostics: catalog().diagnostics }));
    add('read_skill', '完整加载Skill入口，不分页。directory/absolutePath为真实路径，按此执行脚本，不猜目录。参考文件用read_skill_reference。', object({name:str,refresh:{type:'boolean'}},['name']), ({name})=>readSkill(catalog().skills,name));
    add('read_skill_reference', '按file读取Skill参考（入口用read_skill）。小文件全文，大文件目录，query定位、section读完整章节、offset翻目录；complete/sectionComplete标明覆盖。执行脚本用返回absolutePath。', object({name:str,file:{...str,not:{enum:['SKILL.md','./SKILL.md']}},section:str,query:str,refresh:{type:'boolean'},offset:{type:'integer',minimum:0}},['name','file']), ({name,file,...options})=>readSkillReference(catalog().skills,name,file,options));
    for(const tool of tools.filter(t=>['read_skill','read_skill_reference'].includes(t.name)))tool.reference = args => {
      const {file}=require('./skills').resolveSkillFile(catalog().skills,args.name,args.file);
      return {skillName:args.name,skillFile:args.file || 'SKILL.md',key:require('./reference-memory').digest(['skill-read-contract-v2',args.name,args.file || 'SKILL.md',args.section || '',args.query || '',args.offset || 0]),version:require('./reference-memory').fileVersion(file),label:`Skill ${args.name}/${args.file || 'SKILL.md'}${args.section ? ' '+args.section : ''}`};
    };
    for (const server of config().mcpServers || []) {
      if (!server.enabled) continue;
      try { tools.push(...await mcp.connect(server, signal)); }
      catch (error) { add(`mcp_error_${server.id}`, `MCP ${server.id} 连接失败`, object(), () => ({ success: false, error: error.message })); }
    }
    // Stable small bootstrap; all other native/MCP schemas are loaded on demand.
    const bootstrap=new Set(['describe_capabilities','list_skills','read_skill','read_skill_reference','read_command_help','run_command','run_commands','update_work_state','read_task_report','validate_case_coverage','list_devices']);
    for(const tool of tools)tool.deferred=!bootstrap.has(tool.name);
    return tools;
  };
}
module.exports = { createTools, object, redact };
