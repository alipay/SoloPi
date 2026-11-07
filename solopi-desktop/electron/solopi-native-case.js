const {randomUUID}=require('node:crypto');
const {ACTION_CODES,NODE_ACTIONS,REQUIRED_PARAMS,INPUT_ACTIONS,nativeCaseIssues,applyNativeInputs,decode}=require('./solopi-native-schema');
const ALLOWED=new Set(Object.values(ACTION_CODES));
const FAST_ACTIONS=new Set(['CLICK','BACK','HOME','SLEEP','SCROLL_TO_TOP','SCROLL_TO_BOTTOM','SCROLL_TO_LEFT','SCROLL_TO_RIGHT']);
function buildNativeCase(source,{redactInputs=false}={}){
 const rawLog=decode(source.operationLog,'operationLog'),settings=decode(source.advanceSettings||'{}','advanceSettings');
 const doc={caseName:source.caseName.trim(),targetAppPackage:source.targetAppPackage.trim(),targetAppLabel:source.targetAppLabel||source.targetAppPackage,caseDesc:source.caseDesc||'',priority:Number.isInteger(source.priority)?source.priority:2,recordMode:'local',advanceSettings:JSON.stringify(settings),operationLog:{steps:[]}};
 for(const [index,raw]of rawLog.steps.entries()){
  const s=JSON.parse(JSON.stringify(raw));const method=s.operationMethod||{};
  method.actionEnum=ACTION_CODES[method.actionEnum]||method.actionEnum;
  method.operationParam={...(method.operationParam||{})};
  if(redactInputs&&INPUT_ACTIONS.has(method.actionEnum)){
   // Never embed recorded credentials into a new workflow, even in node text.
   const secret=method.operationParam.text;
   if(typeof secret==='string'&&secret&&s.operationNode){const scrub=v=>typeof v==='string'?v.split(secret).join(''):Array.isArray(v)?v.map(scrub):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,scrub(x)])):v;s.operationNode=scrub(s.operationNode);}
   method.operationParam.text='';
   if(s.operationNode){s.operationNode.text='';s.operationNode.description='';delete s.operationNode.extra;}
  }
  s.operationMethod=method;s.operationIndex=index;s.operationId=s.operationId||randomUUID();s.stepId=s.stepId||randomUUID();
  doc.operationLog.steps.push(s);
 }

 return doc;
}
function needsNativeCase(source){
 const log=decode(source.operationLog,'operationLog');
 if(log.steps.some(s=>s.operationMethod?.encrypt===true||s.operationMethod?.safeEncrypt===true))return false;
 const actions=log.steps.map(s=>ACTION_CODES[s.operationMethod?.actionEnum]||s.operationMethod?.actionEnum);
 return actions.every(a=>ALLOWED.has(a))&&((actions.some(a=>!FAST_ACTIONS.has(a))||log.steps.some(s=>Object.values(s.operationMethod?.operationParam||{}).some(v=>typeof v==='string'&&v.includes('${'))))||Object.keys(decode(source.advanceSettings||'{}','advanceSettings')||{}).length>0);
}
function convertNativeCase(source,options={}){
 const document=buildNativeCase(source,{redactInputs:true});
 const issues=nativeCaseIssues(document),id=`case-solopi-${randomUUID()}`,componentId=`${id}-native`;
 const params=[{key:'action',label:'操作类型',inputType:'text',defaultValue:'solopi_replay'},{key:'nativeCase',label:'完整动作与参数（JSON）',inputType:'json',templateMode:'literal',defaultValue:'{}'},{key:'restartApp',label:'回放前重新启动应用',inputType:'text',defaultValue:'true'},{key:'runTimeoutMs',label:'回放时限(ms)',inputType:'number',defaultValue:'600000'}];
 document.operationLog.steps.forEach((s,index)=>{if(INPUT_ACTIONS.has(s.operationMethod.actionEnum))params.push({key:`inputText_${index}`,label:`第 ${index+1} 步输入内容`,inputType:'textarea',templateMode:'literal',defaultValue:''});});
 const step={id:`${id}-native-replay`,name:`SoloPi 原生回放 · ${document.operationLog.steps.length} 步`,type:'component',device:'phone',componentId,inputs:{action:'solopi_replay',nativeCase:JSON.stringify(document,null,2),restartApp:options.replayStart==='current-page'?'false':'true',runTimeoutMs:'600000'},config:{solopiNative:true}};
 if(issues.length)step.config.importReview={required:true,reason:issues.map(i=>i.reason).join('；')};
 const testCase={schemaVersion:'glassbox.workflow.v1',id,name:source.caseName.trim(),folderId:options.folderId,description:'通过手机 SoloPi 官方引擎回放完整操作序列；保留变量、断言、手势和应用操作语义。',reviewStatus:'draft',tags:['solopi-import','draft'],defaults:{phonePackage:source.targetAppPackage,...(options.phoneSerial?{phoneSerial:options.phoneSerial}:{})},components:[{id:componentId,name:'SoloPi 原生操作序列',kind:'mobile_ui_action',device:'phone',commandTemplate:'',timeoutSeconds:600,params}],steps:[{id:`${id}-start`,name:'开始',type:'start',device:'phone',config:{keepScreenAwake:false}},step,{id:`${id}-end`,name:'结束',type:'end',device:'phone',config:{}}]};
 return{testCase,issues:issues.map(i=>({...i,stepId:step.id,reason:i.reason})),operationCount:document.operationLog.steps.length,runnable:issues.length===0,addsBusinessAssertions:false,executionEngine:'solopi-native'};
}
module.exports={ACTION_CODES,NODE_ACTIONS,REQUIRED_PARAMS,INPUT_ACTIONS,nativeCaseIssues,applyNativeInputs,buildNativeCase,needsNativeCase,convertNativeCase};
