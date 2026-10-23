import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Cpu,
  Download,
  FileText,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Square,
  TimerReset,
  Thermometer,
} from 'lucide-react';

type PerformanceOption = { value: string; label?: string };

export function PerformanceComboBox({ value, onChange, options, disabled, placeholder, label, loading = false }: {
  value: string;
  onChange: (value: string) => void;
  options: PerformanceOption[];
  disabled: boolean;
  placeholder: string;
  label: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const id = React.useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = options.filter(option => `${option.value} ${option.label || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const showAll = () => { setQuery(''); setActive(-1); setOpen(true); };
  const select = (next: string) => { onChange(next); setOpen(false); setQuery(''); setActive(-1); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);
  return (
    <div className="relative min-w-0 flex-1" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <input ref={inputRef} value={value} disabled={disabled} placeholder={placeholder}
        role="combobox" aria-label={label} aria-expanded={open && !disabled} aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${id}-${active}` : undefined}
        onFocus={showAll} onClick={() => { if (!open) showAll(); }}
        onChange={event => { onChange(event.target.value); setQuery(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); setActive(-1); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { showAll(); return; }
            setActive(current => event.key === 'ArrowDown' ? Math.min(current + 1, matches.length - 1) : Math.max(current - 1, 0));
          }
          if (event.key === 'Enter' && open && matches[active]) { event.preventDefault(); select(matches[active].value); }
        }}
        className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 pr-10 font-mono text-sm font-bold outline-none focus:border-blue-300 disabled:opacity-60" />
      <button type="button" disabled={disabled} aria-label={`展开${label}列表`}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { inputRef.current?.focus(); showAll(); }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 disabled:opacity-50">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span aria-hidden="true">▾</span>}
      </button>
      {open && !disabled && <div id={id} role="listbox" aria-label={label}
        className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full min-w-[260px] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
        {matches.length ? matches.map((option, index) => <button key={option.value} id={`${id}-${index}`}
          type="button" role="option" aria-selected={option.value === value} tabIndex={-1}
          onMouseDown={event => event.preventDefault()} onClick={() => select(option.value)}
          className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${index === active ? 'bg-blue-50' : ''}`}>
          <span className="block break-all font-mono font-semibold text-slate-800">{option.value}</span>
          {option.label && <span className="block text-xs text-slate-500">{option.label}</span>}
        </button>) : <div className="px-3 py-2 text-sm text-slate-400">{loading ? '正在读取…' : '没有匹配项，可手动输入'}</div>}
      </div>}
    </div>
  );
}

type DeviceRuntime = 'android' | 'harmony';
type ResultTab = 'samples' | 'trend';
type PerformancePageTab = 'task' | 'reports';

type PerformanceSample = {
  timestamp: string;
  serial: string;
  packageName: string;
  runtime: DeviceRuntime;
  pid?: string;
  memoryKb?: number;
  cpuPercent?: number;
  threadCount?: number;
  batteryTemperatureC?: number;
  batteryLevelPercent?: number;
  batteryVoltageMv?: number;
  batteryPowered?: boolean;
  batteryError?: string;
  systemAvailableMemoryKb?: number;
  systemAvailableCpuPercent?: number;
  error?: string;
  raw?: Record<string, string>;
};

type PerformanceDevice = {
  serial: string;
  state?: string;
  model?: string;
  product?: string;
  device?: string;
  kind?: string;
};

type PerformanceSampleResult = {
  success?: boolean;
  sample?: PerformanceSample;
  error?: string;
};

type PerformanceListDevicesResult = {
  devices?: PerformanceDevice[];
  error?: string;
};

type PerformanceListPackagesResult = {
  packages?: string[];
  error?: string;
};

type PerformanceVersionResult = {
  version?: string;
  error?: string;
};

export type CrashStats = {
  status: 'pending' | 'running' | 'stopped' | 'failed' | 'unsupported';
  count: number;
  scope?: 'device';
  targetCount?: number;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  events: { id: string; timestamp: string; pid: string; processName: string; isTarget?: boolean; sources?: string[]; type: string; exception: string; message: string; evidence: string }[];
};

export function crashSummary(crashes?: CrashStats) {
  if (!crashes) return '未采集';
  if (crashes.status === 'unsupported') return '不支持';
  return `${crashes.count} 次${crashes.status === 'failed' ? '（采集不完整）' : crashes.status === 'pending' ? '（准备中）' : ''}`;
}

export function CrashSummary({ crashes }: { crashes?: CrashStats }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">应用崩溃</h3>
      <span className={`text-lg font-black ${crashes?.count ? 'text-red-600' : 'text-slate-700'}`}>{crashSummary(crashes)}</span></div>
    <p className="mt-1 text-xs text-slate-500">{crashes?.scope === 'device' ? `设备全部应用 · 目标包及子进程 ${crashes.targetCount ?? crashes.events.filter(event => event.isTarget).length} 次 · 系统事件与应用崩溃日志去重` : '历史采集：仅目标包及子进程的系统崩溃事件'} · 不含正常退出、强制停止和 ANR{crashes?.status === 'running' ? ' · 监听中' : ''}</p>
    {crashes?.startedAt && <p className="mt-1 text-xs text-slate-400">{new Date(crashes.startedAt).toLocaleString('zh-CN', { hour12: false })} → {crashes.endedAt ? new Date(crashes.endedAt).toLocaleString('zh-CN', { hour12: false }) : '采集中'}</p>}
    {crashes?.error && <p role="alert" className="mt-2 text-sm text-amber-700">{crashes.error}</p>}
    {!!crashes?.events.length && <details className="mt-3"><summary className="cursor-pointer text-sm text-blue-600">查看崩溃明细（{crashes.count}）</summary>
      <div className="mt-2 max-h-72 overflow-auto space-y-2">{crashes.events.map(event => <div key={event.id} className="rounded-lg bg-red-50 p-2 text-xs">
        <div>{new Date(event.timestamp).toLocaleString('zh-CN', { hour12: false })} · {event.type} · PID {event.pid} · {event.isTarget === true ? '目标包' : event.isTarget === false ? '其他进程' : '历史记录'} · {event.sources?.join(' + ') || 'am_crash'}</div>
        <div className="break-all font-mono">{event.processName || '进程名未解析'} · {event.exception}</div><pre className="whitespace-pre-wrap break-all">{event.evidence}</pre>
      </div>)}</div></details>}
  </section>;
}

type PerformanceReport = {
  id: string;
  name: string;
  createdAt: string;
  runtime: DeviceRuntime;
  serial: string;
  packageName: string;
  packageVersion: string;
  intervalSeconds: number;
  crashes?: CrashStats;
  samples: PerformanceSample[];
};

interface PerformanceTestPageProps {
  phoneSerial: string;
  phonePackage: string;
  view?: PerformancePageTab;
  onOpenReports?: () => void;
}

const performanceReportsStorageKey = 'glassbox.performanceReports';

function getElectronApi() {
  try {
    return window.glassbox;
  } catch (_error) {
    return null;
  }
}

function formatMetric(value: number | undefined, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)}${suffix}` : '-';
}

function formatMemory(kb: number | undefined) {
  if (typeof kb !== 'number' || !Number.isFinite(kb)) {
    return '-';
  }

  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
}

function createReportId() {
  return `performance-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadStoredReports(): PerformanceReport[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(performanceReportsStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed.filter((item): item is PerformanceReport => (
      Boolean(item?.id && item?.name && Array.isArray(item?.samples))
    )) : [];
  } catch (_error) {
    return [];
  }
}

function saveStoredReports(reports: PerformanceReport[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(performanceReportsStorageKey, JSON.stringify(reports));
}

function sanitizeFileName(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'performance-report';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getReportSummary(report: PerformanceReport) {
  return {
    memory: summarize(report.samples.map((item) => item.memoryKb)),
    cpu: summarize(report.samples.map((item) => item.cpuPercent)),
    threads: summarize(report.samples.map((item) => item.threadCount)),
    systemMemory: summarize(report.samples.map((item) => item.systemAvailableMemoryKb)),
    systemCpu: summarize(report.samples.map((item) => item.systemAvailableCpuPercent)),
    failedCount: report.samples.filter((item) => item.error).length,
    latestSample: report.samples[report.samples.length - 1],
  };
}

function buildExportTrendSvg(report: PerformanceReport) {
  const width = 720;
  const height = 220;
  const chartLeft = 62;
  const chartRight = 20;
  const chartTop = 28;
  const chartBottom = 36;
  const chartWidth = width - chartLeft - chartRight;
  const chartHeight = height - chartTop - chartBottom;

  return metricTrendConfigs.map((config) => {
    const values = report.samples.map(config.getValue);
    const extraValues = config.getExtraValue ? report.samples.map(config.getExtraValue) : [];
    const range = getRange([...values, ...extraValues], config.floorAtZero);
    const chart = { left: chartLeft, top: chartTop, width: chartWidth, height: chartHeight };
    const path = buildLinePath(values, range, chart);
    const extraPath = buildLinePath(extraValues, range, chart);
    const ticks = [range.max, (range.max + range.min) / 2, range.min];
    const xLabels = report.samples.map((sample, index) => {
      if (index % Math.ceil(report.samples.length / 5 || 1) !== 0) {
        return '';
      }

      const x = chartLeft + (index / Math.max(report.samples.length - 1, 1)) * chartWidth;
      return `<text x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle" fill="#64748b" font-size="10" font-weight="700">${escapeHtml(new Date(sample.timestamp).toLocaleTimeString('zh-CN', { hour12: false }))}</text>`;
    }).filter(Boolean).join('');

    return `<section class="trend-card">
      <h3>${escapeHtml(config.label)}${config.unit ? ` ${escapeHtml(config.unit)}` : ''}</h3>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(config.label)}趋势图">
        <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="#f8fafc" />
        ${ticks.map((tick, tickIndex) => {
          const y = chartTop + tickIndex * (chartHeight / 2);
          return `<g>
            <line x1="${chartLeft}" x2="${width - chartRight}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" />
            <text x="${chartLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="10" font-weight="700">${escapeHtml(formatAxisValue(tick, config.unit))}</text>
          </g>`;
        }).join('')}
        <line x1="${chartLeft}" x2="${chartLeft}" y1="${chartTop}" y2="${chartTop + chartHeight}" stroke="#cbd5e1" stroke-width="1.5" />
        ${extraPath && config.extraColor ? `<path d="${extraPath}" fill="none" stroke="${config.extraColor}" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" />` : ''}
        ${path ? `<path d="${path}" fill="none" stroke="${config.color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" />` : ''}
        ${xLabels}
      </svg>
    </section>`;
  }).join('\n');
}

function buildReportMarkdown(report: PerformanceReport) {
  const summary = getReportSummary(report);
  const createdAt = new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false });
  const trendSvg = buildExportTrendSvg(report);
  const rows = report.samples.map((sample) => [
    new Date(sample.timestamp).toLocaleString('zh-CN', { hour12: false }),
    sample.pid || '-',
    formatMemory(sample.memoryKb),
    formatMetric(sample.cpuPercent, '%'),
    formatMetric(sample.threadCount),
    formatMetric(sample.batteryTemperatureC, ' °C'),
    formatMemory(sample.systemAvailableMemoryKb),
    formatMetric(sample.systemAvailableCpuPercent, '%'),
    sample.error ? `失败：${sample.error}` : '成功',
  ]);

  return [
    `# ${report.name}`,
    '',
    `- 创建时间：${createdAt}`,
    `- 设备：${report.serial || '-'}`,
    `- 包名：${report.packageName || '-'}`,
    `- 版本：${report.packageVersion || '-'}`,
    `- 系统：${report.runtime === 'android' ? 'Android / adb' : '鸿蒙 / hdc'}`,
    `- 采样：${report.samples.length} 次，失败 ${summary.failedCount} 次`,
    `- 间隔：${report.intervalSeconds}s`,
    `- 应用崩溃：${crashSummary(report.crashes)}`,
    `- 采集范围：${report.crashes?.scope === 'device' ? `设备全部应用，目标包及子进程 ${report.crashes.targetCount ?? 0} 次；系统事件与应用崩溃日志去重` : '历史采集：仅目标包系统事件'}`,
    `- 崩溃采集状态：${report.crashes?.status || '未采集'} ${report.crashes?.error || ''}`,
    `- 崩溃采集窗口：${report.crashes?.startedAt || '-'} → ${report.crashes?.endedAt || '-'}`,
    ...(report.crashes?.events || []).map(event => `- ${event.timestamp} · ${event.processName} · PID ${event.pid} · ${event.type} · ${event.isTarget === true ? '目标包' : event.isTarget === false ? '其他进程' : '历史记录'} · ${event.sources?.join(' + ') || 'am_crash'}\n\n    ${event.evidence}`),
    '',
    '## 指标摘要',
    '',
    `- 内存：均值 ${formatMemory(summary.memory.avg)}，峰值 ${formatMemory(summary.memory.max)}，可用最低 ${formatMemory(summary.systemMemory.min)}`,
    `- CPU：均值 ${formatMetric(summary.cpu.avg, '%')}，峰值 ${formatMetric(summary.cpu.max, '%')}，可用最低 ${formatMetric(summary.systemCpu.min, '%')}`,
    `- 线程：均值 ${formatMetric(summary.threads.avg)}，峰值 ${formatMetric(summary.threads.max)}，最后采样 ${summary.latestSample ? new Date(summary.latestSample.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '-'}`,
    '',
    '## 趋势图',
    '',
    '<div class="trend-grid">',
    trendSvg,
    '</div>',
    '',
    '## 采样明细',
    '',
    '| 时间 | PID | 内存 | CPU | 线程 | 电池温度（设备） | 可用内存 | 可用CPU | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, '\\|')).join(' | ')} |`),
    '',
  ].join('\n');
}

