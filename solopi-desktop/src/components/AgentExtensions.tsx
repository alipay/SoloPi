import { useEffect, useState } from 'react';
import { Box, Server, Search, RefreshCw, Plus, ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import AgentMarkdown from './AgentMarkdown';
type ServerConfig = {
    id: string;
    enabled?: boolean;
    command?: string;
    args?: string[];
    url?: string;
    envKeys?: string[];
    bearerTokenEnv?: string;
};
type Config = {
    mcpServers: ServerConfig[];
    skillRoots: string[];
    disabledSkills?: string[];
};
type Skill = {
    name: string;
    description: string;
    directory: string;
    root: string;
    enabled: boolean;
    compatibility?: string;
};
type Inventory = {
    config: Config;
    roots: string[];
    skills: Skill[];
    diagnostics: {
        directory: string;
        error: string;
    }[];
    servers: (ServerConfig & {
        status: string;
        toolCount?: number;
        error?: string;
    })[];
};
const statusNames: Record<string, [string, string]> = { disabled: ['已停用', 'Disabled'], unconnected: ['尚未连接', 'Not connected'], connecting: ['连接中', 'Connecting'], connected: ['已连接', 'Connected'], tested: ['连接测试通过', 'Connection test passed'], error: ['连接失败', 'Connection failed'] };
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:border-blue-400 outline-none';
export default function AgentExtensions({ invoke, onClose, embedded = false }: {
    invoke: (channel: string, payload?: Record<string, unknown>) => Promise<any>;
    onClose?: () => void;
    embedded?: boolean;
}) {
    const { t } = useLanguage();
    const [data, setData] = useState<Inventory>();
    const [tab, setTab] = useState<'skills' | 'mcp'>('skills');
    const [query, setQuery] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [detail, setDetail] = useState<{
        skill: Skill;
        content: string;
    }>();
    const [form, setForm] = useState<'skill' | 'mcp'>();
    const [root, setRoot] = useState('');
    const [editing, setEditing] = useState<string>();
    const [server, setServer] = useState<ServerConfig>({ id: '', command: '', args: [], enabled: true });
    const [transport, setTransport] = useState('stdio');
    const [argumentsText, setArgumentsText] = useState('');
    const [testedTools, setTestedTools] = useState<{
        name: string;
        description: string;
    }[]>();
    const refresh = async () => setData(await invoke('agent:extension-inventory'));
    const perform = async (work: () => Promise<unknown>) => { setBusy(true); setError(''); try {
        await work();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : String(e));
    }
    finally {
        setBusy(false);
    } };
    useEffect(() => { void perform(refresh); }, [invoke]);
    const save = async (config: Config) => { await invoke('agent:save-extensions', { config }); await refresh(); };
    const toggle = (s: Skill) => void perform(() => save({ ...data!.config, disabledSkills: s.enabled ? [...new Set([...(data!.config.disabledSkills || []), s.name])] : (data!.config.disabledSkills || []).filter(n => n !== s.name) }));
    const matches = (...s: string[]) => s.join(' ').toLowerCase().includes(query.toLowerCase());
    const editServer = (s?: ServerConfig) => { setForm('mcp'); setEditing(s?.id); setTransport(s?.url ? 'http' : 'stdio'); setServer(s || { id: '', command: '', enabled: true }); setArgumentsText(s?.args?.join('\n') || ''); setError(''); setTestedTools(undefined); };
    const toggleButton = (enabled: boolean, label: string, action: () => void) => <button type="button" role="switch" aria-checked={enabled} aria-label={label} disabled={busy} onClick={action} className={`shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors disabled:opacity-50 ${enabled ? 'bg-blue-600' : 'bg-slate-300'}`}><span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : ''}`}/></button>;
    const content = <>
    <header className="px-4 sm:px-8 pt-6 pb-5 shrink-0">{embedded ? <><h2 className="text-lg font-semibold">{t("MCP 与 Skills", "MCP and Skills")}</h2><p className="mt-2 text-sm text-slate-500">{t("管理 Agent 可使用的技能与外部工具。", "Manage the skills and external tools available to Agent.")}</p></> : <><DialogTitle className="text-2xl font-semibold tracking-tight">{t("MCP 与 Skills", "MCP and Skills")}</DialogTitle><DialogDescription className="mt-2 text-sm text-slate-500">{t("管理 Agent 可使用的技能与外部工具。", "Manage the skills and external tools available to Agent.")}</DialogDescription></>}</header>
    <div className="px-8 flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-slate-100 shrink-0"><div className="flex gap-1" role="tablist" aria-label={t("扩展类型", "Extension type")}>{(['skills', 'mcp'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setForm(undefined); setDetail(undefined); setTestedTools(undefined); setQuery(''); }} className={`px-4 py-2 rounded-lg text-sm ${tab === t ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>{t === 'skills' ? 'Skills' : 'MCP'} <span className="ml-1 text-slate-400">{t === 'skills' ? data?.skills.length ?? '—' : data?.servers.length ?? '—'}</span></button>)}</div><div className="flex items-center gap-2"><label className="flex items-center gap-2 border border-slate-200 rounded-lg px-3"><Search size={15} className="text-slate-400"/><input aria-label={t("搜索扩展", "Search extensions")} value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'skills' ? t("搜索 Skills", "Search skills") : t("搜索 MCP", "Search MCP")} className="w-36 py-2 text-sm outline-none"/></label><button disabled={busy} onClick={() => void perform(refresh)} aria-label={t("刷新扩展列表", "Refresh extensions")} className="p-2 text-slate-500"><RefreshCw size={16} className={busy ? 'animate-spin' : ''}/></button><button disabled={!data || busy} onClick={() => { setDetail(undefined); if (tab === 'mcp')
        editServer();
    else {
        setForm('skill');
        setError('');
    } }} className="flex items-center gap-1 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm"><Plus size={15}/>{t("添加", "Add")}</button></div></div>
    {error && <div role="alert" className="mx-8 mt-3 rounded-lg bg-red-50 text-red-700 p-3 text-sm">{error}</div>}
    <div className="flex-1 min-h-0 overflow-y-auto px-8 py-4">
      {!data && <p role="status" className="text-slate-500 py-12 text-center">{busy ? t("正在读取已安装扩展…", "Loading installed extensions…") : t("无法读取扩展，请刷新重试", "Could not load extensions. Refresh to try again.")}</p>}
      {detail ? <section><button className="flex gap-2 text-sm text-slate-500 mb-5" onClick={() => setDetail(undefined)}><ArrowLeft size={16}/>{t("返回 Skills", "Back to Skills")}</button><h3 className="font-semibold text-lg">{detail.skill.name}</h3><p className="text-xs text-slate-500 break-all mt-2">{detail.skill.directory}</p>{detail.skill.compatibility && <p className="my-3 text-sm">{t("依赖说明：", "Requirements:")}{detail.skill.compatibility}</p>}<AgentMarkdown showMetadata>{detail.content}</AgentMarkdown></section> : form ? <form className="max-w-xl space-y-4 py-3" onSubmit={e => { e.preventDefault(); void perform(async () => { if (form === 'skill')
            await save({ ...data!.config, skillRoots: [...new Set([...data!.config.skillRoots, root.trim()])] });
        else {
            const next: ServerConfig = { id: server.id, enabled: server.enabled, envKeys: server.envKeys, bearerTokenEnv: server.bearerTokenEnv, ...(transport === 'http' ? { url: server.url } : { command: server.command, args: argumentsText.split('\n').filter(Boolean) }) };
            await save({ ...data!.config, mcpServers: [...data!.config.mcpServers.filter(s => s.id !== editing), next] });
        } setForm(undefined); setRoot(''); }); }}>
        <h3 className="font-semibold">{form === 'skill' ? t("添加本地 Skill 目录", "Add local skills directory") : editing ? t("编辑 MCP 服务", "Edit MCP server") : t("添加 MCP 服务", "Add MCP server")}</h3>
        {form === 'skill' ? <><label className="block text-sm space-y-2"><span>{t("Skills 根目录（绝对路径）", "Skills root directory (absolute path)")}</span><input required className={inputClass} value={root} onChange={e => setRoot(e.target.value)} placeholder="/path/to/skills"/></label><p className="text-xs text-slate-500">{t("扫描此目录下各个 Skill 的 SKILL.md。添加后会展示格式检查结果。", "Scans this directory for SKILL.md files and displays validation results.")}</p></> : <><label className="block text-sm space-y-2"><span>{t("服务名称 / ID", "Server name / ID")}</span><input required pattern="[a-zA-Z0-9_]{1,30}" className={inputClass} value={server.id} onChange={e => setServer({ ...server, id: e.target.value })}/></label><label className="block text-sm space-y-2"><span>{t("连接方式", "Transport")}</span><select className={inputClass} value={transport} onChange={e => setTransport(e.target.value)}><option value="stdio">{t("本地命令 · stdio", "Local command · stdio")}</option><option value="http">{t("远程地址 · Streamable HTTP", "Remote URL · Streamable HTTP")}</option></select></label>{transport === 'http' ? <label className="block text-sm space-y-2"><span>{t("服务 URL", "Server URL")}</span><input required type="url" className={inputClass} value={server.url || ''} onChange={e => setServer({ ...server, url: e.target.value })}/></label> : <><label className="block text-sm space-y-2"><span>{t("启动命令", "Launch command")}</span><input required className={inputClass} value={server.command || ''} onChange={e => setServer({ ...server, command: e.target.value })}/></label><label className="block text-sm space-y-2"><span>{t("参数（每行一个）", "Arguments (one per line)")}</span><textarea className={inputClass} rows={3} value={argumentsText} onChange={e => setArgumentsText(e.target.value)}/></label></>}<label className="block text-sm space-y-2"><span>{transport === 'http' ? t("Bearer Token 环境变量名（可选）", "Bearer token environment variable (optional)") : t("传入的环境变量名（逗号分隔，可选）", "Environment variable names to pass through (comma-separated, optional)")}</span><input className={inputClass} value={transport === 'http' ? server.bearerTokenEnv || '' : server.envKeys?.join(',') || ''} onChange={e => setServer({ ...server, ...(transport === 'http' ? { bearerTokenEnv: e.target.value || undefined } : { envKeys: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }) })}/></label></>}
        <div className="flex gap-3"><button disabled={busy} className="bg-slate-900 text-white rounded-lg px-5 py-2 text-sm">{t("保存", "Save")}</button><button type="button" onClick={() => setForm(undefined)} className="text-sm text-slate-500">{t("取消", "Cancel")}</button></div>
      </form> : data && <>
        {tab === 'skills' ? <>{data.skills.filter(s => matches(s.name, s.description, s.directory)).map(s => <div key={s.name} className="flex items-center gap-4 py-5 border-b border-slate-100"><div className="rounded-full border border-slate-200 p-3 text-slate-500"><Box size={20}/></div><button className="flex-1 min-w-0 text-left" onClick={() => void perform(async () => setDetail({ skill: s, content: (await invoke('agent:skill-detail', { name: s.name })).content }))}><div className="text-sm font-semibold text-slate-800">{s.name}</div><p className="text-sm text-slate-500 mt-1 line-clamp-2">{s.description}</p><p className="text-xs text-slate-400 mt-1 truncate" title={s.directory}>{s.directory}</p></button><span className="text-xs text-slate-400 shrink-0">{s.root === data.roots[0] ? t("内置", "Built-in") : t("本地", "Local")}</span>{toggleButton(s.enabled, t(`${s.name} 启用`, `Enable ${s.name}`), () => toggle(s))}</div>)}{!data.skills.filter(s => matches(s.name, s.description, s.directory)).length && <p className="py-16 text-center text-slate-400">{query ? t("没有匹配的 Skills", "No matching skills") : t("尚未发现 Skills，可添加本地目录。", "No skills found. Add a local directory to get started.")}</p>}<details className="mt-6 text-xs text-slate-500"><summary className="cursor-pointer">{t("扫描目录 ·", "Scanned directories ·")} {data.roots.length}</summary>{data.roots.map(r => <div key={r} className="flex items-center justify-between gap-3 py-3"><span className="break-all">{r}</span>{data.config.skillRoots.includes(r) && <button disabled={busy} onClick={() => void perform(() => save({ ...data.config, skillRoots: data.config.skillRoots.filter(p => p !== r) }))} className="shrink-0 text-red-600">{t("移除目录", "Remove directory")}</button>}</div>)}</details>{data.diagnostics.length > 0 && <details className="mt-4 text-xs text-amber-700"><summary className="cursor-pointer">{t("未加载条目 ·", "Items not loaded ·")} {data.diagnostics.length}</summary>{data.diagnostics.map(d => <p key={d.directory} className="my-3 break-all">{d.directory}<br />{d.error}</p>)}</details>}</> : <>{data.servers.filter(s => matches(s.id, s.command || '', s.url || '')).map(s => <div key={s.id} className="flex items-center gap-4 py-5 border-b border-slate-100"><div className="rounded-full border border-slate-200 p-3 text-slate-500"><Server size={20}/></div><div className="flex-1 min-w-0"><button className="font-semibold text-sm" onClick={() => editServer(s)}>{s.id}</button><p className="text-xs text-slate-500 truncate mt-1">{s.url || [s.command, ...s.args || []].join(' ')}</p><p className={`text-xs mt-2 ${s.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{statusNames[s.status] ? t(...statusNames[s.status]) : s.status}{s.toolCount !== undefined ? t(` · ${s.toolCount} 个工具`, ` · Tools: ${s.toolCount}`) : ''}</p>{s.error && <p className="text-xs text-red-600 mt-1 break-all">{s.error}</p>}</div><div className="flex gap-3 text-xs text-slate-500"><button disabled={busy} onClick={() => void perform(async () => { try {
            setTestedTools((await invoke('agent:test-mcp', { serverId: s.id })).tools);
        }
        finally {
            await refresh();
        } })}>{t("测试连接", "Test connection")}</button><button disabled={busy} onClick={() => editServer(s)}>{t("编辑", "Edit")}</button><button disabled={busy} onClick={() => void perform(() => save({ ...data.config, mcpServers: data.config.mcpServers.filter(v => v.id !== s.id) }))}>{t("移除", "Remove")}</button></div>{toggleButton(!!s.enabled, t(`${s.id} 启用`, `Enable ${s.id}`), () => void perform(() => save({ ...data.config, mcpServers: data.config.mcpServers.map(v => v.id === s.id ? { ...v, enabled: !v.enabled } : v) })))}</div>)}{!data.servers.filter(s => matches(s.id, s.command || '', s.url || '')).length && <div className="py-16 text-center text-slate-400 text-sm">{query ? t("没有匹配的 MCP", "No matching MCP servers") : t("尚未配置 MCP 服务", "No MCP servers configured")}<p className="text-xs mt-2">{t("solopi-desktop 内置工具无需配置 MCP，不计入此列表。", "SoloPi Desktop's built-in tools do not require MCP setup and are not listed here.")}</p></div>}{testedTools && <details open className="mt-6 text-sm"><summary>{t("连接测试返回工具 ·", "Tools returned by the connection test ·")} {testedTools.length}</summary>{testedTools.map(t => <p key={t.name} className="text-xs text-slate-500 my-3 break-words">{t.description || t.name}</p>)}</details>}</>}
      </>}
    </div><footer className="px-8 py-4 border-t border-slate-100 text-xs text-slate-400 shrink-0">{t("启停仅影响 solopi-desktop，不修改原始 Skill 文件。修改后下一次 Agent 执行生效。", "Enabling or disabling skills applies to SoloPi Desktop and leaves the original files intact. Changes take effect on the next Agent run.")}</footer>
  </>;
    if (embedded) return <section className="flex min-w-0 flex-col bg-white">{content}</section>;
    return <Dialog open onOpenChange={open => { if (!open) onClose?.(); }}><DialogContent overlayClassName="z-[100]" className="z-[101] max-w-5xl w-[94vw] h-[82vh] flex flex-col gap-0 p-0 rounded-2xl bg-white overflow-hidden">{content}</DialogContent></Dialog>;
}
import { useLanguage } from '../language';
