import { useMemo, useState } from 'react';
import { INPUT_ACTIONS, REQUIRED_PARAMS, nativeCaseIssues } from '../../electron/solopi-native-schema';
export default function SoloPiNativeEditor({ value, inputs, onChange, onInputChange, restartApp, timeout, onRestartChange, onTimeoutChange }: {
  value: string; inputs: Record<string, string>; onChange: (value: string) => void; onInputChange: (key: string, value: string) => void;
  restartApp: string; timeout: string; onRestartChange: (value: string) => void; onTimeoutChange: (value: string) => void;
}) {
  const document = useMemo(() => { try { return JSON.parse(value); } catch { return null; } }, [value]);
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil((document?.operationLog?.steps?.length || 0) / 20) - 1));
  const issues = useMemo(() => nativeCaseIssues(value, inputs), [value, inputs]);
  const steps = Array.isArray(document?.operationLog?.steps) ? document.operationLog.steps : [];
  const setParam = (index: number, key: string, content: string) => {
    const next = JSON.parse(value); next.operationLog.steps[index].operationMethod.operationParam[key] = content;
    onChange(JSON.stringify(next, null, 2));
  };
  return <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
    <p className="text-sm font-bold">SoloPi 原生操作序列 · {steps.length} 步</p>
    <p className="text-xs leading-relaxed text-slate-500">由手机原有引擎执行，保留变量、手势和断言语义。点击每步可调整参数；录制输入已移除，请补充需要的文本。</p>
    {issues.length > 0 && <div role="status" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{issues.slice(0, 8).map((issue, i) => <p key={i}>第 {issue.index + 1} 步：{issue.reason}</p>)}</div>}
    <div className="max-h-80 space-y-2 overflow-auto">
      {steps.slice(currentPage * 20, currentPage * 20 + 20).map((step: any, offset: number) => {
        const index = currentPage * 20 + offset;
        const action = step.operationMethod?.actionEnum || '';
        const params = step.operationMethod?.operationParam || {};
        const keys = [...new Set([...Object.keys(params), ...(REQUIRED_PARAMS[action] || [])])];
        return <details key={step.stepId || index} className="rounded-lg border border-slate-200 bg-white p-2">
          <summary className="cursor-pointer text-xs font-bold">{index + 1}. {action}</summary>
          {keys.map(key => <label key={key} className="mt-2 block text-xs text-slate-500">{INPUT_ACTIONS.has(action) && key === 'text' ? '输入内容' : key}
            <textarea aria-label={`第 ${index + 1} 步 ${key}`} value={INPUT_ACTIONS.has(action) && key === 'text' ? inputs[`inputText_${index}`] ?? params[key] ?? '' : params[key] ?? ''} onChange={event => INPUT_ACTIONS.has(action) && key === 'text' ? onInputChange(`inputText_${index}`, event.target.value) : setParam(index, key, event.target.value)} className="mt-1 min-h-14 w-full rounded-lg border bg-slate-50 p-2 font-mono text-xs" />
          </label>)}
          {keys.length === 0 && <p className="mt-2 text-xs text-slate-500">此动作没有额外参数。</p>}
        </details>;
      })}
    </div>
    {steps.length > 20 && <div className="flex items-center justify-between text-xs"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {Math.ceil(steps.length / 20)}</span><button type="button" disabled={(currentPage + 1) * 20 >= steps.length} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={restartApp !== 'false'} onChange={e => onRestartChange(String(e.target.checked))} />回放前重新启动目标应用</label>
    <label className="block text-xs">回放时限(ms)<input type="number" min="100" max="3600000" value={timeout} onChange={e => onTimeoutChange(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
    <details><summary className="cursor-pointer text-xs font-bold text-slate-500">完整动作、定位与高级配置 JSON</summary><textarea aria-label="原生动作序列 JSON" value={value} onChange={e => onChange(e.target.value)} className="mt-2 h-64 w-full rounded-lg border bg-slate-50 p-2 font-mono text-xs" /></details>
  </div>;
}