function buildReportHtml(report: PerformanceReport) {
  const summary = getReportSummary(report);
  const createdAt = new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false });
  const trendSvg = buildExportTrendSvg(report);
  const rows = report.samples.map((sample) => `
    <tr>
      <td>${escapeHtml(new Date(sample.timestamp).toLocaleString('zh-CN', { hour12: false }))}</td>
      <td>${escapeHtml(sample.pid || '-')}</td>
      <td>${escapeHtml(formatMemory(sample.memoryKb))}</td>
      <td>${escapeHtml(formatMetric(sample.cpuPercent, '%'))}</td>
      <td>${escapeHtml(formatMetric(sample.threadCount))}</td>
      <td>${escapeHtml(formatMetric(sample.batteryTemperatureC, ' °C'))}</td>
      <td>${escapeHtml(formatMemory(sample.systemAvailableMemoryKb))}</td>
      <td>${escapeHtml(formatMetric(sample.systemAvailableCpuPercent, '%'))}</td>
      <td>${escapeHtml(sample.error ? `失败：${sample.error}` : '成功')}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.name)}</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .meta, .card { border: 1px solid #e2e8f0; background: #fff; border-radius: 16px; padding: 18px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }
    .meta-grid, .summary { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .trend-grid { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .trend-card { border: 1px solid #e2e8f0; background: #fff; border-radius: 16px; padding: 14px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }
    .trend-card h3 { margin: 0 0 10px; color: #334155; font-size: 14px; }
    .trend-card svg { display: block; width: 100%; height: auto; }
    .muted { color: #64748b; font-weight: 700; }
    .value { margin-top: 6px; font-size: 22px; font-weight: 900; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 14px; overflow: hidden; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; font-size: 12px; }
    th { background: #f1f5f9; color: #475569; }
    section { margin-top: 20px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(report.name)}</h1>
    <p class="muted">${escapeHtml(createdAt)} · ${report.samples.length} 次采样 / 失败 ${summary.failedCount} 次</p>
    <section class="meta">
      <div class="meta-grid">
        <div><div class="muted">设备</div><strong>${escapeHtml(report.serial || '-')}</strong></div>
        <div><div class="muted">包名</div><strong>${escapeHtml(report.packageName || '-')}</strong></div>
        <div><div class="muted">版本</div><strong>${escapeHtml(report.packageVersion || '-')}</strong></div>
        <div><div class="muted">系统</div><strong>${report.runtime === 'android' ? 'Android / adb' : '鸿蒙 / hdc'}</strong></div>
        <div><div class="muted">间隔</div><strong>${report.intervalSeconds}s</strong></div>
      </div>
    </section>
    <section><h2>应用崩溃：${escapeHtml(crashSummary(report.crashes))}</h2>
      <p>${report.crashes?.scope === 'device' ? `设备全部应用 · 目标包及子进程 ${report.crashes.targetCount ?? 0} 次 · 多源去重` : '历史采集：仅目标包系统事件'}</p>
      <p>${escapeHtml(report.crashes?.status || '未采集')} ${escapeHtml(report.crashes?.error || '')}</p>
      <p>${escapeHtml(report.crashes?.startedAt || '-')} → ${escapeHtml(report.crashes?.endedAt || '-')}</p>
      ${(report.crashes?.events || []).map(event => `<pre>${event.isTarget === true ? '目标包' : event.isTarget === false ? '其他进程' : '历史记录'} · ${escapeHtml(event.processName)} · ${escapeHtml(event.sources?.join(' + ') || 'am_crash')}\n${escapeHtml(event.evidence)}</pre>`).join('')}
    </section>
    <section class="summary">
      <div class="card"><div class="muted">内存峰值 / 可用最低</div><div class="value">${escapeHtml(formatMemory(summary.memory.max))} / ${escapeHtml(formatMemory(summary.systemMemory.min))}</div></div>
      <div class="card"><div class="muted">CPU峰值 / 可用最低</div><div class="value">${escapeHtml(formatMetric(summary.cpu.max, '%'))} / ${escapeHtml(formatMetric(summary.systemCpu.min, '%'))}</div></div>
      <div class="card"><div class="muted">线程峰值 / 最后采样</div><div class="value">${escapeHtml(formatMetric(summary.threads.max))} / ${summary.latestSample ? escapeHtml(new Date(summary.latestSample.timestamp).toLocaleTimeString('zh-CN', { hour12: false })) : '-'}</div></div>
    </section>
    <section>
      <h2>趋势图</h2>
      <div class="trend-grid">${trendSvg}</div>
    </section>
    <section>
      <h2>采样明细</h2>
      <table>
        <thead><tr><th>时间</th><th>PID</th><th>内存</th><th>CPU</th><th>线程</th><th>电池温度（设备）</th><th>可用内存</th><th>可用CPU</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

async function exportReport(report: PerformanceReport, format: 'md' | 'html') {
  const baseName = sanitizeFileName(report.name);
  const electronApi = getElectronApi();
  const isMarkdown = format === 'md';
  const content = isMarkdown ? buildReportMarkdown(report) : buildReportHtml(report);
  const extension = isMarkdown ? 'md' : 'html';
  const result = await electronApi?.ipcRenderer?.invoke('file:save-text', {
    title: isMarkdown ? '导出 Markdown 报告' : '导出 HTML 报告',
    defaultPath: `${baseName}.${extension}`,
    content,
    filters: [
      {
        name: isMarkdown ? 'Markdown' : 'HTML',
        extensions: [extension],
      },
    ],
  }) as { success?: boolean; canceled?: boolean; filePath?: string; error?: string } | undefined;

  if (!result) {
    throw new Error('当前环境不支持保存文件');
  }

  if (result.canceled) {
    return null;
  }

  if (!result.success || !result.filePath) {
    throw new Error(result.error || '导出失败');
  }

  return result.filePath;
}

function summarize(values: Array<number | undefined>) {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (nums.length === 0) {
    return { avg: undefined, max: undefined, min: undefined };
  }

  return {
    avg: nums.reduce((sum, value) => sum + value, 0) / nums.length,
    max: Math.max(...nums),
    min: Math.min(...nums),
  };
}

function normalizeIpcError(error: unknown, action: string) {
  const message = error instanceof Error ? error.message : String(error || '未知错误');

  if (/No handler registered for 'performance:/.test(message)) {
    return `性能测试能力需要重启应用后生效，请重启 solopi-desktop 后再${action}`;
  }

  return message;
}

function getRange(points: Array<number | undefined>, floorAtZero = false) {
  const validValues = points.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (validValues.length === 0) {
    return { min: 0, max: 1 };
  }

  const min = floorAtZero ? 0 : Math.min(...validValues);
  const max = Math.max(...validValues);
  const padding = (max - min || Math.max(Math.abs(max), 1)) * 0.12;

  return {
    min: floorAtZero ? 0 : min - padding,
    max: max + padding,
  };
}

function getChartPoint(
  value: number | undefined,
  index: number,
  count: number,
  range: { min: number; max: number },
  chart: { left: number; top: number; width: number; height: number },
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const span = range.max - range.min || 1;
  const x = chart.left + (index / Math.max(count - 1, 1)) * chart.width;
  const y = chart.top + (1 - (value - range.min) / span) * chart.height;

  return { x, y };
}

function buildLinePath(
  points: Array<number | undefined>,
  range: { min: number; max: number },
  chart: { left: number; top: number; width: number; height: number },
) {
  let hasOpenSegment = false;
  const commands: string[] = [];

  points.forEach((value, index) => {
    const point = getChartPoint(value, index, points.length, range, chart);

    if (!point) {
      hasOpenSegment = false;
      return;
    }

    commands.push(`${hasOpenSegment ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
    hasOpenSegment = true;
  });

  return commands.join(' ');
}

