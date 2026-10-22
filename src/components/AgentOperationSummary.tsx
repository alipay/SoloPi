const fields: Record<string, string> = { repoUrl: '目标仓库', branch: '分支', directory: '仓库目录', fileName: '脚本名称', phase: '执行阶段', paths: '脚本路径', command: '程序', arguments: '参数', cwd: '工作目录', timeoutSeconds: '超时（秒）', serial: '设备', packageName: '应用包名', taskId: '任务', taskName: '任务名称', caseId: '用例', caseIds: '用例列表', libraryId: '用例库', folderId: '目录', role: '设备类型', durationSeconds: '采集时长（秒）', intervalSeconds: '采样间隔（秒）', mode: '导入方式', path: '日志路径', adbPath: 'ADB路径', selectedModelId: '使用模型', action: '操作', skillRoots: 'Skill目录', id: '标识' };
export default function AgentOperationSummary({ args }: { args: unknown }) {
  const value = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const document = value.document as { case?: { name?: string; steps?: unknown[] }; name?: string; steps?: unknown[] } | undefined;
  const testCase = document?.case || document;
  return <div className="space-y-2 text-sm text-slate-700">
    {testCase && <p>保存用例「{testCase.name || String(value.caseId || '')}」，共 {testCase.steps?.length || 0} 个步骤。</p>}
    {Object.entries(value).filter(([key]) => fields[key]).map(([key, item]) => <div key={key} className="flex gap-3"><span className="shrink-0 text-slate-500">{fields[key]}</span><span className="break-all">{Array.isArray(item) ? item.join('、') : String(item)}</span></div>)}
    {value.values != null && <p>快捷操作参数：{JSON.stringify(value.values)}</p>}
    {value.context != null && <p>设备上下文：{JSON.stringify(value.context)}</p>}
    {value.devices != null && <p>设备绑定：{JSON.stringify(value.devices)}</p>}
    {value.model != null && <p>模型配置：{JSON.stringify(value.model)}</p>}
    {value.component != null && <p>通用组件：{String((value.component as { name?: string }).name || '')}</p>}
    {value.ttsProvider != null && <p>更新 TTS 参数。</p>}
    {Array.isArray(value.mcpServers) && <p>配置 {value.mcpServers.length} 个 MCP 服务。</p>}
    <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">查看完整参数</summary><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(args, null, 2)}</pre></details>
  </div>;
}
