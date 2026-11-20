const { createHash } = require('node:crypto');
// SDK owns protocol negotiation, pagination and transports; renderer never owns server processes.
class McpConnections {
  constructor({onStatus=()=>{}}={}) { this.clients = new Set(); this.statuses = new Map();this.onStatus=onStatus; }
  status(id,value){this.statuses.set(id,value);this.onStatus(Object.fromEntries(this.statuses));}
  async connect(config, signal, context={}) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    this.status(config.id, { status: 'connecting' });
    const client = new Client({ name: 'solopi-desktop-agent', version: '0.1.0' });
    const transport = config.command
      ? new StdioClientTransport({ command: config.command, args: config.args || [], env: {...Object.fromEntries((config.envKeys || []).filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])),...(context.conversationId?{SOLOPI_CONVERSATION_ID:context.conversationId}:{}),...(context.messageId?{SOLOPI_MESSAGE_ID:context.messageId}:{})}, stderr: 'ignore' })
      : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.bearerTokenEnv && process.env[config.bearerTokenEnv] ? { Authorization: `Bearer ${process.env[config.bearerTokenEnv]}` } : {} } });
    this.clients.add(client);
    const close = () => { this.status(config.id, { status: 'unconnected' }); this.clients.delete(client); void client.close().catch(() => {}); };
    signal?.addEventListener('abort', close, { once: true });
    try {
      signal?.throwIfAborted();
      await client.connect(transport, { timeout: 15000 });
      signal?.throwIfAborted();
      const tools = []; let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15000 });
        for(const tool of page.tools)if(!config.allowedTools||config.allowedTools.includes(tool.name))tools.push(tool);
        if(page.nextCursor&&page.nextCursor===cursor)throw Error('MCP cursor did not advance');cursor = page.nextCursor;
        if (tools.length > 200) throw Error('MCP 工具超过 200 项');
      } while (cursor);
      this.status(config.id, { status: 'connected', toolCount: tools.length });
      return tools.map(t => ({ name: `mcp_${config.id}_${createHash('sha256').update(t.name).digest('hex').slice(0,16)}`, description: `${config.id}/${t.name}: ${t.description || ''}`, schema: t.inputSchema, readOnly:t.annotations?.readOnlyHint===true,confirm:t.annotations?.readOnlyHint!==true,execute:async(args,{signal:callSignal}={})=>{const result=await client.callTool({name:t.name,arguments:args},undefined,{signal:callSignal,timeout:60000});if(result.isError)throw externalMcpError(result);return result;} }));
    } catch (error) { signal?.removeEventListener('abort', close); this.status(config.id, { status: 'error', error: 'MCP连接或工具发现失败' }); await client.close().catch(() => {}); this.clients.delete(client); throw error; }
  }
  async closeAll() { await Promise.allSettled([...this.clients].map(c => c.close())); this.clients.clear();for(const[id,row]of this.statuses)if(row.status==='connected')this.status(id,{...row,status:'closed'}); }
}
function externalMcpError(result){
 let detail;for(const block of result.content||[]){if(block.type!=='text')continue;try{const value=JSON.parse(block.text);if(value?.error&&typeof value.error==='object'){detail=value.error;break;}}catch{}}
 const safe=v=>String(v||'').replace(/Bearer\s+[^\s]+|sk-[A-Za-z0-9_-]{10,}|(token|password|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi,'[REDACTED]').slice(0,1200);
 return Object.assign(Error(detail?.message?safe(detail.message):'External MCP tool failed'),{code:typeof detail?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(detail.code)?detail.code:'MCP_TOOL_FAILED',...(detail?.submissionState==='not_submitted'?{submissionState:'not_submitted',submissionOutcome:'not-submitted'}:{})});
}
module.exports = { McpConnections,externalMcpError };
