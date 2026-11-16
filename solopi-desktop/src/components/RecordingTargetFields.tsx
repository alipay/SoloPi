import { useEffect, useState } from 'react';
import { DeviceSerialSelect, PackageSelect } from './DeviceSelectors';

type Target = { serial: string; packageName: string };
export default function RecordingTargetFields({ api, target, runtime, excludedSerial, disabled, onChange }: {
  api: { ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<any> } } | null; target: Target; runtime: 'android' | 'harmony'; excludedSerial?: string;
  disabled: boolean; onChange: (target: Target) => void;
}) {
  const [devices, setDevices] = useState<{ serial: string; model?: string; kind?: string; state: string }[]>([]);
  const [packages, setPackages] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api?.ipcRenderer.invoke('performance:list-devices', { runtime });
        if (!active) return;
        if (!result || result.error) throw Error(result?.error || '无法读取手机列表');
        setDevices((result.devices || []).filter((d: { state: string; serial: string; kind?: string }) => d.state === 'device' && d.kind !== 'glasses' && d.serial !== excludedSerial));
        setError('');
      } catch (e) { if (active) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [api, runtime, excludedSerial]);
  useEffect(() => {
    let active = true; setPackages([]);
    if (target.serial) void api?.ipcRenderer.invoke('performance:list-packages', { runtime, serial: target.serial }).then(result => {
      if (!active) return;
      if (result?.error) setError(result.error); else setPackages(result?.packages || []);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [api, runtime, target.serial]);
  const options = devices.map(d => ({ value: d.serial, label: d.model ? `${d.serial} / ${d.model}` : d.serial }));
  if (target.serial && !options.some(o => o.value === target.serial)) options.unshift({ value: target.serial, label: `${target.serial}（等待连接确认）` });
  return <div className="grid gap-3 sm:grid-cols-2">
    <div className="min-w-0"><p className="mb-1 text-xs font-bold">手机 SN</p><DeviceSerialSelect value={target.serial} options={options} onChange={serial => onChange({ ...target, serial })} disabled={disabled} placeholder="请选择在线手机" /></div>
    <div className="min-w-0"><p className="mb-1 text-xs font-bold">启动应用包名</p><PackageSelect selectedPackage={target.packageName} packageOptions={[...new Set([target.packageName, ...packages].filter(Boolean))]} onPackageChange={packageName => onChange({ ...target, packageName })} packageListId="recording-package-options" disabled={disabled} /></div>
    {error && <p role="status" className="text-xs text-amber-700 sm:col-span-2">{error}</p>}
  </div>;
}
