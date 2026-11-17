import {readFileSync,realpathSync} from 'node:fs';
import {join,dirname,sep} from 'node:path';
// Read metadata only. Never connect transports or return command/env/token values.
export function extensionInventory(directory,snapshot,catalog=[]){
 let config={},diagnostics=[];
 try{config=JSON.parse(readFileSync(join(directory,'mcp-servers.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')diagnostics=[{directory:'Server MCP configuration',error:'配置无法解析；未连接任何服务'}];}
 if(!config||typeof config!=='object'||Array.isArray(config)||config.mcpServers===null||Array.isArray(config.mcpServers)){config={};diagnostics.push({directory:'Server MCP configuration',error:'配置结构无效'});}
 const servers=Object.entries(config.mcpServers||{}).map(([id,c])=>{if(!c||typeof c!=='object'){diagnostics.push({directory:id,error:'服务配置无效'});return{id,enabled:false,status:'error',error:'服务配置无效'};}return{id,...(snapshot?.servers?.[id]||{}),enabled:c.enabled!==false,status:c.enabled===false?'disabled':snapshot?.servers?.[id]?.status||'unobserved'};});
 const skills=catalog.map(s=>({name:s.name,description:s.description,directory:s.directory,root:dirname(s.directory),enabled:s.enabled!==false})),roots=[...new Set(skills.map(s=>s.root))];
 return {source:'server-superagent',config:{mcpServers:servers.map(({id,enabled})=>({id,enabled})),skillRoots:roots},roots,skills,servers,diagnostics,note:(skills.length?'Server 已注册 '+skills.length+' 个原生文件 Skill；目录存在不代表当前会话已读取。':'Server 当前未注册原生文件 Skill 目录；Context 的 skills 知识不等于原生 Skill。')+'连接状态仅来自所选会话最近一次真实 MCP 生命周期。',observedAt:snapshot?.at||null,messageId:snapshot?.messageId||null,sessionEvidence:snapshot?'最近执行快照；不是当前消息 Skill 加载证明':'未提供会话加载证据'};
}

export function nativeSkillDetail(catalog,name){
 const skill=catalog.find(s=>s.name===name);if(!skill)throw Object.assign(Error('Skill 不在当前 Server 注册目录中'),{code:'SKILL_NOT_FOUND',status:404});
 const root=realpathSync(skill.directory),file=realpathSync(join(root,'SKILL.md'));if(!file.startsWith(root+sep))throw Object.assign(Error('Skill 原文路径不合法'),{code:'SKILL_PATH_DENIED',status:403});
 const content=readFileSync(file,'utf8');if(Buffer.byteLength(content)>500000||/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{16,}|\bsk-[A-Za-z0-9_-]{16,}/.test(content))throw Object.assign(Error('Skill 含敏感信息或超出读取范围'),{code:'SKILL_CONTENT_UNAVAILABLE',status:422});return{name:skill.name,content};
}
