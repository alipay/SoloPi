import DeviceRuntimeSelect from './DeviceRuntimeSelect';
import CopyValueButton from './CopyValueButton';
import { DeviceSerialSelect, PackageSelect } from './DeviceSelectors';
import { Dispatch, DragEvent, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Smartphone, MonitorSmartphone, ChevronDown, Download, LoaderCircle, RefreshCw, FileText, Square, X, CircleAlert, CircleCheckBig, Info } from 'lucide-react';

interface DeviceProps {
  type: 'Phone' | 'Glasses';
  title: string;
  defaultPackage: string;
  runtime: DeviceRuntime;
  devices: AdbDevice[];
  selectedSerial: string;
  selectedPackage: string;
  packages: string[];
  version: string;
  onRuntimeChange: (runtime: DeviceRuntime) => void;
  onSerialChange: (serial: string) => void;
  onPackageChange: (packageName: string) => void;
  onRefresh: () => void;
  onToggleLogcat: () => void;
  onMirrorScreen: () => void;
  onChooseApk: () => void;
  onDropApk: (file: File) => void;
  isInstallingApk: boolean;
  isLogcatRunning: boolean;
}

type DeviceKind = 'phone' | 'glasses' | 'unknown';
type DeviceRuntime = 'android' | 'harmony';

interface AdbDevice {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  device?: string;
  manufacturer?: string;
  kind?: DeviceKind;
}

interface AdbListResult {
  devices: AdbDevice[];
  error?: string;
}

interface AdbPackageResult {
  packages: string[];
  error?: string;
}

interface AdbVersionResult {
  version: string;
  error?: string;
}

interface AdbLogcatResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

interface ScrcpyResult {
  success: boolean;
  missingScrcpy?: boolean;
  scrcpyPath?: string;
  installCommand?: string;
  tutorialUrl?: string;
  error?: string;
}

interface ApkDialogResult {
  success: boolean;
  canceled?: boolean;
  path?: string;
}

interface ApkVersion { versionName?: string; versionCode?: string; }
interface ApkInstallResult {
  packageName?: string;
  currentVersion?: ApkVersion | null;
  targetVersion?: ApkVersion | null;
  androidErrorCode?: string;
  technicalDetails?: string;
  metadataErrors?: string[];
  success: boolean;
  fileName?: string;
  error?: string;
  errorCode?: string;
  recoveryActions?: string[];
}

interface LogcatDialogState {
  installFailure?: ApkInstallResult;
  open: boolean;
  title: string;
  message: string;
  tone?: 'error' | 'success' | 'info';
  guidance?: string[];
  filePath?: string;
  installCommand?: string;
  tutorialUrl?: string;
}

interface DeviceHeaderProps {
  refreshKey?: number;
  onPhoneSerialChange?: (serial: string) => void;
  onGlassesSerialChange?: (serial: string) => void;
  onPhonePackageChange?: (packageName: string) => void;
  onGlassesPackageChange?: (packageName: string) => void;
  onPhoneRuntimeChange?: (runtime: DeviceRuntime) => void;
  onGlassesRuntimeChange?: (runtime: DeviceRuntime) => void;
  deviceBindings?: {
    phoneSerials?: string[];
    glassesSerials?: string[];
    phoneDefaultPackage?: string;
    glassesDefaultPackage?: string;
  };
}

declare global {
  interface Window {
    require?: (moduleName: string) => any;
    glassbox?: any;
  }
}

const fallbackPhonePackage = '';
const fallbackGlassesPackage = '';

function getElectronApi() {
  try {
    return window.glassbox;
  } catch (_error) {
    return null;
  }
}

function getDeviceLabel(device: AdbDevice) {
  const model = device.model || device.product || device.device;

  if (!model) {
    return device.serial;
  }

  return `${device.serial} / ${model}`;
}

function getPackagesWithDefault(packages: string[], defaultPackage: string) {
  const packageSet = new Set(packages.filter(Boolean));

  if (defaultPackage) {
    packageSet.add(defaultPackage);
  }

  return Array.from(packageSet);
}

