export type PageKey='superagent'|'overview'|'workspace'|'clients'|'levels'|'grouptasks'|'agentchat'|'tasks'|'runtime'|'records'|'guide'|'devices'|'memory'|'case-quality';
export const pageTitles:Record<PageKey,string>={overview:'实验室总览',devices:'设备管理',workspace:'设备管理',clients:'设备管理',levels:'设备管理',grouptasks:'测试任务',tasks:'测试任务',superagent:'Superagent',agentchat:'Agent 会话',memory:'上下文记忆','case-quality':'用例质量',runtime:'运行时与模型',records:'接入与安装包',guide:'接入与安装包'};
const aliases:Record<string,PageKey>={'agents':'superagent','agents/superagent':'superagent','agents/chat':'agentchat','agents/memory':'memory','agents/quality':'case-quality','settings':'guide','settings/records':'guide','records':'guide','settings/runtime':'runtime','settings/guide':'guide','devices/groups':'devices','devices/screens':'devices',workspace:'devices',clients:'devices',levels:'devices',grouptasks:'tasks'};
export function pageForHash(hash:string):PageKey{
 const path=hash.replace(/^#\//,'').split('?')[0];
 if(path==='native-report'||path.startsWith('request/')||path.startsWith('execution/')||path==='group-task')return 'tasks';
 if(path.startsWith('task/')||path.startsWith('agent-request/'))return 'agentchat';
 if(aliases[path])return aliases[path];
 return Object.prototype.hasOwnProperty.call(pageTitles,path)?path as PageKey:'overview';
}
export const agentPages=new Set<PageKey>(['superagent','agentchat','memory','case-quality']);
export const managementPages=new Set<PageKey>(['runtime','guide']);
export const pageHref=(page:PageKey)=>({superagent:'#/agents',agentchat:'#/agents/chat',memory:'#/agents/memory','case-quality':'#/agents/quality',runtime:'#/settings/runtime',records:'#/settings/guide',guide:'#/settings/guide',devices:'#/devices/groups',workspace:'#/devices/groups',clients:'#/devices/groups',levels:'#/devices/groups',grouptasks:'#/tasks'} as Partial<Record<PageKey,string>>)[page]||'#/'+page;