function hasSampleMetrics(sample: PerformanceSample | undefined) {
  return Boolean(sample && (
    typeof sample.memoryKb === 'number'
    || typeof sample.cpuPercent === 'number'
    || typeof sample.threadCount === 'number'
    || typeof sample.batteryTemperatureC === 'number'
    || typeof sample.systemAvailableMemoryKb === 'number'
    || typeof sample.systemAvailableCpuPercent === 'number'
  ));
}

function findNearestMetricSampleIndex(samples: PerformanceSample[], preferredIndex: number) {
  if (samples.length === 0) {
    return 0;
  }

  const safeIndex = Math.min(Math.max(preferredIndex, 0), samples.length - 1);
  if (hasSampleMetrics(samples[safeIndex])) {
    return safeIndex;
  }

  for (let offset = 1; offset < samples.length; offset += 1) {
    const left = safeIndex - offset;
    const right = safeIndex + offset;

    if (left >= 0 && hasSampleMetrics(samples[left])) {
      return left;
    }

    if (right < samples.length && hasSampleMetrics(samples[right])) {
      return right;
    }
  }

  return safeIndex;
}

function formatAxisValue(value: number, unit: string) {
  if (unit === 'MB') {
    return `${value.toFixed(value >= 100 ? 0 : 1)}MB`;
  }

  if (unit === '%') {
    return `${value.toFixed(value >= 100 ? 0 : 1)}%`;
  }

  return value.toFixed(value >= 100 ? 0 : 1);
}

