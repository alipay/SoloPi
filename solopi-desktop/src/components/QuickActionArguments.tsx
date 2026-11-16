import { useState } from 'react';

export const automaticArguments = (inputs: { key: string }[]) => inputs.map(({ key }) => `{{inputs.${key}}}`);
export const usesAutomaticArguments = (inputs: { key: string }[], args: string[]) => JSON.stringify(automaticArguments(inputs)) === JSON.stringify(args);

export function QuickActionArguments({ label, inputs, args, onChange }: {
  label: string; inputs: { key: string; label: string }[]; args: string[]; onChange: (args: string[]) => void;
}) {
  const [raw, setRaw] = useState(false);
  const update = (index: number, value: string) => onChange(args.map((arg, i) => i === index ? value : arg));
  const move = (index: number, offset: number) => {
    const next = [...args];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return <div className="space-y-2 text-xs">
    <div className="flex items-center justify-between"><span className="font-bold">{label}</span><button type="button" className="text-slate-500 underline" onClick={() => setRaw(!raw)}>{raw ? '返回可视化配置' : '高级表达式'}</button></div>
    <p className="text-slate-500">按脚本接收顺序选择表单字段，或填写固定值（例如 --serial、start）。空值也占一个参数位置。</p>
    {raw ? <textarea aria-label={`${label}表达式`} className="w-full rounded-xl border p-3 font-mono" rows={4} value={args.join('\n')} onChange={(event) => onChange(event.target.value === '' ? [] : event.target.value.split('\n'))} /> : args.map((arg, index) => {
      const field = inputs.find((input) => arg === `{{inputs.${input.key}}}`);
      return <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <span className="text-slate-400">第 {index + 1} 个</span>
        <select aria-label={`${label}第${index + 1}个来源`} className="min-w-0 flex-1 rounded-lg border p-2" value={field ? `field:${field.key}` : 'literal'} onChange={(event) => update(index, event.target.value === 'literal' ? '' : `{{inputs.${event.target.value.slice(6)}}}`)}>
          <option value="literal">固定值 / 自定义表达式</option>
          {inputs.map((input) => <option key={input.key} value={`field:${input.key}`}>{input.label || input.key}</option>)}
        </select>
        {!field && <input aria-label={`${label}第${index + 1}个值`} className="min-w-0 flex-1 rounded-lg border p-2" value={arg} onChange={(event) => update(index, event.target.value)} placeholder="例如 start 或 --serial" />}
        <button type="button" aria-label={`上移${label}第${index + 1}个`} disabled={index === 0} onClick={() => move(index, -1)} className="disabled:opacity-30">↑</button>
        <button type="button" aria-label={`下移${label}第${index + 1}个`} disabled={index === args.length - 1} onClick={() => move(index, 1)} className="disabled:opacity-30">↓</button>
        <button type="button" className="text-rose-600" onClick={() => onChange(args.filter((_, i) => i !== index))}>移除</button>
      </div>;
    })}
    {!raw && <button type="button" className="text-blue-600" onClick={() => onChange([...args, inputs[0] ? `{{inputs.${inputs[0].key}}}` : ''])}>＋ 添加传参项</button>}
    <div className="break-all text-slate-500">传参预览：{args.map((arg) => JSON.stringify(inputs.find((input) => arg === `{{inputs.${input.key}}}`)?.label ? `[${inputs.find((input) => arg === `{{inputs.${input.key}}}`)!.label}]` : arg)).join(' ') || '无参数'}</div>
  </div>;
}
