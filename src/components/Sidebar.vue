<script setup lang="ts">
import { 
  Box,
  ChevronRight,
  Activity,
  Zap,
  Settings,
  HelpCircle
} from 'lucide-vue-next';

defineProps<{
  activeTab: string;
}>();

const emit = defineEmits(['update:activeTab']);

const navItems = [
  { id: 'samples', label: '多模态样本采集', icon: Activity },
  { id: 'automation', label: '自动化', icon: Zap },
];
</script>

<template>
  <aside class="w-64 bg-slate-50 border-r border-slate-200 flex flex-col h-screen shrink-0 z-[70]">
    <div class="p-6 flex items-center gap-3">
      <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
        <Box class="w-4 h-4 text-white" />
      </div>
      <div class="flex flex-col">
        <h1 class="text-sm font-black tracking-tight text-slate-900">SoloPi</h1>
        <span class="text-[10px] text-slate-500 font-semibold">Smart Device Test Harness</span>
      </div>
    </div>

    <nav class="flex-1 px-4 space-y-1.5 mt-4">
      <button
        v-for="item in navItems"
        :key="item.id"
        @click="emit('update:activeTab', item.id)"
        :class="[
          'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group',
          activeTab === item.id 
            ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200 border-none' 
            : 'text-slate-500 hover:bg-slate-200/50 hover:text-slate-900'
        ]"
      >
        <component 
          :is="item.icon" 
          :class="[
            'w-4 h-4 transition-colors',
            activeTab === item.id ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
          ]"
        />
        <span class="text-sm font-bold">{{ item.label }}</span>
        <ChevronRight v-if="activeTab === item.id" class="w-3 h-3 ml-auto opacity-50" />
      </button>
    </nav>

    <div class="mt-auto p-4 border-t border-slate-200 space-y-1">
      <button class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-200/50 hover:text-slate-900 transition-all font-medium">
        <Settings class="w-4 h-4" />
        <span class="text-sm">设置中心</span>
      </button>
      <button class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-200/50 hover:text-slate-900 transition-all font-medium">
        <HelpCircle class="w-4 h-4" />
        <span class="text-sm">使用帮助</span>
      </button>
    </div>

    <div class="p-4 border-t border-slate-200">
      <div class="flex items-center gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-xs font-bold text-blue-600">
          JL
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-xs font-black text-slate-900 truncate">珏乐</span>
          <span class="text-[10px] text-slate-500 font-bold truncate">Project Admin</span>
        </div>
      </div>
    </div>
  </aside>
</template>
