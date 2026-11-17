const path = require('node:path');
const { normalizeStressOptions } = require('../stress-task');
const { readSkill, readSkillReference } = require('./skills');
const { skillCatalog } = require('./extensions');
const { listCases } = require('./case-discovery');
const { taskOverview, searchTaskLog } = require('./evidence');
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string', minLength: 1, maxLength: 1000 };
const taskIdSchema = {...str, description: '任务ID是不透明标识；逐字使用原提交或查询回执中的完整值，不推导、添加或改写前缀。'};
const anyObject = { type: 'object' };
const commandTimeoutSchema = { type: 'integer', minimum: 1, maximum: 900 };
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !/apiKey|token|password|passphrase|secret|authorization/i.test(k)).map(([k, v]) => [k, redact(v)]));
}
function createTools({ invoke, readState, saveCase, config, skillsRoots, mcp, registerUpload, saveConfiguration, saveExtensions, deviceOperation, downloadFile, installSkill, executeCommand, readAttachment, commandDirectory }) {
  return async (event, signal, { platformOnly = false } = {}) => {
    const tools = [];
    const selectionDomain = () => commandDirectory?.() || '';
    const selectionIdSchema = {type:'string',minLength:1,maxLength:16000,description:'list_cases的selectionId覆盖全查询，不受分页影响。'};
    const scopeSchema = {type:'array',minItems:1,maxItems:40,uniqueItems:true,items:{type:'string',pattern:'^/',maxLength:1000},description:'document允许修改的JSON Pointer；*匹配单层索引/键，未列字段不变。'};
    const add = (name, description, schema, execute, confirm = false, interruptOnSteering = false, metadata = {}) => tools.push({ name, description, schema, execute, confirm, interruptOnSteering, ...metadata });
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
    add('run_command', '执行本机程序，command/arguments分开；Shell显式调用。默认60秒，长命令传timeoutSeconds。返回stdout/stderr/退出码，不重试；退出0非业务成功。未知CLI读帮助，Skill声明skillContext。', object({ skillContext:{...object({name:str,files:{type:'array',items:str}},['name']),description:'Skill名称/已读路径；普通命令省略。'}, command: str, arguments: { type: 'array', items: { type: 'string', maxLength: 10000 }, maxItems: 100 }, cwd: str, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 900 } }, ['command','arguments']), (args, { signal }) => executeCommand(args, signal), true, true);
    // Deterministic remote transport shares the same command executor, without a Client model.
    const hostCommand=tools.find(tool=>tool.name==='run_command');
    tools.push({...hostCommand,name:'execute_host_command',description:'机械执行已授权的Client宿主命令，不启动Agent模型；command/arguments分离，未知写入仅回读原requestId，不自动重试。'});
    add('run_commands', '顺序执行，返回各条stdout/stderr/退出码；失败即停不重试。timeoutSeconds每条默认60秒，可单条覆盖。Skill声明skillContext；进程成功非业务成功。', object({ skillContext:{...object({name:str,files:{type:'array',items:str}},['name']),description:'Skill名称/已读路径；普通命令省略。'}, timeoutSeconds:{...commandTimeoutSchema,description:'每条命令默认秒数，默认60，可单条覆盖。'}, commands:{type:'array',minItems:1,maxItems:20,items:object({command:str,arguments:{type:'array',items:{type:'string',maxLength:10000},maxItems:100},cwd:str,timeoutSeconds:{...commandTimeoutSchema,description:'本条超时秒数，覆盖默认值。'}},['command','arguments'])} },['commands']), (args,{signal})=>require('./command').executeCommands(args,{signal,execute:command=>executeCommand(command,signal)}),true,true);
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
    add('read_case', '读取完整步骤与连线。仅改步骤/连线用includeComponents=none，省略组件字段会保留原私有定义；默认referenced只附有效组件。只有修改私有组件定义时用all，避免无关组件淹没用例正文。顶层components仅参考，不能复制保存。', object({ caseId: str, includeComponents: {enum:['referenced','none','all']},format:{enum:['compact','legacy'],default:'compact'} }, ['caseId']), args => redact(require('./case-contract').readCase(readState(), args)));
    add('list_components', '查询当前可用组件定义，用来生成用例，禁止臆造命令。', object(), () => redact(readState().components || []));
    add('export_cases', '批量编辑：传list_cases的selectionId，或明确caseIds/库范围。allowedPaths限定本次允许修改的字段，其余字段改动会在保存前拒绝。参数修改声明/steps/*/inputs/<参数名>，切换已有组件声明/steps/*/componentId，不顺带合并组件params/helperText。返回完整文档文件路径，不修改用例。脚本保留版本和未改字段，再save_cases_from_file；不直接编辑用例库存储。', object({ selectionId:selectionIdSchema, caseIds: { type: 'array', items: str, minItems: 1, uniqueItems: true }, libraryId: str, folderId: str, expectedCaseCount:{type:'integer',minimum:1},expectedSelectionRevision:str,excludeFolderIds:{type:'array',items:str,uniqueItems:true},excludeCaseIds:{type:'array',items:str,uniqueItems:true},allowedPaths:scopeSchema }, []), async args => {
      const state=readState();
      return require('./case-batch').exportCases(state, require('./case-selection').resolveCaseSelection(state,args,selectionDomain()), {allowedPaths:args.allowedPaths});
    });
    tools.at(-1).schema.oneOf=[{required:['selectionId'],not:{anyOf:['caseIds','libraryId','folderId','query','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['caseIds'],not:{anyOf:['selectionId','libraryId','folderId','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['libraryId','expectedCaseCount'],not:{anyOf:[{required:['caseIds']},{required:['selectionId']}]}}];
    add('save_cases_from_file', '批量保存export_cases文件；先全量校验版本/allowedPaths，再逐例保存，保留expectedRevision及未改字段。dryRun仅校验；失败保留已保存项，只处理remaining，不重放saved。返回saved/remaining、变更摘要和fullResultPath（完整回执按需读）。越权改动先还原或按授权重新导出，不放宽范围。', object({ filePath: str, dryRun: { type: 'boolean' } }, ['filePath']), async (args, context = {}) => {const result=await require('./case-batch').saveCasesFromFile(args, { readState, saveCase, signal: context.signal || signal });return require('./context-receipts').saveReceipt({...result,savedScopeSummary:require('./case-scope-summary').summarize(readState(),result.saved || [])},{directory:commandDirectory?.()});}, true);
    add('save_case', '创建/修改单个平铺document，id须等于caseId；document或documentPath二选一，文件草稿直接传绝对路径，无需重新读回全文；先read_case。省略字段保留；steps/edges/components数组整体替换，已有步骤须保留原字段。复制传sourceCaseId继承素材上下文，不让用户重复配置已有素材。dryRun仅校验，新建为draft；批量编辑用export_cases与save_cases_from_file。', object({ action: { enum: ['create-case', 'update-case'] }, sourceCaseId:{...str,description:'复制须来源caseId以继承素材基准目录，不得仅复制仓库JSON相对路径。'}, caseId: str, libraryId: str, folderId: str, document: require('./case-contract').documentSchema, documentPath:{...str,description:'已生成的单个平铺document JSON绝对路径；与document二选一，无需把长文档重新读回模型。'}, dryRun: { type: 'boolean' } }, ['action', 'caseId']), args => {
      args = require('./case-document-file').resolveDocument(args);
      args={...args,document:require('../case-storage').compileDocument(args.document,readState())};
      if(args.action === 'update-case') require('./case-contract').assertPreservedStepFields(readState().cases?.find(c=>c.id===args.caseId), args.document, readState().components || []);
      const state=readState(),existing=state.cases?.find(c=>c.id===args.caseId);
      require('./case-contract').assertLogSampleExtraction(state,{...existing,...args.document},existing);
      return saveCase(args);
    }, true);
    tools.at(-1).schema.oneOf=[{required:['document'],not:{required:['documentPath']}},{required:['documentPath'],not:{required:['document']}}];
    add('group_task', '本机已有用例与已保存设备组任务：catalog分页读已有用例修订/支持边界（不含步骤原文），list读取请求，prepare核现有用例/角色/组版本，submit登记原requestId，status仅按原ID对账，cancel持久请求停止。登记不等于执行批准；缺设备类型确认、原生批准或Server授权均拒执行。结果未知不得换ID重投，不接受任意steps/设备SN。', object({action:{enum:['catalog','list','prepare','submit','status','cancel']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200},requestId:str,groupId:str,expectedRevision:{type:'integer',minimum:1},caseIds:{type:'array',items:str,minItems:1,maxItems:8,uniqueItems:true}},['action']), ipc('cluster-group-tasks:api'));
    add('lab_connection','配置、注册或启动本机实验室Client。使用与桌面相同的连接器；无图形环境也可运行。status查询不启动服务。',object({action:{enum:['status','register','start','disable']},config:object({serverUrl:str,orgKey:str,projectKey:str,computerName:str,allowInsecureHttp:{type:'boolean'},apiMode:{enum:['cp','v1']}},['serverUrl','orgKey','projectKey'])},['action']),ipc('cluster-lab:connection'),true);
    add('list_device_groups','读取本Client真实设备组与成员，不创建虚拟组。',object(),ipc('cluster-lab-groups:list'));
    add('save_device_group','保存本Client设备组；成员按真实deviceId和phone/glasses角色选择，revision用于防止覆盖并发修改。',object({groupId:str,expectedRevision:{type:'integer',minimum:0},name:str,alias:{type:'string',maxLength:128},code:{type:'string',maxLength:128},enabled:{type:'boolean'},confirm:{const:true},members:{type:'array',minItems:1,maxItems:128,items:object({deviceId:str,role:{enum:['phone','glasses']}},['deviceId','role'])}},['expectedRevision','name','members','confirm']),ipc('cluster-lab-groups:save'),true);
    add('submit_task', '重跑用editScope(saved-cases,saveCallId)绑定保存回执，仅交saved与指定库交集；原用户明确要求主链与边界组合验证用requested-selection，绑定最近保存回执、完整查询selectionCallId及原话sourceUserIndex；非自动扩大修改范围。独立任务用independent-task。现有用例优先list_cases的selectionId（无需完整配置），或caseIds、libraryId+expectedCaseCount。SN默认顶部、显式优先，不推测包名。按真实SN互斥，TEST_TASK_BUSY只查已有任务，不绕过。startOptions录屏/投屏，performanceOptions随任务采集（不等于压测）；stress轮数/分钟须用户指定。按回执报告taskId/taskType/devices/startOptions/performanceOptions；performanceAcknowledged=false不得称开启，完成核视频/样本。失败核校验结果，不盲目重提。', object({ selectionId:selectionIdSchema, caseIds: { type: 'array', items: str, minItems: 1, maxItems: 100, uniqueItems: true }, libraryId: str, folderId: str, expectedCaseCount: {type:'integer',minimum:1},expectedSelectionRevision:str,excludeFolderIds:{type:'array',items:str,uniqueItems:true},excludeCaseIds:{type:'array',items:str,uniqueItems:true}, editScope:object({saveCallId:str,mode:{enum:['saved-cases','independent-task','requested-selection']},selectionCallId:str,sourceUserIndex:{type:'integer',minimum:0}},['saveCallId','mode']), groupId:str,expectedGroupRevision:{type:'integer',minimum:1},taskName: str, devices: object({ phone: object({ serial: str, runtime: { enum: ['android','harmony','ios'] }, packageName: str }, ['serial']), glasses: object({ serial: str, runtime: { enum: ['android','harmony','ios'] }, packageName: str }, ['serial']) }), performanceOptions: require('../workflow-performance').performanceOptionsSchema, startOptions:object({keepScreenAwake:{type:'boolean'},recordPhoneScreen:{type:'boolean'},recordGlassesScreen:{type:'boolean'},showPhoneScreen:{type:'boolean'},showGlassesScreen:{type:'boolean'}}), stress: object({ mode: { enum: ['rounds','duration'], description: 'rounds按轮数；duration按分钟数' }, value: { type: 'integer', minimum: 1, maximum: 100000, description: '轮数或分钟数，由用户目标确定' }, phoneLog: { type: 'boolean', description: '采集手机完整日志，默认false' }, glassesLog: { type: 'boolean', description: '采集眼镜完整日志，默认true' } }, ['mode','value']) }, []), async (args, { operationId }) => {
      let submissionDispatched = false;
      try {
        if(args.groupId){const binding=await invoke('cluster-lab-groups:binding',event,{groupId:args.groupId,expectedRevision:args.expectedGroupRevision});args={...args,devices:binding.devices};}
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
        // Native Agent conversations own their preview pane. CLI platform calls have no
        // conversation, so retain the workflow preview selected by case/explicit flags.
        let payload = { ...args, startConfigOverride:args.startOptions, caseIds, stress, taskId: `agent-${operationId}`, source: 'agent', cases, components: s.components || [], caseEdges: s.caseEdges || {}, llmProviders: s.llmProviders || [], selectedLlmProviderId: s.selectedLlmProviderId, disableScreenMirror: !platformOnly };
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
    // Receipt canonicalization must not mutate caller-owned (possibly frozen)
    // arguments or change the requested execution order.
    tools.at(-1).operationReceipt = {kind:'task-submission', acknowledged:r=>typeof r.taskId==='string', key:args=>{const normalized={...args,caseIds:[...require('./case-selection').resolveCaseSelection(readState(),args,selectionDomain())].sort()};for(const k of ['taskName','editScope','selectionId','libraryId','folderId','expectedCaseCount','expectedSelectionRevision','excludeFolderIds','excludeCaseIds'])delete normalized[k];return normalized;},revision:args=>require('./task-execution-state').definitionRevision(readState(),args,selectionDomain()),lookupId:id=>`agent-${id}`};
    tools.at(-1).schema.dependencies={groupId:['expectedGroupRevision'],expectedGroupRevision:['groupId']};
    tools.at(-1).taskCaseIds = args => require('./case-selection').resolveCaseSelection(readState(),args,selectionDomain());
    tools.at(-1).taskDefinitionRevision = args => require('./task-execution-state').definitionRevision(readState(), args, selectionDomain());
    tools.at(-1).schema.oneOf=[{required:['selectionId'],not:{anyOf:['caseIds','libraryId','folderId','query','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['caseIds'],not:{anyOf:['selectionId','libraryId','folderId','excludeFolderIds','excludeCaseIds'].map(k=>({required:[k]}))}},{required:['libraryId','expectedCaseCount'],not:{anyOf:[{required:['caseIds']},{required:['selectionId']}]}}];
    add('start_performance', '仅用户单独要求时独立采当前应用性能，不跑用例。随回归采集用submit_task.performanceOptions，不另开等待任务、不能补过去数据。与测试按真实SN互斥（含收尾），不同SN可并行。CPU/内存/线程/电池温度，返回taskId，不等于耗电报告。', object({ serial: str, packageName: str, role: { enum: ['phone','glasses'] }, durationSeconds: { type: 'integer', minimum: 5, maximum: 3600 }, intervalSeconds: { type: 'integer', minimum: 1, maximum: 60 } }, ['serial','packageName','role','durationSeconds']), async (args, { operationId }) => {
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
    add('list_tasks', '按taskId/query分页查任务摘要；详情用read_task_report。', object({ taskId: str, query: str, statuses: {type:'array',items:{type:'string'},minItems:1,uniqueItems:true}, includeDevices: {type:'boolean'}, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }), async args => {
      if (args.taskId) {
        const r = await invoke('workflow-report:load-task', event, { taskId: args.taskId });
        return r.success ? { success: true, task: redact(taskOverview(r.task)) } : r;
      }
      const result = await invoke('workflow-task:list', event, {});
      if (result.success === false || result.error) return redact(result);
      const tasks = (result.tasks || []).filter(t => (!args.taskId || t.id === args.taskId) && (!args.query || String(t.name || '').includes(args.query)) && (!args.statuses || args.statuses.includes(t.status)));
      const offset = args.offset || 0, end = offset + (args.limit || 20);
      return redact({ success: true, total: tasks.length, nextOffset: end < tasks.length ? end : null,
        tasks: tasks.slice(offset, end).map(t => ({ id: t.id, name: t.name, status: t.status, error: t.error, summary: t.summary, updatedAt: t.updatedAt, ...(args.includeDevices ? {devices:t.devices||{},completed:t.completed,total:t.total,currentCaseId:t.currentCaseId,currentStepName:t.currentStepName} : {}) })) });
    });
    add('read_task_result', '按taskId读取状态/计数/通过率/设备/报告路径。终态先交付回执再分析；success仅查询成功，业务看status/counts；失败清单nextOffset分页，未知不猜成功、不重复提交。', object({taskId:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:20}},['taskId']), async args => {
      const r = await invoke('workflow-report:load-task', event, { taskId: args.taskId });
      return r.success ? redact(require('../task-case-query').taskResultReceipt(r.task,args)) : r;
    }, false, false, { readOnly: true });
    add('read_task_report', 'taskId查询，cases索引每页最多200条/64KB（其他view最多50条），按statuses筛选、nextOffset翻页，selectionComplete才完整。caseOrdinal原始序号。summary附件/性能、steps批量步骤、details失败摘要。refresh重读，success仅查询成功。', object({ taskId: taskIdSchema,refresh:{type:'boolean'},caseIds:{type:'array',items:str,minItems:1,uniqueItems:true},statuses:{type:'array',items:{enum:require('../task-case-query').CASE_STATUSES},minItems:1,uniqueItems:true},view:{enum:['cases','summary','details','steps'],default:'cases'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200} }, ['taskId']), async args => {
      const r = await invoke('workflow-report:load-task', event, args);
      return r.success ? { success: true, successScope:'query', executionReceipt: redact(require('../task-case-query').taskResultReceipt(r.task,{limit:1})), task: redact(taskOverview(r.task,{...args,view:args.view || 'cases'})) } : r;
    }, false, false, { readOnly: true });
    tools.at(-1).operationObservation=(args,result)=>result.executionReceipt?.taskId===args.taskId?{id:args.taskId,receipt:{executionReceipt:result.executionReceipt}}:undefined;
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
    add('read_case_results', 'taskId+caseId或原始caseOrdinal定位，二者须一致。identity给本例文件路径。view选摘要/时序/配置/输出/产物；configuration及includeSnapshot默认省略编辑用sampleLog/sampleExtractText/samplePayload，以运行时正则/条件和真实证据判断；诊断投影不可当完整文档保存。details保留判断/计时/当前JSON；detailMode=full显式读取完整配置、输出和模型输入。stepId选节点，nextOffset翻页，success仅查询成功。', object({ taskId: taskIdSchema, caseId: str, caseOrdinal:{type:'integer',minimum:1}, view:{enum:['summary','details','configuration','artifacts','timeline'],default:'summary'}, detailMode:{enum:['compact','full'],default:'compact'}, artifactKind:str,artifactIndex:{type:'integer',minimum:0},includeMediaPreviews:{type:'boolean'}, stepId:str, includeSnapshot:{type:'boolean'}, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['taskId']), async (args,{signal}={}) => {
      const r = await invoke('workflow-report:load-task', event, args);
      if (!r.success) return r;
      const {caseRecord:c,identity}=require('./report-case-identity').resolveReportCase(r.task,args);
      const logFiles=await require('./case-log-files').caseLogFiles(r.task,c,{root:path.join(commandDirectory?.() || require('node:os').tmpdir(),'case-log-files'),signal});
      identity.logs=logFiles;
      const evidenceCase={...c,artifacts:{...c.artifacts,logs:logFiles}};
      identity.fileAccess='这些日志路径仅包含本case内容；直接用文件工具或rg/jq/Python读取，不需要专用检索接口或手工切片。';
      const respond=value=>redact({...value,identity});
      const offset = args.offset || 0, end = offset + (args.limit || 5);
      const results=args.stepId?(c.results || []).filter(result=>result.stepId===args.stepId):(c.results || []);
      if(args.stepId && !results.length && args.view!=='configuration')throw Error('报告步骤不存在，请使用该用例报告中的stepId，不猜测ID');
      const {caseSnapshot}=c;
      const projection=require('./case-evidence-summary');
      const view=args.view || (args.includeSnapshot?'details':'summary');
      if(view==='timeline')return respond(projection.caseTimeline(evidenceCase,args));
      if(view==='summary')return respond(projection.caseEvidenceSummary(evidenceCase,args));
      if(view==='configuration')return respond(projection.caseConfiguration(evidenceCase,args));
      if(view==='artifacts'){const page=projection.caseArtifacts(evidenceCase,args);return respond({...page,...(args.includeMediaPreviews?{mediaPreviews:await require('./case-preview-bundle').casePreviewBundle(r.task,args,page.artifacts||[])}:{})});}
      return respond({ ...projection.caseEvidenceSummary(evidenceCase,args), ...(args.includeSnapshot?{caseSnapshot:args.detailMode==='full'?caseSnapshot:projection.diagnosticConfiguration(caseSnapshot)}:{}), success: true, successScope:'query', results: results.slice(offset, end).map(result=>projection.stepDetails(result,{taskId:args.taskId,caseId:identity.caseId,detailMode:args.detailMode})), total: results.length, nextOffset: end < results.length ? end : null });
    });
    tools.at(-1).schema.anyOf=[{required:['caseId']},{required:['caseOrdinal']}];
    add('read_case_artifact', '按原任务/用例报告中的附件引用分块读取已有录屏或截图；不启动录制、不接收文件路径。version固定同一文件；preview=true返回单帧，previewAtMs选择录屏相对毫秒（默认首帧），单帧不能代表全段或证明事件先后。失败录屏和未切片任务录像明确拒绝。', object({taskId:str,caseId:str,artifactKind:{enum:['recordings','screenshots']},artifactIndex:{type:'integer',minimum:0},preview:{type:'boolean'},previewAtMs:{type:'integer',minimum:0,maximum:3600000},playback:{type:'boolean'},offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:524288},version:str},['taskId','caseId','artifactKind','artifactIndex']),async args=>{
      const r=await invoke('workflow-report:load-task',event,{taskId:args.taskId});
      return r.success?require('./case-artifact-read').readCaseArtifact(r.task,args):r;
    });
    add('export_support_bundle','导出脱敏运行诊断；可选taskId+caseIds复用用例日志导出，包含业务日志，录屏截图另行下载。返回15分钟有效下载句柄，不接受路径。',object({taskId:str,caseIds:{type:'array',items:str,minItems:1,maxItems:50,uniqueItems:true}},[]),async(args,{signal}={})=>{
      if(Boolean(args.taskId)!==Boolean(args.caseIds))throw Error('taskId与caseIds须同时提供');
      const r=args.taskId?await invoke('workflow-report:load-task',event,{taskId:args.taskId}):null;
      if(r?.success===false)return r;
      return require('./support-export').createSupportExport(commandDirectory?.()||require('node:os').tmpdir(),args,r?.task,signal);
    });
    add('read_support_export','分块下载已有诊断导出；仅接受句柄和版本，不接受文件路径。',object({exportId:str,version:str,offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:262144}},['exportId','version']),args=>require('./support-export').readSupportExport(args));
    add('export_case_evidence', '按报告边界导出本例日志gzip与录屏来源manifestPath/reportPath，缺失明示，不上传。',object({taskId:str,caseIds:{type:'array',items:str,minItems:1,maxItems:50,uniqueItems:true},deviceTypes:{type:'array',items:{enum:['phone','glasses']},minItems:1,uniqueItems:true}},['taskId','caseIds']),async(args,{signal})=>{
      const r=await invoke('workflow-report:load-task',event,{taskId:args.taskId});
      return r.success?require('./case-evidence-export').exportCaseEvidence(r.task,args,{root:path.join(commandDirectory?.() || require('node:os').tmpdir(),'evidence-exports'),signal}):r;
    });
    add('search_task_logs', '批量检索已知任务的本例日志。taskId与queries数组必填，query放在queries每项内且为字面包含；countOnly看totalMatches。例：{"taskId":"实际任务ID","caseId":"实际用例ID","deviceType":"glasses","queries":[{"id":"a","query":"关键词甲","countOnly":true},{"id":"b","query":"关键词乙","limit":20}]}。优先read_case_results返回的identity.logs，用同一宿主文件工具批量处理；Client路径不在Server工作区。保留完整原始日志，预览无匹配不等于文件无证据。',object({taskId:taskIdSchema,caseId:str,deviceType:{enum:['phone','glasses']},fileIndex:{type:'integer',minimum:0},queries:{type:'array',minItems:1,maxItems:12,items:object({id:{type:'string',minLength:1,maxLength:100},query:{type:'string',maxLength:500},timeText:{type:'string',maxLength:50},startTime:{type:'string',pattern:'^\\d{2}:\\d{2}:\\d{2}$'},endTime:{type:'string',pattern:'^\\d{2}:\\d{2}:\\d{2}$'},fromLine:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:80},countOnly:{type:'boolean'}},['query'])}},['taskId','queries']),async(args,{signal})=>{const r=await invoke('workflow-report:load-task',event,args);return r.success?require('./log-search-batch').searchTaskLogs(r.task,args,signal):r;});
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
    add('reply_automation', '读取或控制消息自动回复的受控测试；与桌面设置共用实现。先保存设备/模型设置，prepare-fixture后核对返回的启动范围，再用确认token启动。', object({action:{enum:['status','history','stop','recover','prepare-fixture','start-fixture','cancel-fixture-confirmation','simulate-arrival','simulate-image','review-pending']},token:str,id:str},['action']), args => invoke(`reply-task:${args.action}`,event,['start-fixture','cancel-fixture-confirmation'].includes(args.action)?args.token:{id:args.id}), true);
    add('reply_settings', '读取或保存受控消息回复设置。保存必须传完整设置；模型ID引用现有配置，不能传凭证。', object({action:{enum:['load','save']},settings:object({device:str,contacts:{type:'array',items:str},textModel:str,visionModel:str,role:str,contextCount:{type:'integer',minimum:0,maximum:20}},['device','contacts','textModel','visionModel','role','contextCount'])},['action']), args=>invoke(`reply-settings:${args.action}`,event,args.settings), true);
    add('reply_knowledge', '读取、保存或删除本机消息回复知识。保存是纯文字；导入文件使用桌面设置页。', object({action:{enum:['list','get','save','remove']},id:str,name:str,text:str},['action']), args=>invoke(`reply-knowledge:${args.action}`,event,['get','remove'].includes(args.action)?args.id:{id:args.id,name:args.name,text:args.text}), true);
    add('discover_device_control', '查询三端设备控制可用设备；与桌面三端设备控制页共用执行器。', object(), ipc('harness:discover'));
    add('device_control', '三端设备录制、观察、操作、固定回放及停止。先连接，使用最新观察ID与候选；未知结果不能重发。replay返回同一任务ID并出现在任务列表；完整证据保存在本机。', object({operation:{enum:['apps','connect','command','disconnect','replay','stop']},payload:anyObject},['operation']), async args => {
      const result=await invoke(`harness:${args.operation}`,event,args.payload||{});
      const data=result?.data;if(!data)return redact(result);
      const {screenshotDataUrl,...rest}=data;
      return redact({...result,data:{...rest,...(screenshotDataUrl?{screenshotAvailable:true}:{})}});
    }, true);
    add('read_device_settings', '设置中心设备管理：读取手机/眼镜默认包名及固定SN；默认包名与单个用例包名不同。', object(), () => ({deviceBindings: readState().deviceBindings || {}}));
    add('save_device_settings', '差量保存设置中心设备管理并同步顶部设备区。默认包名须完整包名；简称先用list_packages查询实际设备，多个匹配需用户选择。SN数组为完整替换。', object({phoneDefaultPackage:str,glassesDefaultPackage:str,phoneSerials:{type:'array',items:str},glassesSerials:{type:'array',items:str}}), async args => ({...await saveConfiguration({deviceBindings:args}), deviceBindings:readState().deviceBindings}), true);
    add('describe_capabilities', 'solopi-desktop内部功能导航：不确定设置在哪或该调用哪个工具时查询，不读取历史任务。', object(), () => ({sections: [
      {name:'三端设备控制与固定回放',read:'discover_device_control',write:'device_control'},
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
    // External orchestration only: never expose self-control to the model loop.
    if(platformOnly)add('agent_session_control','查询、续接或停止本机已有助手会话；send在运行中进入队列，立即引导使用steer-queued及已有messageId，不重新发送文本；不重发已提交设备任务。',object({action:{enum:require('./session-control-actions')},id:str,messageId:str,text:{type:'string',minLength:1,maxLength:30000}},['action','id']),async args=>{
      if(args.action==='send'&&!args.text?.trim())throw Error('send requires text');
      if(args.action==='steer-queued'&&!args.messageId?.trim())throw Error('steer-queued requires messageId');
      const result=await invoke('agent:'+args.action,event,{id:args.id,...(args.action==='send'?{text:args.text}:args.action==='steer-queued'?{messageId:args.messageId}:{})});
      if(!result.session)return result;
      const s=result.session;return{success:true,session:{id:s.id,status:s.status,error:s.error,updatedAt:s.updatedAt,messageCount:s.messages?.length,callCount:s.calls?.length,messages:s.messages?.slice(-5)}};
    },true);
    add('agent_runtime_config', '读取本机运行时/模型或保存Agent模型后端；与Desktop设置中心使用同一实现。保存仅影响新一轮对话，连接测试会调用所选模型。', object({action:{enum:['get','discover','models','test','save']},refresh:{type:'boolean'},runtimeId:str,model:str,selection:object({mode:{enum:['api','local-runtime']},runtimeId:str,model:str},['mode'])},['action']), ipc('agent:runtime-config'), true);
    add('read_configuration', '查询模型列表、当前模型、组件和扩展配置，不返回密钥。模型密钥在设置中心安全表单填写。', object(), () => {
      const s = readState(); return redact({ models: s.llmProviders || [], selectedModelId: s.selectedLlmProviderId, components: s.components || [], extensions: config() });
    });
    add('save_configuration', '保存模型非密钥参数、选择模型或新建/修改通用组件。component必须按现有组件格式包含id/name/kind/device/commandTemplate/params/timeoutSeconds，先读取现有定义。', object({ model: object({ id: str, name: str, model: str, baseUrl: str }, ['id','name','model','baseUrl']), selectedModelId: str, action: { enum: ['create','update'] }, component: anyObject }), async args => redact(await saveConfiguration(args)), true);
    add('save_extensions', '保存MCP/Skill配置。先读再合并；凭据仅引用环境变量，不接受密钥。', object({ mcpServers: { type: 'array', items: anyObject, maxItems: 20 }, skillRoots: { type: 'array', items: str, maxItems: 20 } }, ['mcpServers','skillRoots']), args => saveExtensions(args), true);
    add('cancel_battery_import', '取消指定后台耗电导入及所属进程', object({ id: str }, ['id']), ipc('bugreport:cancel'), true);
    const catalog = () => { const c = skillCatalog(skillsRoots(), config()); return { ...c, skills: c.skills.filter(s => s.enabled) }; };
    add('list_skills', '列出 Agent Skills 元数据和依赖说明，按需加载正文', object(), () => ({ skills: catalog().skills.map(({ directory, ...meta }) => meta), diagnostics: catalog().diagnostics }));
    add('read_skill', '完整读取Skill入口。参数示例：{"name":"<Skill名称>"}。本工具只接受name和可选refresh；参考文件用read_skill_reference({"name":"<Skill名称>","file":"references/<文件名>.md"})。directory/absolutePath为真实路径。', object({name:str,refresh:{type:'boolean'}},['name']), ({name})=>readSkill(catalog().skills,name));
    add('read_skill_reference', '读取Skill参考文件，参数示例：{"name":"<Skill名称>","file":"references/<文件名>.md"}。入口用read_skill({"name":"<Skill名称>"})。小文件全文，大文件目录，query定位、section读完整章节、offset翻目录；complete/sectionComplete标明覆盖。执行脚本用返回absolutePath。', object({name:str,file:{...str,not:{enum:['SKILL.md','./SKILL.md']}},section:str,query:str,refresh:{type:'boolean'},offset:{type:'integer',minimum:0}},['name','file']), ({name,file,...options})=>readSkillReference(catalog().skills,name,file,options));
    for(const tool of tools.filter(t=>['read_skill','read_skill_reference'].includes(t.name)))tool.reference = args => {
      const {file}=require('./skills').resolveSkillFile(catalog().skills,args.name,args.file);
      return {skillName:args.name,skillFile:args.file || 'SKILL.md',key:require('./reference-memory').digest(['skill-read-contract-v2',args.name,args.file || 'SKILL.md',args.section || '',args.query || '',args.offset || 0]),version:require('./reference-memory').fileVersion(file),label:`Skill ${args.name}/${args.file || 'SKILL.md'}${args.section ? ' '+args.section : ''}`};
    };
    if (platformOnly) return tools.filter(tool => require('../platform-tool-api').isPlatformTool(tool.name));
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
