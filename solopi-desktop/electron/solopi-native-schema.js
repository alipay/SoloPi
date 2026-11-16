// Official SoloPi v1.0.2 / 3b8c146ab80b0325aece65b8ef417136c251869c.
const ACTION_CODES = Object.freeze({
  "click": "CLICK",
  "longClick": "LONG_CLICK",
  "input": "INPUT",
  "multiClick": "MULTI_CLICK",
  "clickIfExists": "CLICK_IF_EXISTS",
  "clickQuick": "CLICK_QUICK",
  "clickAndInput": "CLICK_AND_INPUT",
  "inputSearch": "INPUT_SEARCH",
  "scrollToBottom": "SCROLL_TO_BOTTOM",
  "scrollToTop": "SCROLL_TO_TOP",
  "scrollToRight": "SCROLL_TO_RIGHT",
  "scrollToLeft": "SCROLL_TO_LEFT",
  "gesture": "GESTURE",
  "assert": "ASSERT",
  "sleepUntil": "SLEEP_UNTIL",
  "back": "BACK",
  "reload": "RELOAD",
  "handleAlert": "HANDLE_ALERT",
  "jumpToPage": "JUMP_TO_PAGE",
  "changeMode": "CHANGE_MODE",
  "generateQrCode": "GENERATE_QR_CODE",
  "generateBarCode": "GENERATE_BAR_CODE",
  "globalScrollToBottom": "GLOBAL_SCROLL_TO_BOTTOM",
  "globalScrollToTop": "GLOBAL_SCROLL_TO_TOP",
  "globalScrollToRight": "GLOBAL_SCROLL_TO_RIGHT",
  "globalScrollToLeft": "GLOBAL_SCROLL_TO_LEFT",
  "keyboardInput": "KEYBOARD_INPUT",
  "inputGlobal": "INPUT_GLOBAL",
  "globalPinchOut": "GLOBAL_PINCH_OUT",
  "globalPinchIn": "GLOBAL_PINCH_IN",
  "globalGesture": "GLOBAL_GESTURE",
  "goToIndex": "GOTO_INDEX",
  "clearData": "CLEAR_DATA",
  "assertToast": "ASSERT_TOAST",
  "killProcess": "KILL_PROCESS",
  "sleep": "SLEEP",
  "screenshot": "SCREENSHOT",
  "home": "HOME",
  "notification": "NOTIFICATION",
  "recentTask": "RECENT_TASK",
  "deviceInfo": "DEVICE_INFO",
  "executeShell": "EXECUTE_SHELL",
  "letNode": "LET_NODE",
  "let": "LET",
  "load": "LOAD_PARAM",
  "checkNode": "CHECK_NODE",
  "check": "CHECK"
});
const NODE_ACTIONS = new Set(["ASSERT", "CHECK_NODE", "CLICK", "CLICK_AND_INPUT", "CLICK_IF_EXISTS", "CLICK_QUICK", "GESTURE", "INPUT", "INPUT_SEARCH", "LET_NODE", "LONG_CLICK", "MULTI_CLICK", "SCROLL_TO_BOTTOM", "SCROLL_TO_LEFT", "SCROLL_TO_RIGHT", "SCROLL_TO_TOP", "SLEEP_UNTIL"]);
const REQUIRED_PARAMS = {
  "INPUT": [
    "text"
  ],
  "CLICK_AND_INPUT": [
    "text"
  ],
  "INPUT_SEARCH": [
    "text"
  ],
  "LONG_CLICK": [
    "text"
  ],
  "MULTI_CLICK": [
    "text"
  ],
  "SLEEP_UNTIL": [
    "text"
  ],
  "SCROLL_TO_BOTTOM": [
    "text"
  ],
  "SCROLL_TO_TOP": [
    "text"
  ],
  "SCROLL_TO_RIGHT": [
    "text"
  ],
  "SCROLL_TO_LEFT": [
    "text"
  ],
  "SLEEP": [
    "text"
  ],
  "SCREENSHOT": [
    "text"
  ],
  "JUMP_TO_PAGE": [
    "scheme"
  ],
  "GENERATE_QR_CODE": [
    "scheme"
  ],
  "GENERATE_BAR_CODE": [
    "scheme"
  ],
  "KEYBOARD_INPUT": [
    "text"
  ],
  "INPUT_GLOBAL": [
    "text"
  ],
  "EXECUTE_SHELL": [
    "text"
  ],
  "ASSERT": [
    "assertInputContent",
    "assertMode"
  ],
  "ASSERT_TOAST": [
    "assertInputContent",
    "assertMode"
  ],
  "GESTURE": [
    "gestureFilter",
    "gesturePath"
  ],
  "GLOBAL_GESTURE": [
    "gestureFilter",
    "gesturePath"
  ],
  "LET_NODE": [
    "allocKey",
    "allocType",
    "allocValue"
  ],
  "LET": [
    "allocKey",
    "allocType",
    "allocValue"
  ],
  "LOAD_PARAM": [
    "appUrl"
  ],
  "CHANGE_MODE": [
    "descriptorMode"
  ],
  "CHECK_NODE": [
    "check"
  ],
  "CHECK": [
    "check"
  ]
};
const INPUT_ACTIONS=new Set(['INPUT','CLICK_AND_INPUT','INPUT_SEARCH','KEYBOARD_INPUT','INPUT_GLOBAL']);
const ALLOWED=new Set(Object.values(ACTION_CODES));
const decode=(value,label)=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{throw Error(`${label}不是有效 JSON`);}};
function nativeCaseIssues(document, inputs = {}){
 const issues=[];let doc,log;
 try{doc=applyNativeInputs(decode(document,'原生用例'),inputs);log=decode(doc?.operationLog,'operationLog');}catch(e){return[{index:-1,reason:e.message}];}
 if(!doc||!/^([A-Za-z][\w]*\.)+[A-Za-z][\w]*$/.test(doc.targetAppPackage||''))issues.push({index:-1,reason:'原生用例缺少有效目标包名'});
 if(!Array.isArray(log?.steps)||!log.steps.length||log.steps.length>2000)return [...issues,{index:-1,reason:'原生用例必须有 1–2000 个动作'}];
 const ids=new Set();
 log.steps.forEach((s,index)=>{
  const method=s?.operationMethod,action=method?.actionEnum,params=method?.operationParam;
  const fail=reason=>issues.push({index,action,reason});
  if(!ALLOWED.has(action)){fail('动作不在 47 类普通用例能力中');return;}
  if(!s.stepId||!s.operationId||ids.has(s.stepId))fail('原生步骤标识缺失或重复');ids.add(s.stepId);
  if(method.encrypt===true||method.safeEncrypt===true)fail('加密参数需先解密核对，不能直接执行');
  if(!params||typeof params!=='object'||Array.isArray(params)){fail('动作参数必须是对象');return;}
  for(const key of REQUIRED_PARAMS[action]||[])if(params[key]===undefined||params[key]===null||String(params[key]).trim()==='')fail(`请填写 ${action}.${key}`);
  if(Object.values(params).some(v=>!['string','number','boolean'].includes(typeof v)))fail('原生动作参数值必须是文本、数字或布尔值');
  if(NODE_ACTIONS.has(action)&&!['resourceId','text','description','xpath','id'].some(key=>typeof s.operationNode?.[key]==='string'&&s.operationNode[key].trim()))fail('元素动作缺少原生定位条件');
 });
 try{const settings=decode(doc.advanceSettings||'{}','advanceSettings');if(!settings||Array.isArray(settings)||typeof settings!=='object')issues.push({index:-1,reason:'高级设置必须是对象'});}catch(e){issues.push({index:-1,reason:e.message});}
 return issues;
}
function applyNativeInputs(document, inputs = {}) {
 const doc=JSON.parse(JSON.stringify(document));
 const log=decode(doc?.operationLog,'operationLog');
 if(Array.isArray(log?.steps))log.steps.forEach((s,index)=>{if(INPUT_ACTIONS.has(s.operationMethod?.actionEnum)&&inputs[`inputText_${index}`]!==undefined)s.operationMethod.operationParam={...s.operationMethod.operationParam,text:String(inputs[`inputText_${index}`])};});
 if(doc)doc.operationLog=log;
 return doc;
}
module.exports={ACTION_CODES,NODE_ACTIONS,REQUIRED_PARAMS,INPUT_ACTIONS,nativeCaseIssues,applyNativeInputs,decode};