type MetricTrendKind = 'memory' | 'cpu' | 'threads' | 'temperature';

type MetricTrendConfig = {
  key: MetricTrendKind;
  label: string;
  unit: string;
  color: string;
  extraColor?: string;
  floorAtZero: boolean;
  getValue: (sample: PerformanceSample) => number | undefined;
  getExtraValue?: (sample: PerformanceSample) => number | undefined;
  formatValue: (value: number | undefined) => string;
  formatExtraValue?: (value: number | undefined) => string;
  extraLabel?: string;
};

const metricTrendConfigs: MetricTrendConfig[] = [
  {
    key: 'cpu',
    label: 'CPU',
    unit: '%',
    color: '#ea580c',
    extraColor: '#fdba74',
    floorAtZero: true,
    getValue: (sample) => sample.cpuPercent,
    getExtraValue: (sample) => sample.systemAvailableCpuPercent,
    formatValue: (value) => formatMetric(value, '%'),
    formatExtraValue: (value) => formatMetric(value, '%'),
    extraLabel: '可用 CPU',
  },
  {
    key: 'memory',
    label: '内存',
    unit: 'MB',
    color: '#0284c7',
    extraColor: '#7dd3fc',
    floorAtZero: true,
    getValue: (sample) => (typeof sample.memoryKb === 'number' ? sample.memoryKb / 1024 : undefined),
    getExtraValue: (sample) => (typeof sample.systemAvailableMemoryKb === 'number' ? sample.systemAvailableMemoryKb / 1024 : undefined),
    formatValue: (value) => (typeof value === 'number' ? `${value.toFixed(1)} MB` : '-'),
    formatExtraValue: (value) => (typeof value === 'number' ? `${value.toFixed(1)} MB` : '-'),
    extraLabel: '可用内存',
  },
  {
    key: 'threads',
    label: '线程',
    unit: '',
    color: '#059669',
    floorAtZero: false,
    getValue: (sample) => sample.threadCount,
    formatValue: (value) => formatMetric(value),
  },
  {
    key: 'temperature', label: '电池温度（设备）', unit: '°C', color: '#e11d48',
    floorAtZero: false,
    getValue: sample => sample.batteryTemperatureC,
    formatValue: value => formatMetric(value, ' °C'),
  },
];