const DeviceCard = ({
  type,
  title,
  defaultPackage,
  runtime,
  devices,
  selectedSerial,
  selectedPackage,
  packages,
  version,
  onRuntimeChange,
  onSerialChange,
  onPackageChange,
  onRefresh,
  onToggleLogcat,
  onMirrorScreen,
  onChooseApk,
  onDropApk,
  isInstallingApk,
  isLogcatRunning,
}: DeviceProps) => {
  const isPhone = type === 'Phone';
  const packageOptions = getPackagesWithDefault(packages, defaultPackage);
  const dragDepthRef = useRef(0);
  const [isApkDragActive, setIsApkDragActive] = useState(false);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (isInstallingApk || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsApkDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isInstallingApk || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsApkDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsApkDragActive(false);
    if (isInstallingApk) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) onDropApk(files[0]);
  };

  return (
    <div
      className={`device-header-card relative flex-1 min-w-0 overflow-visible rounded-2xl border px-4 py-2 flex flex-col gap-2 transition-colors ${
        isApkDragActive
          ? isPhone ? 'border-blue-400 bg-blue-50/80' : 'border-emerald-400 bg-emerald-50/80'
          : 'border-border/50 bg-card/40 hover:bg-card/60'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isApkDragActive && !isInstallingApk && (
        <div className={`pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xl border-2 border-dashed backdrop-blur-sm ${
          isPhone
            ? 'border-blue-400 bg-blue-50/95 text-blue-700'
            : 'border-emerald-400 bg-emerald-50/95 text-emerald-700'
        }`}>
          <div className="flex items-center gap-2 text-xs font-bold">
            <Download className="h-4 w-4" />
            <span>{`松开后安装到${isPhone ? '手机' : '眼镜'}设备`}</span>
          </div>
        </div>
      )}
      {isInstallingApk && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className={`pointer-events-none absolute inset-1 z-20 flex items-center justify-center overflow-hidden rounded-xl border backdrop-blur-sm ${
            isPhone
              ? 'border-blue-200 bg-blue-50/95 text-blue-700'
              : 'border-emerald-200 bg-emerald-50/95 text-emerald-700'
          }`}
        >
          <div className={`absolute h-24 w-24 rounded-full opacity-40 blur-2xl motion-safe:animate-pulse ${
            isPhone ? 'bg-blue-300' : 'bg-emerald-300'
          }`} />
          <div className="relative flex items-center gap-3">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full border bg-white/80 shadow-sm ${
              isPhone ? 'border-blue-200' : 'border-emerald-200'
            }`}>
              <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-xs font-bold">
                <span>正在安装 APK</span>
                <span className="flex items-end gap-0.5" aria-hidden="true">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="h-1 w-1 rounded-full bg-current motion-safe:animate-bounce"
                      style={{ animationDelay: `${dot * 140}ms` }}
                    />
                  ))}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] font-medium opacity-70">正在发送到设备，请勿断开连接</p>
            </div>
          </div>
        </div>
      )}
      <div className="device-header-toolbar flex h-7 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {type === 'Phone' ? (
            <Smartphone className="w-4 h-4 text-blue-400" />
          ) : (
            <MonitorSmartphone className="w-4 h-4 text-emerald-400" />
          )}
          <span className="truncate text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        </div>
        {isPhone && (
          <div className="flex shrink-0 items-center gap-1.5">
            <DeviceRuntimeSelect value={runtime} onChange={onRuntimeChange} label={`${isPhone ? '手机' : '眼镜'}系统`} />
            <button
              type="button"
              onClick={onChooseApk}
              disabled={isInstallingApk}
              className="nodrag h-7 w-7 rounded-full border border-slate-200 bg-white text-muted-foreground hover:text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors flex items-center justify-center"
              title="选择 APK 并安装到手机"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onMirrorScreen}
              className="nodrag h-7 w-7 rounded-full border border-slate-200 bg-white text-muted-foreground hover:text-foreground hover:bg-slate-50 transition-colors flex items-center justify-center"
              title="投屏手机屏幕"
            >
              <MonitorSmartphone className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleLogcat}
              className={`nodrag h-7 w-7 rounded-full border transition-colors flex items-center justify-center ${
                isLogcatRunning
                  ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                  : 'border-slate-200 bg-white text-muted-foreground hover:text-foreground hover:bg-slate-50'
              }`}
              title={isLogcatRunning ? '停止采集手机日志' : '开始采集手机日志'}
            >
              {isLogcatRunning ? <Square className="w-3 h-3 fill-current" /> : <FileText className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="nodrag h-7 w-7 rounded-full border border-slate-200 bg-white text-muted-foreground hover:text-foreground hover:bg-slate-50 transition-colors flex items-center justify-center"
              title="刷新手机信息"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {!isPhone && (
          <div className="flex shrink-0 items-center gap-1.5">
            <DeviceRuntimeSelect value={runtime} onChange={onRuntimeChange} label={`${isPhone ? '手机' : '眼镜'}系统`} />
            <button
              type="button"
              onClick={onChooseApk}
              disabled={isInstallingApk}
              className="nodrag h-7 w-7 rounded-full border border-slate-200 bg-white text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors flex items-center justify-center"
              title="选择 APK 并安装到眼镜"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onMirrorScreen}
              className="nodrag h-7 w-7 rounded-full border border-slate-200 bg-white text-muted-foreground hover:text-foreground hover:bg-slate-50 transition-colors flex items-center justify-center"
              title="投屏眼镜屏幕"
            >
              <MonitorSmartphone className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleLogcat}
              className={`nodrag h-7 w-7 rounded-full border transition-colors flex items-center justify-center ${
                isLogcatRunning
                  ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                  : 'border-slate-200 bg-white text-muted-foreground hover:text-foreground hover:bg-slate-50'
              }`}
              title={isLogcatRunning ? '停止采集眼镜日志' : '开始采集眼镜日志'}
            >
              {isLogcatRunning ? <Square className="w-3 h-3 fill-current" /> : <FileText className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="nodrag h-7 w-7 rounded-full border border-slate-200 bg-white text-muted-foreground hover:text-foreground hover:bg-slate-50 transition-colors flex items-center justify-center"
              title="刷新眼镜信息"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="device-header-fields grid gap-2 items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex h-5 items-center gap-1"><label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">SN</label><CopyValueButton value={selectedSerial} label={`${isPhone ? '手机' : '眼镜'} SN`} /></div>
          <DeviceSerialSelect value={selectedSerial} options={devices.map(device => ({ value: device.serial, label: getDeviceLabel(device) }))} onChange={onSerialChange} />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex h-5 items-center gap-1"><label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">Package</label><CopyValueButton value={selectedPackage} label={`${isPhone ? '手机' : '眼镜'}包名`} /></div>
          <PackageSelect selectedPackage={selectedPackage} packageOptions={packageOptions} onPackageChange={onPackageChange} packageListId={`${type.toLowerCase()}-package-options`} />
        </div>

        <div className="device-header-version flex min-w-0 flex-col gap-1">
          <div className="flex h-5 items-center gap-1"><label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">Version</label><CopyValueButton value={version} label={`${isPhone ? '手机' : '眼镜'}版本`} /></div>
          <div className="h-8 bg-secondary/30 border border-border/30 rounded-xl px-3 text-[12px] font-mono text-foreground/80 flex items-center">
            <span className="truncate" title={version || '未获取版本'}>{version || '-'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

function isDeviceSuitableForSlot(device: AdbDevice | undefined, slot: 'phone' | 'glasses') {
  if (!device) {
    return false;
  }

  return device.kind === slot;
}

export const DeviceHeader = ({
  refreshKey = 0,
  onPhoneSerialChange,
  onGlassesSerialChange,
  onPhonePackageChange,
  onGlassesPackageChange,
  onPhoneRuntimeChange,
  onGlassesRuntimeChange,
  deviceBindings,
}: DeviceHeaderProps) => {
  const [phoneDevices, setPhoneDevices] = useState<AdbDevice[]>([]);
  const [glassesDevices, setGlassesDevices] = useState<AdbDevice[]>([]);
  const [phoneRuntime, setPhoneRuntime] = useState<DeviceRuntime>('android');
  const [glassesRuntime, setGlassesRuntime] = useState<DeviceRuntime>('android');
  const [phoneSerial, setPhoneSerial] = useState('');
  const [glassesSerial, setGlassesSerial] = useState('');
  const [phonePackages, setPhonePackages] = useState<string[]>([]);
  const [glassesPackages, setGlassesPackages] = useState<string[]>([]);
  const phoneDefaultPackage = deviceBindings?.phoneDefaultPackage?.trim() || fallbackPhonePackage;
  const glassesDefaultPackage = deviceBindings?.glassesDefaultPackage?.trim() || fallbackGlassesPackage;
  const [phonePackage, setPhonePackage] = useState(phoneDefaultPackage);
  const [glassesPackage, setGlassesPackage] = useState(glassesDefaultPackage);
  const [phoneVersion, setPhoneVersion] = useState('');
  const [glassesVersion, setGlassesVersion] = useState('');
  const [phoneLogcatRunning, setPhoneLogcatRunning] = useState(false);
  const [glassesLogcatRunning, setGlassesLogcatRunning] = useState(false);
  const [apkInstalling, setApkInstalling] = useState({ phone: false, glasses: false });
  const [logcatDialog, setLogcatDialog] = useState<LogcatDialogState>({
    open: false,
    title: '',
    message: '',
  });
  const packageLoadRequestRef = useRef({ phone: 0, glasses: 0 });
  const manualSerialSelectionRef = useRef({ phone: false, glasses: false });
  const fixedPhoneSerials = useMemo(() => new Set(deviceBindings?.phoneSerials || []), [deviceBindings?.phoneSerials?.join(',')]);
  const fixedGlassesSerials = useMemo(() => new Set(deviceBindings?.glassesSerials || []), [deviceBindings?.glassesSerials?.join(',')]);
  const phoneCandidateDevices = useMemo(
    () => phoneDevices.filter((device) => !fixedGlassesSerials.has(device.serial)),
    [phoneDevices, fixedGlassesSerials]
  );
  const glassesCandidateDevices = useMemo(
    () => glassesDevices.filter((device) => !fixedPhoneSerials.has(device.serial)),
    [glassesDevices, fixedPhoneSerials]
  );

  const invoke = async <T,>(channel: string, ...args: any[]): Promise<T | null> => {
    const electronApi = getElectronApi();

    if (!electronApi?.ipcRenderer) {
      return null;
    }

    return electronApi.ipcRenderer.invoke(channel, ...args) as Promise<T>;
  };

  useEffect(() => {
    const electronApi = getElectronApi();

    if (!electronApi?.ipcRenderer) {
      return undefined;
    }

    const handleLogcatState = (_event: unknown, payload: { deviceType?: 'phone' | 'glasses'; running?: boolean }) => {
      if (payload.deviceType === 'phone') {
        setPhoneLogcatRunning(Boolean(payload.running));
      }

      if (payload.deviceType === 'glasses') {
        setGlassesLogcatRunning(Boolean(payload.running));
      }
    };

    electronApi.ipcRenderer.on('adb:logcat-state', handleLogcatState);

    return () => {
      electronApi.ipcRenderer.removeListener('adb:logcat-state', handleLogcatState);
    };
  }, []);

  const loadPackages = async (
    runtime: DeviceRuntime,
    serial: string,
    defaultPackage: string,
    setPackages: (packages: string[]) => void,
    setPackage: Dispatch<SetStateAction<string>>,
    resetToDefault = false,
    slot?: 'phone' | 'glasses'
  ) => {
    const requestId = slot ? packageLoadRequestRef.current[slot] + 1 : 0;

    if (slot) {
      packageLoadRequestRef.current[slot] = requestId;
    }

    if (!serial) {
      setPackages([]);
      setPackage(defaultPackage);
      return defaultPackage;
    }

    const result = await invoke<AdbPackageResult>('performance:list-packages', {
      runtime,
      serial,
    });
    const nextPackages = result?.packages || [];

    if (slot && packageLoadRequestRef.current[slot] !== requestId) {
      return defaultPackage;
    }

    const nextPackage = resetToDefault
      ? nextPackages.includes(defaultPackage) ? defaultPackage : nextPackages[0] || defaultPackage
      : nextPackages[0] || defaultPackage;

    setPackages(nextPackages);
    setPackage((current) => {
      if (resetToDefault) {
        return nextPackage;
      }

      if (nextPackages.includes(current)) {
        return current;
      }

      if (nextPackages.includes(defaultPackage)) {
        return defaultPackage;
      }

      return nextPackages[0] || defaultPackage;
    });

    return nextPackage;
  };

  const loadPackageVersion = async (
    runtime: DeviceRuntime,
    serial: string,
    packageName: string,
    setVersion: (version: string) => void
  ) => {
    if (!serial || !packageName) {
      setVersion('');
      return;
    }

    const result = await invoke<AdbVersionResult>('performance:get-package-version', {
      runtime,
      serial,
      packageName,
    });

    setVersion(result?.version || '');
  };

  const loadDevices = async (slot: 'phone' | 'glasses', runtime: DeviceRuntime) => {
    const result = await invoke<AdbListResult>('performance:list-devices', { runtime });
    const nextDevices = result?.devices || [];
    const nextPhoneCandidates = nextDevices.filter((device) => !fixedGlassesSerials.has(device.serial));
    const nextGlassesCandidates = nextDevices.filter((device) => !fixedPhoneSerials.has(device.serial));
    const fixedPhone = nextDevices.find((device) => fixedPhoneSerials.has(device.serial));
    const fixedGlasses = nextDevices.find((device) => fixedGlassesSerials.has(device.serial));
    const detectedPhone = nextPhoneCandidates.find((device) => device.kind === 'phone');
    const detectedGlasses = nextGlassesCandidates.find((device) => device.kind === 'glasses');
    const firstPhone = fixedPhone || detectedPhone || nextPhoneCandidates[0];
    const firstGlasses = fixedGlasses || detectedGlasses || nextGlassesCandidates[0];

    if (slot === 'phone') {
      setPhoneDevices(nextDevices);
      setPhoneSerial((current) => {
        const currentDevice = nextPhoneCandidates.find((device) => device.serial === current);
        if (manualSerialSelectionRef.current.phone && currentDevice) {
          return current;
        }

        if (manualSerialSelectionRef.current.phone && !currentDevice) {
          manualSerialSelectionRef.current.phone = false;
        }

        if (fixedPhone?.serial) {
          return fixedPhone.serial;
        }

        if (isDeviceSuitableForSlot(currentDevice, 'phone')) {
          return current;
        }

        return detectedPhone?.serial || currentDevice?.serial || firstPhone?.serial || '';
      });
      return;
    }

    setGlassesDevices(nextDevices);
    setGlassesSerial((current) => {
      const currentDevice = nextGlassesCandidates.find((device) => device.serial === current);
      if (manualSerialSelectionRef.current.glasses && currentDevice) {
        return current;
      }

      if (manualSerialSelectionRef.current.glasses && !currentDevice) {
        manualSerialSelectionRef.current.glasses = false;
      }

      if (fixedGlasses?.serial) {
        return fixedGlasses.serial;
      }

      if (isDeviceSuitableForSlot(currentDevice, 'glasses')) {
        return current;
      }

      return detectedGlasses?.serial || currentDevice?.serial || firstGlasses?.serial || '';
    });
  };

  useEffect(() => {
    void loadDevices('phone', phoneRuntime);
    const timer = window.setInterval(() => {
      void loadDevices('phone', phoneRuntime);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [refreshKey, phoneRuntime, deviceBindings?.phoneSerials?.join(','), deviceBindings?.glassesSerials?.join(',')]);

  useEffect(() => {
    void loadDevices('glasses', glassesRuntime);
    const timer = window.setInterval(() => {
      void loadDevices('glasses', glassesRuntime);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [refreshKey, glassesRuntime, deviceBindings?.phoneSerials?.join(','), deviceBindings?.glassesSerials?.join(',')]);

  useEffect(() => {
    void loadPackages(phoneRuntime, phoneSerial, phoneDefaultPackage, setPhonePackages, setPhonePackage, true, 'phone');
  }, [phoneRuntime, phoneSerial, phoneDefaultPackage]);

  useEffect(() => {
    void loadPackages(glassesRuntime, glassesSerial, glassesDefaultPackage, setGlassesPackages, setGlassesPackage, true, 'glasses');
  }, [glassesRuntime, glassesSerial, glassesDefaultPackage]);

  useEffect(() => {
    void loadPackageVersion(phoneRuntime, phoneSerial, phonePackage, setPhoneVersion);
  }, [phoneRuntime, phoneSerial, phonePackage]);

  useEffect(() => {
    void loadPackageVersion(glassesRuntime, glassesSerial, glassesPackage, setGlassesVersion);
  }, [glassesRuntime, glassesSerial, glassesPackage]);

  useEffect(() => {
    onGlassesSerialChange?.(glassesSerial);
  }, [glassesSerial, onGlassesSerialChange]);

  useEffect(() => {
    onPhoneSerialChange?.(phoneSerial);
  }, [phoneSerial, onPhoneSerialChange]);

  useEffect(() => {
    onPhonePackageChange?.(phonePackage);
  }, [phonePackage, onPhonePackageChange]);

  useEffect(() => {
    onGlassesPackageChange?.(glassesPackage);
  }, [glassesPackage, onGlassesPackageChange]);

  useEffect(() => {
    onPhoneRuntimeChange?.(phoneRuntime);
  }, [phoneRuntime, onPhoneRuntimeChange]);

  useEffect(() => {
    onGlassesRuntimeChange?.(glassesRuntime);
  }, [glassesRuntime, onGlassesRuntimeChange]);

  const refreshPhoneInfo = async () => {
    await loadDevices('phone', phoneRuntime);
    const nextPhonePackage = await loadPackages(phoneRuntime, phoneSerial, phoneDefaultPackage, setPhonePackages, setPhonePackage, true, 'phone');
    await loadPackageVersion(phoneRuntime, phoneSerial, nextPhonePackage, setPhoneVersion);
  };

  const refreshGlassesInfo = async () => {
    await loadDevices('glasses', glassesRuntime);
    const nextGlassesPackage = await loadPackages(glassesRuntime, glassesSerial, glassesDefaultPackage, setGlassesPackages, setGlassesPackage, true, 'glasses');
    await loadPackageVersion(glassesRuntime, glassesSerial, nextGlassesPackage, setGlassesVersion);
  };

  const installApk = async (slot: 'phone' | 'glasses', apkPath: string) => {
    const isPhone = slot === 'phone';
    const runtime = isPhone ? phoneRuntime : glassesRuntime;
    const serial = isPhone ? phoneSerial : glassesSerial;
    const deviceName = isPhone ? '手机' : '眼镜';
    if (runtime !== 'android') {
      setLogcatDialog({
        open: true,
        title: '无法安装 APK',
        message: `APK 只能安装到 Android 设备，请先把${deviceName}系统切换为 Android。`,
      });
      return;
    }
    if (!serial) {
      setLogcatDialog({
        open: true,
        title: '无法安装 APK',
        message: `请先选择在线的${deviceName}设备。`,
      });
      return;
    }
    if (!/\.apk$/i.test(apkPath)) {
      setLogcatDialog({
        open: true,
        title: '文件格式不支持',
        message: '仅支持安装单个 .apk 文件。',
      });
      return;
    }

    setApkInstalling((current) => ({ ...current, [slot]: true }));
    try {
      const result = await invoke<ApkInstallResult>('adb:install-apk', {
        runtime,
        serial,
        apkPath,
        deviceType: slot,
      });
      if (!result?.success) {
        setLogcatDialog({
          open: true,
          title: `${deviceName}装包失败`,
          message: result?.error || 'APK 安装失败，请检查设备连接后重试。',
          tone: 'error',
          guidance: result?.recoveryActions?.filter(Boolean),
          installFailure: result || undefined,
        });
        return;
      }
      if (isPhone) await refreshPhoneInfo();
      else await refreshGlassesInfo();
      setLogcatDialog({
        open: true,
        title: `${deviceName}装包成功`,
        message: `${result.fileName || 'APK'} 已安装到设备 ${serial}。`,
        tone: 'success',
      });
    } catch (error) {
      setLogcatDialog({
        open: true,
        title: `${deviceName}装包失败`,
        message: '装包服务暂时不可用，请稍后重试。',
        tone: 'error',
        guidance: ['确认设备仍保持连接，然后返回 solopi-desktop 刷新设备。'],
      });
    } finally {
      setApkInstalling((current) => ({ ...current, [slot]: false }));
    }
  };

  const chooseAndInstallApk = async (slot: 'phone' | 'glasses') => {
    const serial = slot === 'phone' ? phoneSerial : glassesSerial;
    if (!serial) {
      setLogcatDialog({
        open: true,
        title: '无法安装 APK',
        message: `请先选择在线的${slot === 'phone' ? '手机' : '眼镜'}设备。`,
      });
      return;
    }
    const result = await invoke<ApkDialogResult>('dialog:select-apk-file');
    if (!result?.success || !result.path) return;
    await installApk(slot, result.path);
  };

  const installDroppedApk = async (slot: 'phone' | 'glasses', file: File) => {
    if (!/\.apk$/i.test(file.name)) {
      setLogcatDialog({
        open: true,
        title: '文件格式不支持',
        message: '请拖入单个 .apk 文件。',
      });
      return;
    }
    const electronApi = getElectronApi();
    const filePath = electronApi?.webUtils?.getPathForFile?.(file)
      || (file as File & { path?: string }).path
      || '';
    if (!filePath) {
      setLogcatDialog({
        open: true,
        title: '无法读取 APK',
        message: '没有获取到本地文件路径，请改用顶部按钮选择 APK。',
      });
      return;
    }
    await installApk(slot, filePath);
  };

  const handlePhoneSerialChange = (serial: string) => {
    manualSerialSelectionRef.current.phone = true;
    setPhoneSerial(serial);
  };

  const handleGlassesSerialChange = (serial: string) => {
    manualSerialSelectionRef.current.glasses = true;
    setGlassesSerial(serial);
  };

  const toggleLogcat = async (
    serial: string,
    deviceType: 'phone' | 'glasses',
    isRunning: boolean,
    setIsRunning: Dispatch<SetStateAction<boolean>>
  ) => {
    if (!serial) {
      setLogcatDialog({
        open: true,
        title: '操作失败',
        message: '请先选择设备',
      });
      return;
    }

    const channel = isRunning ? 'adb:logcat-stop' : 'adb:logcat-start';
    const result = await invoke<AdbLogcatResult>(channel, { serial, deviceType });

    if (!result?.success) {
      if (isRunning) {
        setIsRunning(false);
      }

      setLogcatDialog({
        open: true,
        title: isRunning ? '停止采集失败' : '开始采集失败',
        message: result?.error || '日志采集操作失败',
      });
      return;
    }

    setIsRunning(!isRunning);

    if (isRunning) {
      setLogcatDialog({
        open: true,
        title: '日志已保存',
        message: '日志采集已停止，文件已保存到本机。',
        filePath: result.filePath,
      });
    }
  };

  const startScrcpy = async (serial: string, deviceName: string) => {
    if (!serial) {
      setLogcatDialog({
        open: true,
        title: '无法投屏',
        message: `请先选择${deviceName}设备。`,
      });
      return;
    }

    const result = await invoke<ScrcpyResult>('adb:scrcpy-start', { serial });

    if (result?.success) {
      setLogcatDialog({
        open: true,
        title: '投屏已启动',
        message: `已通过 scrcpy 打开${deviceName}屏幕。`,
      });
      return;
    }

    if (result?.missingScrcpy) {
      setLogcatDialog({
        open: true,
        title: '未安装 scrcpy',
        message: '当前电脑未检测到 scrcpy。请先安装 scrcpy 后再使用投屏功能。macOS 推荐通过 Homebrew 安装。',
        installCommand: result.installCommand || 'brew install scrcpy',
        tutorialUrl: result.tutorialUrl || 'https://github.com/Genymobile/scrcpy/blob/master/doc/macos.md',
      });
      return;
    }

    setLogcatDialog({
      open: true,
      title: '投屏失败',
      message: result?.error || 'scrcpy 启动失败，请确认设备已连接且已开启 USB 调试。',
    });
  };

  const openExternal = async (url: string) => {
    await invoke('shell:open-external', url);
  };

  const showItemInFolder = async (filePath: string) => {
    await invoke('shell:show-item-in-folder', filePath);
  };

  const dialogTone = logcatDialog.tone
    || (/失败|无法|错误|不支持|未安装/.test(logcatDialog.title)
      ? 'error'
      : (/成功|已保存|已启动/.test(logcatDialog.title) ? 'success' : 'info'));
  const installSummary: Record<string, [string, string]> = {
    APK_INSTALL_USER_RESTRICTED: ['设备未允许安装', '请在设备上允许 USB 安装，并确认安装提示后重试。'],
    APK_INSTALL_SIGNATURE_MISMATCH: ['安装包签名不匹配', '请联系安装包提供方，获取与设备现有应用签名一致的版本。'],
    APK_INSTALL_VERSION_DOWNGRADE: ['安装包版本过低', '请选择不低于设备当前版本的安装包。'],
    APK_INSTALL_INSUFFICIENT_STORAGE: ['设备空间不足', '请释放设备存储空间后重试。'],
    APK_INSTALL_ABI_MISMATCH: ['安装包不适配此设备', '请获取适配设备处理器的安装包。'],
    APK_INSTALL_DEVICE_UNAVAILABLE: ['设备连接不可用', '请检查 USB 连接和调试授权后重试。'],
  };
  const compactInstall = logcatDialog.installFailure
    ? installSummary[logcatDialog.installFailure.errorCode || '']
      || ['安装未完成', '可展开错误详情，查看原因或提供给开发人员排查。']
    : undefined;
  const DialogIcon = dialogTone === 'error'
    ? CircleAlert
    : (dialogTone === 'success' ? CircleCheckBig : Info);

  return (
    <>
      <div className="relative z-[60] px-4 py-1.5 bg-background/80 backdrop-blur-xl border-b border-border device-header-grid grid gap-2 shrink-0">
        <DeviceCard
          type="Phone"
          title="手机设备 / Mobile"
          defaultPackage={phoneDefaultPackage}
          runtime={phoneRuntime}
          devices={phoneCandidateDevices}
          selectedSerial={phoneSerial}
          selectedPackage={phonePackage}
          packages={phonePackages}
          version={phoneVersion}
          onRuntimeChange={setPhoneRuntime}
          onSerialChange={handlePhoneSerialChange}
          onPackageChange={setPhonePackage}
          onRefresh={refreshPhoneInfo}
          onToggleLogcat={() => toggleLogcat(phoneSerial, 'phone', phoneLogcatRunning, setPhoneLogcatRunning)}
          onMirrorScreen={() => startScrcpy(phoneSerial, '手机')}
          onChooseApk={() => chooseAndInstallApk('phone')}
          onDropApk={(file) => installDroppedApk('phone', file)}
          isInstallingApk={apkInstalling.phone}
          isLogcatRunning={phoneLogcatRunning}
        />
        <DeviceCard
          type="Glasses"
          title="眼镜设备 / Glasses"
          defaultPackage={glassesDefaultPackage}
          runtime={glassesRuntime}
          devices={glassesCandidateDevices}
          selectedSerial={glassesSerial}
          selectedPackage={glassesPackage}
          packages={glassesPackages}
          version={glassesVersion}
          onRuntimeChange={setGlassesRuntime}
          onSerialChange={handleGlassesSerialChange}
          onPackageChange={setGlassesPackage}
          onRefresh={refreshGlassesInfo}
          onToggleLogcat={() => toggleLogcat(glassesSerial, 'glasses', glassesLogcatRunning, setGlassesLogcatRunning)}
          onMirrorScreen={() => startScrcpy(glassesSerial, '眼镜')}
          onChooseApk={() => chooseAndInstallApk('glasses')}
          onDropApk={(file) => installDroppedApk('glasses', file)}
          isInstallingApk={apkInstalling.glasses}
          isLogcatRunning={glassesLogcatRunning}
        />
      </div>

      <Dialog.Root open={logcatDialog.open} onOpenChange={(open) => setLogcatDialog((current) => ({ ...current, open }))}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/30 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] flex w-[420px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_72px_rgba(15,23,42,0.22)] focus:outline-none">
            <div className="flex shrink-0 items-start gap-3 px-5 pb-5 pt-6">
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${dialogTone === 'error' ? 'bg-red-50 text-red-600' : dialogTone === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                <DialogIcon className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold leading-6 text-slate-900">{compactInstall?.[0] || logcatDialog.title}</Dialog.Title>
                <Dialog.Description className="mt-2 break-words text-sm leading-6 text-slate-500">{compactInstall?.[1] || logcatDialog.message}</Dialog.Description>
                {!logcatDialog.installFailure && Boolean(logcatDialog.guidance?.length) && (
                  <div className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-3">
                    <p className="text-xs font-bold text-amber-900">请检查</p>
                    <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-amber-900/80">
                      {logcatDialog.guidance?.map((item, index) => (
                        <li key={`${item}-${index}`} className="list-disc pl-0.5">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLogcatDialog((current) => ({ ...current, open: false }))}
                className="nodrag -mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto px-5">
            {logcatDialog.installFailure && (
              <details className="group mb-5 rounded-xl border border-slate-200 bg-slate-50/60 text-xs text-slate-600">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-3.5 py-3 font-medium hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
                  查看错误详情
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-2 border-t border-slate-200 px-3.5 py-3">
                  <p className="break-words">{logcatDialog.message}</p>
                  {logcatDialog.installFailure.packageName && <p className="break-all">包名：{logcatDialog.installFailure.packageName}</p>}
                  {logcatDialog.installFailure.currentVersion && <p>当前版本：{logcatDialog.installFailure.currentVersion.versionName || '未知'}（{logcatDialog.installFailure.currentVersion.versionCode || '未知'}）</p>}
                  {logcatDialog.installFailure.targetVersion && <p>目标版本：{logcatDialog.installFailure.targetVersion.versionName || '未知'}（{logcatDialog.installFailure.targetVersion.versionCode || '未知'}）</p>}
                  <p className="break-all">错误码：{logcatDialog.installFailure.androidErrorCode || logcatDialog.installFailure.errorCode || '未知'}</p>
                  {logcatDialog.guidance?.map((text, index) => <p key={`guidance-${index}`} className="break-words">{text}</p>)}
                  {logcatDialog.installFailure.metadataErrors?.map((text, index) => <p key={index} className="break-words text-slate-500">{text}</p>)}
                  <label className="block pt-1">原始错误（可选中复制）
                    <textarea readOnly value={logcatDialog.installFailure.technicalDetails || logcatDialog.message} className="mt-2 h-28 w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 font-mono text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                </div>
              </details>
            )}
            {logcatDialog.filePath && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600 break-all">
                {logcatDialog.filePath}
              </div>
            )}
            {logcatDialog.installCommand && (
              <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100 break-all">
                {logcatDialog.installCommand}
              </div>
            )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
            {logcatDialog.filePath && (
                <button
                  type="button"
                  onClick={() => showItemInFolder(logcatDialog.filePath!)}
                  className="nodrag mr-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  打开所在文件夹
                </button>
              )}
              {logcatDialog.tutorialUrl && (
                <button
                  type="button"
                  onClick={() => openExternal(logcatDialog.tutorialUrl!)}
                  className="nodrag mr-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  查看安装教程
                </button>
              )}
              <button
                type="button"
                onClick={() => setLogcatDialog((current) => ({ ...current, open: false }))}
                className="nodrag h-9 shrink-0 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700 active:translate-y-px"
              >
                知道了
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
