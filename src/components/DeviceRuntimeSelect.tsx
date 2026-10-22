import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

// Brand paths: Simple Icons (CC0), https://github.com/simple-icons/simple-icons/tree/develop/icons
const paths = {
  android: 'M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z',
  harmony: 'M1.861 0H3.59v3.548h3.861V0H9.19v8.883H7.458V5.136H3.59v3.746H1.858Zm8.248 8.883ZM13.854 0h1.706l2.809 4.7h.1L21.278 0h1.719v8.883h-1.719v-4.38l.1-1.489h-.1l-2.334 3.983h-1.039l-2.347-3.983h-.1l.1 1.489v4.38h-1.706Zm4.702 21.648a4.082 4.082 0 0 1-1.154-.161 3.417 3.417 0 0 1-1.01-.484 3.5 3.5 0 0 1-.8-.782 3.817 3.817 0 0 1-.538-1.092l1.666-.62a2.411 2.411 0 0 0 .643 1.116 1.683 1.683 0 0 0 1.207.434 2.173 2.173 0 0 0 .524-.062 1.749 1.749 0 0 0 .459-.2 1.02 1.02 0 0 0 .328-.335.88.88 0 0 0 .118-.459 1.052 1.052 0 0 0-.092-.447 1.031 1.031 0 0 0-.315-.373 2.538 2.538 0 0 0-.564-.335 8.135 8.135 0 0 0-.852-.335l-.577-.2a4.753 4.753 0 0 1-.774-.335 3.44 3.44 0 0 1-.7-.509 2.662 2.662 0 0 1-.525-.695 2.093 2.093 0 0 1-.2-.918 2.248 2.248 0 0 1 .21-.968 2.433 2.433 0 0 1 .616-.794 2.87 2.87 0 0 1 .957-.533 3.726 3.726 0 0 1 1.246-.2 3.57 3.57 0 0 1 1.22.186 2.783 2.783 0 0 1 .879.459 2.468 2.468 0 0 1 .59.608 2.9 2.9 0 0 1 .328.633l-1.56.62a1.55 1.55 0 0 0-.485-.67 1.387 1.387 0 0 0-.944-.3 1.655 1.655 0 0 0-.957.261.754.754 0 0 0-.38.658.843.843 0 0 0 .367.682 4.232 4.232 0 0 0 1.167.534l.59.186a6.271 6.271 0 0 1 1.023.434 2.948 2.948 0 0 1 .8.57 2.191 2.191 0 0 1 .511.769 2.44 2.44 0 0 1 .183.98 2.317 2.317 0 0 1-.3 1.2 2.559 2.559 0 0 1-.747.819 3.361 3.361 0 0 1-1.036.484 4.184 4.184 0 0 1-1.128.161Zm-13.028 0a4.441 4.441 0 0 1-3.23-1.34 4.757 4.757 0 0 1-.956-1.476 4.912 4.912 0 0 1-.339-1.824 4.813 4.813 0 0 1 .339-1.811 4.569 4.569 0 0 1 .956-1.477 4.38 4.38 0 0 1 1.427-.992 4.5 4.5 0 0 1 1.8-.36 4.417 4.417 0 0 1 1.79.36 4.343 4.343 0 0 1 1.44.992 4.418 4.418 0 0 1 .944 1.477 4.67 4.67 0 0 1 .351 1.811 4.765 4.765 0 0 1-.351 1.824 4.589 4.589 0 0 1-.944 1.476 4.495 4.495 0 0 1-3.23 1.34Zm0-1.588a2.822 2.822 0 0 0 1.125-.223 2.761 2.761 0 0 0 .92-.621 2.723 2.723 0 0 0 .617-.955 3.321 3.321 0 0 0 .23-1.253 3.227 3.227 0 0 0-.23-1.24 2.7 2.7 0 0 0-.617-.968 2.759 2.759 0 0 0-.92-.62 2.821 2.821 0 0 0-1.125-.223 2.856 2.856 0 0 0-2.057.844 2.946 2.946 0 0 0-.617.968 3.388 3.388 0 0 0-.218 1.24 3.488 3.488 0 0 0 .218 1.253 2.972 2.972 0 0 0 .617.955 2.856 2.856 0 0 0 2.057.843Zm4.972 1.389Zm-8.269 1.039h6.5V24h-6.5Z',
};
type Runtime = 'android' | 'harmony';
const labels = { android: 'Android', harmony: '鸿蒙' };
export function RuntimeIcon({ runtime }: { runtime: Runtime }) {
  return <svg aria-hidden="true" data-runtime-icon={runtime} viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-current ${runtime === 'android' ? 'text-emerald-600' : 'text-blue-600'}`}><path d={paths[runtime]} /></svg>;
}

export default function DeviceRuntimeSelect({ value, onChange, label }: { value: Runtime; onChange: (value: Runtime) => void; label: string }) {
  return <Select.Root value={value} onValueChange={next => onChange(next as Runtime)}>
    <Select.Trigger aria-label={label} title={`${labels[value]} · 切换系统`} className="nodrag inline-flex h-7 w-12 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 data-[state=open]:border-blue-300 data-[state=open]:bg-blue-50">
      <RuntimeIcon runtime={value} />
      <Select.Icon><ChevronDown className="h-2.5 w-2.5 text-slate-500" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content position="popper" align="end" sideOffset={6} className="z-[200] min-w-36 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg outline-none">
        <Select.Viewport>{(['android', 'harmony'] as const).map(runtime => <Select.Item key={runtime} value={runtime} textValue={labels[runtime]} className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-2.5 pr-8 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700">
          <RuntimeIcon runtime={runtime} /><Select.ItemText>{labels[runtime]}</Select.ItemText>
          <Select.ItemIndicator className="absolute right-2"><Check className="h-3.5 w-3.5 text-blue-600" /></Select.ItemIndicator>
        </Select.Item>)}</Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
