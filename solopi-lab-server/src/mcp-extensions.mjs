// Server configuration adapter; protocol, discovery and tool execution are Desktop-owned.
import{readFileSync}from'node:fs';import{join}from'node:path';
import mcp from'./desktop-agent/mcp.js';
export const externalMcpError=mcp.externalMcpError;
export async function loadMcpExtensions({directory,conversationId,messageId,onStatus=()=>{}}){
 let config;try{config=JSON.parse(readFileSync(join(directory,'mcp-servers.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return{tools:[],disabledTools:[],instructions:'',close:async()=>{}};throw Object.assign(Error('Invalid host MCP configuration'),{code:'MCP_CONFIG_INVALID'});}
 const connections=new mcp.McpConnections({onStatus});
 try{const tools=[];for(const[id,c]of Object.entries(config.mcpServers||{})){
  if(c.enabled===false){connections.status(id,{status:'disabled'});continue;}
  if(!/^[a-zA-Z0-9_-]{1,30}$/.test(id)||Boolean(c.command)===Boolean(c.url))throw Error('Invalid MCP transport');
  tools.push(...await connections.connect({...c,id},undefined,{conversationId,messageId}));if(tools.length>200)throw Error('MCP tool limit exceeded');
 }
 return{tools,disabledTools:config.disabledTools||[],instructions:typeof config.instructions==='string'?config.instructions:'',close:()=>connections.closeAll()};
 }catch(error){await connections.closeAll();throw Object.assign(Error('Host MCP unavailable; no fallback execution was attempted'),{code:'MCP_UNAVAILABLE',cause:error});}
}