function MetricTrendPanel({ config, samples }: { config: MetricTrendConfig; samples: PerformanceSample[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const width = 420;
  const height = 260;
  const chartLeft = 58;
  const chartRight = 14;
  const chartTop = 18;
  const chartBottom = 36;
  const chartWidth = width - chartLeft - chartRight;
  const chartHeight = height - chartTop - chartBottom;
  const values = samples.map(config.getValue);
  const extraValues = config.getExtraValue ? samples.map(config.getExtraValue) : [];
  const range = getRange([...values, ...extraValues], config.floorAtZero);
  const chart = { left: chartLeft, top: chartTop, width: chartWidth, height: chartHeight };
  const path = buildLinePath(values, range, chart);
  const extraPath = buildLinePath(extraValues, range, chart);
  const effectiveActiveIndex = findNearestMetricSampleIndex(
    samples,
    activeIndex !== null ? activeIndex : Math.max(samples.length - 1, 0),
  );
  const activeSample = activeIndex !== null ? samples[effectiveActiveIndex] : undefined;
  const activeValue = activeSample ? config.getValue(activeSample) : undefined;
  const activeExtraValue = activeSample && config.getExtraValue ? config.getExtraValue(activeSample) : undefined;

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!chartWrapperRef.current?.contains(event.target as Node)) {
        setActiveIndex(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [activeIndex]);

  const updateActiveIndex = (event: React.MouseEvent<SVGSVGElement>) => {
    if (samples.length === 0) {
      return;
    }

    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const svgX = ratio * width;
    const chartRatio = Math.min(1, Math.max(0, (svgX - chartLeft) / chartWidth));
    setActiveIndex(Math.round(chartRatio * Math.max(samples.length - 1, 0)));
  };

  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-black text-slate-700">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: config.color }} />
          {config.label}{config.unit ? ` ${config.unit}` : ''}
        </div>
        {config.extraLabel && (
          <div className="flex items-center gap-2 text-[11px] font-black text-slate-400">
            <span className="h-0.5 w-5 border-t-2 border-dashed border-slate-300" />
            {config.extraLabel}
          </div>
        )}
      </div>
      <div ref={chartWrapperRef} className="relative" onClick={() => setActiveIndex(null)}>
        {activeSample && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 min-w-40 rounded-xl border border-slate-200 bg-white/95 p-3 text-xs font-bold text-slate-600 shadow-xl shadow-slate-900/10">
            <div className="mb-2 font-mono text-[11px] font-black text-slate-900">
              {new Date(activeSample.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <span>{config.label}</span>
              <span className="text-right font-mono" style={{ color: config.color }}>{config.formatValue(activeValue)}</span>
              {config.extraLabel && (
                <>
                  <span>{config.extraLabel}</span>
                  <span className="text-right font-mono" style={{ color: config.extraColor }}>{config.formatExtraValue?.(activeExtraValue) || '-'}</span>
                </>
              )}
            </div>
          </div>
        )}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[260px] w-full cursor-crosshair overflow-visible rounded-lg bg-slate-50"
          onClick={updateActiveIndex}
        >
          {(() => {
            const ticks = [range.max, (range.max + range.min) / 2, range.min];

            return (
              <g>
                <line x1={chartLeft} x2={chartLeft} y1={chartTop} y2={chartTop + chartHeight} stroke="#cbd5e1" strokeWidth="1.5" />
                {ticks.map((tick, tickIndex) => {
                  const y = chartTop + tickIndex * (chartHeight / 2);
                  return (
                    <g key={`${config.key}-${tickIndex}`}>
                      <line x1={chartLeft} x2={width - chartRight} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                      <text x={chartLeft - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-bold">
                        {formatAxisValue(tick, config.unit)}
                      </text>
                    </g>
                  );
                })}
                {extraPath && config.extraColor ? (
                  <path d={extraPath} fill="none" stroke={config.extraColor} strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                ) : null}
                {path ? (
                  <path d={path} fill="none" stroke={config.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                ) : null}
                {activeSample && (() => {
                  const point = getChartPoint(values[effectiveActiveIndex], effectiveActiveIndex, samples.length, range, chart);
                  return point ? <circle cx={point.x} cy={point.y} r="4" fill="white" stroke={config.color} strokeWidth="3" /> : null;
                })()}
              </g>
            );
          })()}
          {activeSample && (
            <line
              x1={chartLeft + (effectiveActiveIndex / Math.max(samples.length - 1, 1)) * chartWidth}
              x2={chartLeft + (effectiveActiveIndex / Math.max(samples.length - 1, 1)) * chartWidth}
              y1={chartTop}
              y2={height - chartBottom}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
          )}
          {samples.map((sample, index) => {
            if (index % Math.ceil(samples.length / 4 || 1) !== 0) {
              return null;
            }

            const x = chartLeft + (index / Math.max(samples.length - 1, 1)) * chartWidth;
            return (
              <g key={`${sample.timestamp}-${index}`}>
                <line x1={x} x2={x} y1={height - chartBottom + 5} y2={height - chartBottom + 10} stroke="#cbd5e1" strokeWidth="1" />
                <text x={x} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px] font-bold">
                  {new Date(sample.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function TrendChart({ samples }: { samples: PerformanceSample[] }) {
  if (samples.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm font-bold text-slate-400">
        采样后展示内存、CPU、线程和电池温度趋势
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3">
      {metricTrendConfigs.map((config) => (
        <MetricTrendPanel key={config.key} config={config} samples={samples} />
      ))}
    </div>
  );
}

function MetricSummaryCards({ samples }: { samples: PerformanceSample[] }) {
  const latestSample = samples[samples.length - 1];
  const memorySummary = summarize(samples.map((item) => item.memoryKb));
  const cpuSummary = summarize(samples.map((item) => item.cpuPercent));
  const threadSummary = summarize(samples.map((item) => item.threadCount));
  const temperatureSummary = summarize(samples.map(item => item.batteryTemperatureC));
  const metricCards = [
    {
      label: 'CPU',
      value: formatMetric(latestSample?.cpuPercent, '%'),
      detail: `均值 ${formatMetric(cpuSummary.avg, '%')} / 峰值 ${formatMetric(cpuSummary.max, '%')} / 系统可用 ${formatMetric(latestSample?.systemAvailableCpuPercent, '%')}`,
      icon: Cpu,
      tone: 'text-amber-600 bg-amber-50 border-amber-100',
    },
    {
      label: '内存',
      value: formatMemory(latestSample?.memoryKb),
      detail: `均值 ${formatMemory(memorySummary.avg)} / 峰值 ${formatMemory(memorySummary.max)} / 系统可用 ${formatMemory(latestSample?.systemAvailableMemoryKb)}`,
      icon: HardDrive,
      tone: 'text-sky-600 bg-sky-50 border-sky-100',
    },
    {
      label: '线程',
      value: formatMetric(latestSample?.threadCount),
      detail: `均值 ${formatMetric(threadSummary.avg)} / 峰值 ${formatMetric(threadSummary.max)}`,
      icon: Activity,
      tone: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    },
    {
      label: '电池温度',
      value: formatMetric(latestSample?.batteryTemperatureC, ' °C'),
      detail: `设备电池 · 均值 ${formatMetric(temperatureSummary.avg, ' °C')} / 峰值 ${formatMetric(temperatureSummary.max, ' °C')}`,
      secondary: latestSample?.batteryError || `电量 ${formatMetric(latestSample?.batteryLevelPercent, '%')} · ${latestSample?.batteryPowered === undefined ? '供电状态未知' : latestSample.batteryPowered ? '外部供电已接入' : '电池供电'}`,
      icon: Thermometer,
      tone: 'text-rose-600 bg-rose-50 border-rose-100',
    },
  ];

  return (
    <section className="grid grid-cols-4 gap-3">
      {metricCards.map((card) => (
        <div key={card.label} className={`rounded-2xl border bg-white p-4 ${card.tone}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase tracking-[0.18em] opacity-75">{card.label}</div>
            <card.icon className="h-5 w-5" />
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">{card.value}</div>
          <div className="mt-2 text-xs font-bold text-slate-500">{card.detail}</div>
          {card.secondary && <div className="mt-1 text-xs text-slate-400">{card.secondary}</div>}
        </div>
      ))}
    </section>
  );
}

function SampleTable({ samples }: { samples: PerformanceSample[] }) {
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">时间</th>
            <th className="px-4 py-3">PID</th>
            <th className="px-4 py-3">内存</th>
            <th className="px-4 py-3">CPU</th>
            <th className="px-4 py-3">线程</th>
            <th className="px-4 py-3">电池温度（设备）</th>
            <th className="px-4 py-3">可用内存</th>
            <th className="px-4 py-3">可用CPU</th>
            <th className="px-4 py-3">状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {samples.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-16 text-center text-sm font-bold text-slate-400">点击开始后会按间隔采集性能数据</td>
            </tr>
          ) : samples.map((sample, index) => (
            <tr key={`${sample.timestamp}-${index}`} className="bg-white">
              <td className="px-4 py-3 font-mono text-slate-500">{new Date(sample.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</td>
              <td className="px-4 py-3 font-mono font-bold text-slate-700">{sample.pid || '-'}</td>
              <td className="px-4 py-3 font-bold text-slate-700">{formatMemory(sample.memoryKb)}</td>
              <td className="px-4 py-3 font-bold text-slate-700">{formatMetric(sample.cpuPercent, '%')}</td>
              <td className="px-4 py-3 font-bold text-slate-700">{formatMetric(sample.threadCount)}</td>
              <td className="px-4 py-3 font-bold text-slate-700" title={sample.batteryError}>{formatMetric(sample.batteryTemperatureC, ' °C')}</td>
              <td className="px-4 py-3 font-bold text-slate-500">{formatMemory(sample.systemAvailableMemoryKb)}</td>
              <td className="px-4 py-3 font-bold text-slate-500">{formatMetric(sample.systemAvailableCpuPercent, '%')}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${sample.error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {sample.error ? '失败' : '成功'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportSnapshot({ report }: { report: PerformanceReport }) {
  const [exportMessage, setExportMessage] = useState('');
  const [exportedPath, setExportedPath] = useState('');
  const memorySummary = summarize(report.samples.map((item) => item.memoryKb));
  const cpuSummary = summarize(report.samples.map((item) => item.cpuPercent));
  const threadSummary = summarize(report.samples.map((item) => item.threadCount));
  const systemMemorySummary = summarize(report.samples.map((item) => item.systemAvailableMemoryKb));
  const systemCpuSummary = summarize(report.samples.map((item) => item.systemAvailableCpuPercent));
  const failedCount = report.samples.filter((item) => item.error).length;
  const latestSample = report.samples[report.samples.length - 1];
  const handleExport = async (format: 'md' | 'html') => {
    try {
      setExportMessage('正在导出报告...');
      setExportedPath('');
      const filePath = await exportReport(report, format);

      if (!filePath) {
        setExportMessage('已取消导出');
        return;
      }

      setExportedPath(filePath);
      setExportMessage(`导出成功：${filePath}`);
    } catch (error) {
      setExportedPath('');
      setExportMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const openExportedFileLocation = async () => {
    if (!exportedPath) {
      return;
    }

    const electronApi = getElectronApi();
    await electronApi?.ipcRenderer?.invoke('shell:show-item-in-folder', exportedPath);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Readonly Report</div>
            <h3 className="mt-1 text-xl font-black text-slate-900">{report.name}</h3>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="text-right text-xs font-bold leading-5 text-slate-500">
              <div>{new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
              <div>{report.samples.length} 次采样 / 失败 {failedCount} 次</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleExport('md')}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <Download className="h-3.5 w-3.5" />
                Markdown
              </button>
              <button
                type="button"
                onClick={() => void handleExport('html')}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[11px] font-black text-white hover:bg-blue-700"
              >
                <Download className="h-3.5 w-3.5" />
                HTML
              </button>
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-xs font-bold leading-6 text-slate-600 lg:grid-cols-4">
          <div>设备：<span className="font-mono text-slate-900">{report.serial || '-'}</span></div>
          <div>包名：<span className="font-mono text-slate-900">{report.packageName || '-'}</span></div>
          <div>版本：<span className="font-mono text-slate-900">{report.packageVersion || '-'}</span></div>
          <div>系统：{report.runtime === 'android' ? 'Android / adb' : '鸿蒙 / hdc'}</div>
        </div>
        {exportMessage && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
            <span className="min-w-0 flex-1 truncate">{exportMessage}</span>
            {exportedPath && (
              <button
                type="button"
                onClick={() => void openExportedFileLocation()}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-[11px] font-black text-blue-600 ring-1 ring-slate-200 hover:bg-blue-50"
              >
                打开位置
              </button>
            )}
          </div>
        )}
      </div>

      <MetricSummaryCards samples={report.samples} />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-black uppercase tracking-wide text-slate-400">内存峰值 / 可用最低</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{formatMemory(memorySummary.max)} / {formatMemory(systemMemorySummary.min)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-black uppercase tracking-wide text-slate-400">CPU峰值 / 可用最低</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{formatMetric(cpuSummary.max, '%')} / {formatMetric(systemCpuSummary.min, '%')}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-black uppercase tracking-wide text-slate-400">线程峰值 / 最后采样</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{formatMetric(threadSummary.max)} / {latestSample ? new Date(latestSample.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '-'}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
        <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
          <div className="text-sm font-black text-slate-900">趋势图</div>
          <div className="text-xs font-bold text-slate-400">只读</div>
        </div>
        <div className="p-4">
          <TrendChart samples={report.samples} />
        </div>
      </div>

      <CrashSummary crashes={report.crashes} />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
        <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
          <div className="text-sm font-black text-slate-900">采样明细</div>
          <div className="text-xs font-bold text-slate-400">{report.samples.length} 条</div>
        </div>
        <SampleTable samples={report.samples} />
      </div>
    </div>
  );
}

export const PerformanceTestPage = ({ phoneSerial, phonePackage, view = 'task', onOpenReports }: PerformanceTestPageProps) => {
  const [runtime, setRuntime] = useState<DeviceRuntime>('android');
  const [serial, setSerial] = useState(phoneSerial);
  const [packageName, setPackageName] = useState(phonePackage);
  const [packageVersion, setPackageVersion] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [isRunning, setIsRunning] = useState(false);
  const [isSampling, setIsSampling] = useState(false);
  const [samples, setSamples] = useState<PerformanceSample[]>([]);
  const [message, setMessage] = useState('');
  const [devices, setDevices] = useState<PerformanceDevice[]>([]);
  const [packages, setPackages] = useState<string[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>('trend');
  const [reports, setReports] = useState<PerformanceReport[]>(() => loadStoredReports());
  const [selectedReportId, setSelectedReportId] = useState('');
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportName, setReportName] = useState('');
  const timerRef = useRef<number | null>(null);
  const crashSessionRef = useRef('');
  const crashStartRef = useRef<Promise<unknown> | null>(null);
  const generationRef = useRef(0);
  const crashPollRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const sampleBusyRef = useRef(false);
  const [crashes, setCrashes] = useState<CrashStats>();

  const pageTab = view;
  const selectedReport = reports.find((report) => report.id === selectedReportId) || reports[0];

  useEffect(() => {
    saveStoredReports(reports);
  }, [reports]);

  const refreshDevices = async () => {
    const electronApi = getElectronApi();

    if (!electronApi?.ipcRenderer) {
      setMessage('当前环境不支持 Electron 能力');
      return;
    }

    setIsLoadingDevices(true);
    try {
      const result = await electronApi.ipcRenderer.invoke('performance:list-devices', { runtime }) as PerformanceListDevicesResult;
      const nextDevices = result.devices || [];

      setDevices(nextDevices);
      if (result.error) {
        setMessage(`设备列表读取失败：${result.error}`);
      } else {
        setMessage(`${runtime === 'harmony' ? 'hdc list targets' : 'adb devices'} 读取到 ${nextDevices.length} 台设备`);
      }

      if (nextDevices.length > 0 && !nextDevices.some((item) => item.serial === serial)) {
        setSerial(nextDevices[0].serial);
      }
    } catch (error) {
      setDevices([]);
      setMessage(`设备列表读取失败：${normalizeIpcError(error, '读取设备列表')}`);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const refreshPackages = async () => {
    const electronApi = getElectronApi();
    const nextSerial = serial.trim();

    if (!electronApi?.ipcRenderer || !nextSerial) {
      setPackages([]);
      return;
    }

    setIsLoadingPackages(true);
    try {
      const result = await electronApi.ipcRenderer.invoke('performance:list-packages', {
        runtime,
        serial: nextSerial,
      }) as PerformanceListPackagesResult;
      const nextPackages = result.packages || [];

      setPackages(nextPackages);
      if (result.error) {
        setMessage(`包名列表读取失败：${result.error}`);
      }

      if (nextPackages.length > 0 && !nextPackages.includes(packageName)) {
        if (runtime === 'android' && phonePackage && nextPackages.includes(phonePackage)) {
          setPackageName(phonePackage);
        }
      }
    } catch (error) {
      setPackages([]);
      setMessage(`包名列表读取失败：${normalizeIpcError(error, '读取包名列表')}`);
    } finally {
      setIsLoadingPackages(false);
    }
  };

  const refreshPackageVersion = async () => {
    const electronApi = getElectronApi();
    const nextSerial = serial.trim();
    const nextPackage = packageName.trim();

    if (!electronApi?.ipcRenderer || !nextSerial || !nextPackage) {
      setPackageVersion('');
      return;
    }

    try {
      const result = await electronApi.ipcRenderer.invoke('performance:get-package-version', {
        runtime,
        serial: nextSerial,
        packageName: nextPackage,
      }) as PerformanceVersionResult;
      setPackageVersion(result.version || '');
    } catch (_error) {
      setPackageVersion('');
    }
  };

  useEffect(() => {
    if (runtime === 'android') {
      setSerial(phoneSerial);
      setPackageName(phonePackage);
    } else {
      setPackageName('');
    }
    setPackageVersion('');
    setPackages([]);
    void refreshDevices();
  }, [runtime]);

  useEffect(() => {
    void refreshPackages();
  }, [runtime, serial]);

  useEffect(() => {
    void refreshPackageVersion();
  }, [runtime, serial, packageName]);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false; generationRef.current++;
      stopTimer();
      if (crashPollRef.current !== null) window.clearInterval(crashPollRef.current);
      const id = crashSessionRef.current; crashSessionRef.current = '';
      if (id) void getElectronApi()?.ipcRenderer?.invoke('performance:crashes-stop', { id }).catch(() => {});
    };
  }, []);

  const collectSample = async () => {
    const electronApi = getElectronApi();

    if (!electronApi?.ipcRenderer) {
      setMessage('当前环境不支持 Electron 能力');
      return;
    }

    const nextSerial = serial.trim();
    const nextPackage = packageName.trim();

    if (!nextSerial || !nextPackage) {
      setMessage('请先填写设备 SN 和包名');
      return;
    }

    if (sampleBusyRef.current) return;
    sampleBusyRef.current = true;
    setIsSampling(true);
    try {
      const result = await electronApi.ipcRenderer.invoke('performance:sample', {
        runtime,
        serial: nextSerial,
        packageName: nextPackage,
      }) as PerformanceSampleResult;

      const nextSample = result.sample || {
        timestamp: new Date().toISOString(),
        serial: nextSerial,
        packageName: nextPackage,
        runtime,
        error: result.error || '采样失败',
      };

      setSamples((current) => [...current, nextSample]);
      setMessage(nextSample.error ? `采样失败：${nextSample.error}` : '采样成功');
    } catch (error) {
      const errorMessage = normalizeIpcError(error, '开始采样');
      setSamples((current) => [
        ...current,
        {
          timestamp: new Date().toISOString(),
          serial: nextSerial,
          packageName: nextPackage,
          runtime,
          error: errorMessage,
        },
      ]);
      setMessage(`采样失败：${errorMessage}`);
    } finally {
      sampleBusyRef.current = false;
      setIsSampling(false);
    }
  };

  const startCollecting = async () => {
    const electronApi = getElectronApi();
    if (!serial.trim() || !packageName.trim() || !electronApi?.ipcRenderer) {
      setMessage('请确认 Electron 环境，并填写设备 SN 和包名'); return;
    }
    const generation = ++generationRef.current;
    const seconds = Math.max(1, Number(intervalSeconds) || 5);
    setSamples([]); setCrashes(undefined); setMessage('正在开始采集...'); setIsRunning(true);
    try {
      crashStartRef.current = electronApi.ipcRenderer.invoke('performance:crashes-start', { runtime, serial: serial.trim(), packageName: packageName.trim() });
      const result = await crashStartRef.current as CrashStats & { id: string };
      if (!aliveRef.current || generation !== generationRef.current) {
        const final = await electronApi.ipcRenderer.invoke('performance:crashes-stop', { id: result.id }) as CrashStats;
        if (aliveRef.current) setCrashes(final);
        return;
      }
      crashSessionRef.current = result.id; setCrashes(result);
      crashPollRef.current = window.setInterval(() => {
        void electronApi.ipcRenderer.invoke('performance:crashes-get', { id: result.id }).then((value: unknown) => {
          if (crashSessionRef.current === result.id) setCrashes(value as CrashStats);
        }).catch((error: unknown) => {
          if (crashSessionRef.current === result.id) setCrashes(current => ({ ...current, count: current?.count || 0, events: current?.events || [], status: 'failed', error: String(error) }));
        });
      }, 1000);
      void collectSample(); stopTimer();
      timerRef.current = window.setInterval(() => void collectSample(), seconds * 1000);
    } catch (error) { setMessage(normalizeIpcError(error, '开始性能采集')); setIsRunning(false); }
  };

  const stopCollecting = async () => {
    generationRef.current++;
    stopTimer();
    if (crashPollRef.current !== null) window.clearInterval(crashPollRef.current);
    const id = crashSessionRef.current; crashSessionRef.current = '';
    try {
      await crashStartRef.current;
      if (id) setCrashes(await getElectronApi()?.ipcRenderer?.invoke('performance:crashes-stop', { id }) as CrashStats);
    } catch (error) {
      setCrashes(current => ({ ...current, count: current?.count || 0, events: current?.events || [], status: 'failed', error: String(error) }));
    }
    setIsRunning(false);
    setReportName(`性能报告 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    setIsReportDialogOpen(true); setMessage('采集已结束，请保存本次性能报告');
  };

  const saveCurrentReport = () => {
    const nextName = reportName.trim();

    if (!nextName) {
      setMessage('请输入报告名称');
      return;
    }

    const frozenReport: PerformanceReport = {
      id: createReportId(),
      name: nextName,
      createdAt: new Date().toISOString(),
      runtime,
      serial: serial.trim(),
      packageName: packageName.trim(),
      packageVersion,
      intervalSeconds: Math.max(1, Number(intervalSeconds) || 5),
      crashes: crashes ? JSON.parse(JSON.stringify(crashes)) : undefined,
      samples: samples.map((sample) => ({ ...sample, raw: sample.raw ? { ...sample.raw } : undefined })),
    };

    setReports((current) => [frozenReport, ...current]);
    setSelectedReportId(frozenReport.id);
    setIsReportDialogOpen(false);
    onOpenReports?.();
    setMessage(`已保存报告：${nextName}`);
  };

  const packageOptions = useMemo(() => {
    const optionSet = new Set(packages.filter(Boolean));
    if (runtime === 'android' && phonePackage) {
      optionSet.add(phonePackage);
    }
    return Array.from(optionSet);
  }, [packages, runtime, phonePackage]);

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-4">
      <div className="mx-auto flex w-full max-w-none flex-col gap-4">
        {pageTab === 'task' && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-blue-600">
                  <BarChart3 className="h-4 w-4" />
                  Performance Test
                </div>
                <h2 className="mt-1 text-xl font-black text-slate-900">性能任务</h2>
              </div>
              <div className="flex items-center gap-2">
                {isRunning && (
                  <div className="flex h-9 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 text-xs font-black text-blue-700">
                    {isSampling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TimerReset className="h-3.5 w-3.5" />}
                    {intervalSeconds}s 自动采样
                  </div>
                )}
                {isRunning ? (
                  <button type="button" onClick={stopCollecting} className="flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white hover:bg-slate-800">
                    <Square className="h-3.5 w-3.5 fill-current" />
                    结束
                  </button>
                ) : (
                  <button type="button" onClick={startCollecting} className="flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700">
                    <Play className="h-3.5 w-3.5 fill-current" />
                    开始
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[150px_minmax(0,1.1fr)_minmax(0,1.35fr)_minmax(10rem,0.7fr)_120px]">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">系统</span>
                <select value={runtime} onChange={(event) => setRuntime(event.target.value as DeviceRuntime)} disabled={isRunning} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-300 disabled:opacity-60">
                  <option value="android">Android / adb</option>
                  <option value="harmony">鸿蒙 / hdc</option>
                </select>
              </label>
              <label className="block min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">SN</span>
                <div className="mt-1 flex min-w-0 gap-2">
                  <PerformanceComboBox value={serial} onChange={setSerial} options={devices.map(device => ({ value: device.serial, label: [device.state, device.kind && device.kind !== 'unknown' ? device.kind : '', device.model || device.product || device.device || ''].filter(Boolean).join(' / ') }))} disabled={isRunning} label="设备 SN" placeholder="选择或输入设备 SN" />
                  <button type="button" onClick={() => void refreshDevices()} disabled={isRunning || isLoadingDevices} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50" title={runtime === 'harmony' ? '刷新 hdc list targets' : '刷新 adb devices'}>
                    <RefreshCw className={`h-4 w-4 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                  </button>
                </div>

              </label>
              <label className="block min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">包名 / 进程名</span>
                <div className="relative mt-1">
                  <PerformanceComboBox value={packageName} onChange={setPackageName} options={packageOptions.map(value => ({ value }))} disabled={isRunning} loading={isLoadingPackages} label="包名 / 进程名" placeholder="搜索或输入包名" />
                </div>
              </label>
              <div className="block min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">版本</span>
                <div className="mt-1 flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-sm font-bold text-slate-700">
                  <span className="truncate">{packageVersion || '-'}</span>
                </div>
              </div>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">间隔秒</span>
              <input type="number" min={1} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Math.max(1, Number(event.target.value || 1)))} disabled={isRunning} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-300 disabled:opacity-60" />
              </label>
            </div>

            {message && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                {message}
              </div>
            )}
          </section>
        )}

        {pageTab === 'task' ? (
          <>
            <MetricSummaryCards samples={samples} />
            <CrashSummary crashes={crashes} />

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
              <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
                <div className="flex items-center gap-2">
                  {[
                    ['trend', '趋势图'],
                    ['samples', '采样明细'],
                  ].map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setResultTab(id as ResultTab)} className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${resultTab === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-xs font-bold text-slate-400">{samples.length} 条</div>
              </div>
              {resultTab === 'trend' ? (
                <div className="p-4">
                  <TrendChart samples={samples} />
                </div>
              ) : (
                <SampleTable samples={samples} />
              )}
            </section>
          </>
        ) : (
          <section className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-900/5">
              <div className="flex h-9 items-center gap-2 px-2 text-sm font-black text-slate-900">
                <FileText className="h-4 w-4 text-blue-600" />
                性能报告
              </div>
              <div className="mt-2 space-y-2">
                {reports.length === 0 ? (
                  <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm font-bold text-slate-400">
                    结束一次采集后保存报告
                  </div>
                ) : reports.map((report) => {
                  const isSelected = selectedReport?.id === report.id;
                  return (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedReportId(report.id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${isSelected ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-white hover:bg-slate-50'}`}
                    >
                      <div className="truncate text-xs font-black text-slate-900">{report.name}</div>
                      <div className="mt-1 text-[11px] font-bold text-slate-500">{new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
                      <div className="mt-1 truncate font-mono text-[10px] font-bold text-slate-400">{report.packageName || '-'}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedReport ? (
              <ReportSnapshot report={selectedReport} />
            ) : (
              <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-sm font-bold text-slate-400">
                暂无性能报告
              </div>
            )}
          </section>
        )}
      </div>

      {isReportDialogOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-950/25">
            <div className="text-lg font-black text-slate-900">保存性能报告</div>
            <div className="mt-2 text-xs font-bold leading-5 text-slate-500">
              本次采集数据会固化为只读报告，后续只能在性能报告 tab 查看。
            </div>
            <label className="mt-4 block">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">报告名称</span>
              <input
                value={reportName}
                onChange={(event) => setReportName(event.target.value)}
                autoFocus
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-300 focus:bg-white"
                placeholder="请输入报告名称"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsReportDialogOpen(false)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveCurrentReport}
                className="h-10 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700"
              >
                保存报告
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
