<script setup lang="ts">
import { 
  Smartphone, 
  MonitorSmartphone, 
  ChevronDown, 
  RefreshCw 
} from 'lucide-vue-next';

interface DeviceProps {
  type: 'Phone' | 'Glasses';
  title: string;
  defaultPackage: string;
}

const devices: DeviceProps[] = [
  { type: 'Phone', title: '手机设备 / Mobile', defaultPackage: '' },
  { type: 'Glasses', title: '眼镜设备 / Glasses', defaultPackage: '' }
];
</script>

<template>
  <div class="px-6 py-4 bg-background/50 backdrop-blur-xl border-b border-border flex gap-4 items-stretch shrink-0 z-10">
    <div 
      v-for="device in devices" 
      :key="device.type"
      class="flex-1 bg-card/40 border border-slate-200 rounded-2xl p-3 flex flex-col gap-2 transition-all hover:bg-white hover:shadow-sm"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Smartphone v-if="device.type === 'Phone'" class="w-4 h-4 text-blue-500" />
          <MonitorSmartphone v-else class="w-4 h-4 text-emerald-500" />
          <span class="text-xs font-bold uppercase tracking-wider text-slate-500">{{ device.title }}</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          <span class="text-[10px] font-bold text-emerald-500 uppercase">Online</span>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-[9px] font-bold text-slate-400 uppercase">Serial Number</label>
          <div class="relative group">
            <select class="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] appearance-none cursor-pointer focus:outline-none focus:ring-1 ring-blue-500/30">
              <option>RKID_GLASS_001</option>
              <option>RKID_GLASS_002</option>
            </select>
            <ChevronDown class="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-slate-600" />
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-[9px] font-bold text-slate-400 uppercase">Package Name</label>
          <div class="relative group">
            <select class="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] appearance-none cursor-pointer focus:outline-none focus:ring-1 ring-blue-500/30">
              <option>{{ device.defaultPackage }}</option>
              <option>com.example.app</option>
            </select>
            <ChevronDown class="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-slate-600" />
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-[9px] font-bold text-slate-400 uppercase">Version</label>
          <div class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono text-slate-700 flex items-center justify-between">
            <span>2.3.1.2024</span>
            <RefreshCw class="w-2.5 h-2.5 text-slate-400 hover:text-slate-900 cursor-pointer transition-colors" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
