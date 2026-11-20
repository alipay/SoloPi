import { useLanguage } from '../language';

const fields: Record<string, [string, string]> = {
  repoUrl: ["目标仓库", "Repository"],
  branch: ["分支", "Branch"],
  directory: ["仓库目录", "Repository directory"],
  fileName: ["脚本名称", "Script name"],
  phase: ["执行阶段", "Execution phase"],
  paths: ["脚本路径", "Script paths"],
  command: ["程序", "Program"],
  arguments: ["参数", "Arguments"],
  cwd: ["工作目录", "Working directory"],
  timeoutSeconds: ["超时（秒）", "Timeout (seconds)"],
  serial: ["设备", "Device"],
  packageName: ["应用包名", "App package"],
  taskId: ["任务", "Task"],
  taskName: ["任务名称", "Task name"],
  caseId: ["用例", "Test case"],
  caseIds: ["用例列表", "Test cases"],
  libraryId: ["用例库", "Case library"],
  folderId: ["目录", "Folder"],
  role: ["设备类型", "Device type"],
  durationSeconds: ["采集时长（秒）", "Collection duration (seconds)"],
  intervalSeconds: ["采样间隔（秒）", "Sample interval (seconds)"],
  mode: ["导入方式", "Import mode"],
  path: ["日志路径", "Log path"],
  adbPath: ["ADB路径", "ADB path"],
  selectedModelId: ["使用模型", "Model"],
  action: ["操作", "Action"],
  skillRoots: ["Skill目录", "Skill directories"],
  id: ["标识", "Identifier"],
};
export default function AgentOperationSummary({ args }: { args: unknown }) {
  const { t } = useLanguage();
  const value = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const document = value.document as { case?: { name?: string; steps?: unknown[] }; name?: string; steps?: unknown[] } | undefined;
  const testCase = document?.case || document;
  const caseName = testCase?.name || String(value.caseId || '');
  const stepCount = testCase?.steps?.length || 0;
  return <div className="space-y-2 text-sm text-slate-700">
    {testCase && <p>{t(`保存用例「${caseName}」，共 ${stepCount} 个步骤。`, `Save test case “${caseName}” (${stepCount} steps).`)}</p>}
    {Object.entries(value).filter(([key]) => fields[key]).map(([key, item]) => <div key={key} className="flex gap-3"><span className="shrink-0 text-slate-500">{t(...fields[key])}</span><span className="break-all">{Array.isArray(item) ? item.join(t('、', ', ')) : String(item)}</span></div>)}
    {value.values != null && <p>{t("快捷操作参数：", "Quick action arguments: ")}{JSON.stringify(value.values)}</p>}
    {value.context != null && <p>{t("设备上下文：", "Device context: ")}{JSON.stringify(value.context)}</p>}
    {value.devices != null && <p>{t("设备绑定：", "Device bindings: ")}{JSON.stringify(value.devices)}</p>}
    {value.model != null && <p>{t("模型配置：", "Model configuration: ")}{JSON.stringify(value.model)}</p>}
    {value.component != null && <p>{t("通用组件：", "Test component: ")}{String((value.component as { name?: string }).name || '')}</p>}
    {value.ttsProvider != null && <p>{t("更新 TTS 参数。", "Update TTS settings.")}</p>}
    {Array.isArray(value.mcpServers) && <p>{t(`配置 ${value.mcpServers.length} 个 MCP 服务。`, `Configure MCP servers (${value.mcpServers.length}).`)}</p>}
    <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">{t("查看完整参数", "View all arguments")}</summary><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(args, null, 2)}</pre></details>
  </div>;
}
