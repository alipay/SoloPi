const { createHash } = require('node:crypto');
// SDK owns protocol negotiation, pagination and transports; renderer never owns server processes.
class McpConnections {
  constructor() { this.clients = new Set(); this.statuses = new Map(); }
  async connect(config, signal) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    this.statuses.set(config.id, { status: 'connecting' });
    const client = new Client({ name: 'solopi-desktop-agent', version: '0.1.0' });
    const transport = config.command
      ? new StdioClientTransport({ command: config.command, args: config.args || [], env: Object.fromEntries((config.envKeys || []).filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])), stderr: 'ignore' })
      : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.bearerTokenEnv && process.env[config.bearerTokenEnv] ? { Authorization: `Bearer ${process.env[config.bearerTokenEnv]}` } : {} } });
    this.clients.add(client);
    const close = () => { this.statuses.set(config.id, { status: 'unconnected' }); this.clients.delete(client); void client.close().catch(() => {}); };
    signal?.addEventListener('abort', close, { once: true });
    try {
      signal?.throwIfAborted();
      await client.connect(transport, { timeout: 15000 });
      signal?.throwIfAborted();
      const tools = []; let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15000 });
        tools.push(...page.tools); cursor = page.nextCursor;
        if (tools.length > 200) throw Error('MCP 工具超过 200 项');
      } while (cursor);
      this.statuses.set(config.id, { status: 'connected', toolCount: tools.length });
      return tools.map(t => ({ name: `mcp_${config.id}_${createHash('sha256').update(t.name).digest('hex').slice(0,16)}`, description: `${config.id}/${t.name}: ${t.description || ''}`, schema: t.inputSchema, confirm: true, execute: (args, { signal: callSignal }) => client.callTool({ name: t.name, arguments: args }, undefined, { signal: callSignal, timeout: 60000 }) }));
    } catch (error) { signal?.removeEventListener('abort', close); this.statuses.set(config.id, { status: 'error', error: error.message }); await client.close().catch(() => {}); this.clients.delete(client); throw error; }
  }
  async closeAll() { await Promise.allSettled([...this.clients].map(c => c.close())); this.clients.clear(); }
}
module.exports = { McpConnections };
