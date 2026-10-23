import { useState } from 'react';

export type WorkflowVariableEntry = { name: string; source: string; value?: unknown; pending?: boolean; variableKey?: string };

export function displayVariableValue(value: unknown): string {
  if (value === undefined) return '未设置';
  if (value === '') return '（空字符串）';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function previewVariableExpression(raw: string, context: Record<string, unknown>): string | null {
  let found = false;
  const result = raw.replace(/\$\{([^}]+)\}|\{\{([^}]+)\}\}/g, (_match, dollar, braces) => {
    found = true;
    const path = String(dollar || braces).trim();
    const value = path.split('.').reduce<unknown>((current, key) => (
      current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, key)
        ? (current as Record<string, unknown>)[key] : undefined
    ), context);
    return value === undefined ? `〔${path}：未定义或运行时生成〕` : displayVariableValue(value);
  });
  return found ? result : null;
}

export function AudioParameterField({ label, value, onChange, context, options = [] }: {
  label: string; value: string; onChange: (value: string) => void;
  context: Record<string, unknown>; options?: readonly { key: string; label: string }[];
}) {
  const preview = previewVariableExpression(value, context);
  return <label className="block min-w-0 space-y-1 text-xs font-bold text-slate-600">
    <span className="block break-words">{label}</span>
    <input type="text" value={value} onChange={(event) => onChange(event.target.value)}
      placeholder="填写数值或变量表达式"
      className="h-9 w-full min-w-0 rounded-lg border border-blue-100 bg-white px-2 font-mono text-xs outline-none focus:border-blue-300" />
    {options.length > 0 && <select aria-label={`${label} 常用值`} value=""
      onChange={(event) => { if (event.target.value) onChange(event.target.value); }}
      className="h-9 w-full min-w-0 rounded-lg border border-blue-100 bg-white px-2 text-xs">
      <option value="">选择常用编码（也可在上方填写变量）</option>
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>}
    {preview !== null && <span className="block break-all font-normal text-blue-700">当前配置预览：{preview}</span>}
  </label>;
}

export function parseVariableEdit(raw: string, original: unknown): unknown {
  if (typeof original === 'string' || original === undefined) return raw;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('请输入有效的 JSON 值'); }
  if (typeof original === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('请输入有效数字');
  if (typeof original === 'boolean' && typeof value !== 'boolean') throw new Error('请输入 true 或 false');
  if (Array.isArray(original) && !Array.isArray(value)) throw new Error('请输入 JSON 数组');
  if (original !== null && typeof original === 'object' && !Array.isArray(original)
    && (value === null || typeof value !== 'object' || Array.isArray(value))) throw new Error('请输入 JSON 对象');
  return value;
}

export function VariableValueEditor({ name, value, onSave }: {
  name: string; value: unknown; onSave: (value: unknown) => void;
}) {
  const initial = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const dirty = draft !== initial;
  const save = () => {
    try { const parsed = parseVariableEdit(draft, value); onSave(parsed); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '变量值无效'); }
  };
  return <div className="min-w-0 space-y-1">
    <textarea aria-label={`${name} 变量值`} value={draft} rows={2}
      onChange={(event) => { setDraft(event.target.value); setError(''); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setDraft(initial); setError(''); }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); }
      }}
      className="w-full resize-y rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-700 outline-none focus:border-blue-400" />
    {dirty && <div className="flex items-center gap-2">
      <button type="button" onClick={save} className="rounded border border-blue-200 px-2 py-1 text-blue-600">保存</button>
      <button type="button" onClick={() => { setDraft(initial); setError(''); }} className="px-2 py-1 text-slate-500">取消</button>
    </div>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>;
}

export function WorkflowVariablePanel({ entries, onVariableChange }: { entries: WorkflowVariableEntry[]; onVariableChange?: (key: string, value: unknown) => void }) {
  const [search, setSearch] = useState('');
  const filtered = entries.filter((entry) => `${entry.name} ${entry.source}`.toLowerCase().includes(search.toLowerCase()));
  return <details className="shrink-0 border-b border-slate-200 bg-white px-6 py-2">
    <summary className="cursor-pointer text-xs font-bold text-blue-600">查看已定义变量（{entries.length}）</summary>
    <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-500">{onVariableChange ? '用例变量可编辑后点击保存（⌘/Ctrl + Enter）。' : ''}以下是配置值，节点输出在运行时生成；可复制变量表达式用于参数。</p>
      <input aria-label="搜索变量" placeholder="搜索变量名或来源" value={search} onChange={(event) => setSearch(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" />
      <div className="max-h-64 overflow-auto">
        {filtered.map((entry, index) => <div key={`${entry.name}-${index}`} className="grid gap-1 border-b border-slate-100 py-2 text-xs md:grid-cols-3">
          <code className="select-all break-all text-blue-700">{'${' + entry.name + '}'}</code>
          <span className="break-words text-slate-500">{entry.source}</span>
          {entry.variableKey !== undefined && !entry.pending && onVariableChange
            ? <VariableValueEditor key={`${entry.variableKey}:${JSON.stringify(entry.value)}`} name={entry.name} value={entry.value}
                onSave={(value) => onVariableChange(entry.variableKey!, value)} />
            : <pre className="whitespace-pre-wrap break-all font-mono text-slate-700">{entry.pending ? '运行时生成' : displayVariableValue(entry.value)}</pre>}
        </div>)}
        {filtered.length === 0 && <p className="py-3 text-xs text-slate-500">没有匹配的变量</p>}
      </div>
    </div>
  </details>;
}
