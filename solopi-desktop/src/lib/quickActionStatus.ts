export function queryReadiness(
  args: string[], values: Record<string, string>, context: Record<string, string>,
): string {
  const inspect = (value: string, seen: Set<string>): boolean => {
    if (!value.trim()) return false;
    return [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].every(([, key]) => {
      if (seen.has(key)) return false;
      if (key.startsWith('inputs.')) return inspect(values[key.slice(7)] || '', new Set([...seen, key]));
      if (key in context) return Boolean(context[key]?.trim());
      return ['adbPath', 'outputDir', 'appDataDir', 'platform', 'arch', 'resourcesDir'].includes(key);
    });
  };
  if (!args.length) return '请配置查询参数';
  return args.every((arg) => inspect(arg, new Set())) ? '' : '等待参数或设备配置';
}
