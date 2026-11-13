export function sessionPresentation(status?: string) {
  if (!status) return { icon: 'play', subtitle: '点击开始' };
  if (status === 'active') return { icon: 'stop', subtitle: '采集中 · 点击结束并导出' };
  if (status === 'exporting' || status === 'export-failed') return { icon: 'download', subtitle: '待导出 · 点击重试' };
  return { icon: 'stop', subtitle: '待恢复 · 点击结束并导出' };
}
