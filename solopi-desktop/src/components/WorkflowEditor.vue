<script setup lang="ts">
import { ref } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import { 
  Play, 
  RotateCcw, 
  Download, 
  Terminal, 
  Smartphone, 
  Eye, 
  Send, 
  Zap, 
  Plus, 
  GitBranch 
} from 'lucide-vue-next';

const nodes = ref([
  { id: '1', type: 'input', label: '开始测试', position: { x: 50, y: 100 }, class: 'vue-flow__node-custom' },
  { id: '2', label: '启动测试页', position: { x: 250, y: 100 }, class: 'vue-flow__node-custom' },
  { id: '3', label: '唤起支付', position: { x: 450, y: 100 }, class: 'vue-flow__node-custom' },
  { id: '4', type: 'output', label: '完成', position: { x: 650, y: 100 }, class: 'vue-flow__node-custom' },
]);

const edges = ref([
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e2-3', source: '2', target: '3', animated: true },
  { id: 'e3-4', source: '3', target: '4', animated: true },
]);
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 bg-white">
    <!-- Header -->
    <header class="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0 z-10">
      <div class="flex items-center gap-4">
        <h2 class="text-sm font-black tracking-tight flex items-center gap-2 text-slate-900">
          <Zap class="w-4 h-4 text-blue-600 fill-blue-600" />
          自动化测试引擎 (Vue 版)
        </h2>
        <div class="h-4 w-[1px] bg-slate-200" />
        <span class="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Payment_Verify_Alpha</span>
      </div>
      
      <div class="flex items-center gap-2">
        <button class="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all rounded-lg">
          <Download class="w-3.5 h-3.5" />
          导出脚本
        </button>
        <div class="h-4 w-[1px] bg-slate-200 mx-1" />
        <button class="flex items-center gap-2 px-4 py-2 text-xs font-black bg-blue-600 text-white hover:bg-blue-700 transition-all rounded-xl shadow-lg shadow-blue-200">
          <Play class="w-3.5 h-3.5 fill-current" />
          运行工作流
        </button>
      </div>
    </header>

    <!-- Canvas -->
    <div class="flex-1 relative">
      <VueFlow v-model:nodes="nodes" v-model:edges="edges" fit-view-on-init>
        <Background color="#cbd5e1" :gap="24" :size="1" />
        <Controls />
      </VueFlow>

      <!-- Toolbox -->
      <div class="absolute top-4 right-4 flex flex-col gap-2">
         <div class="bg-white/90 backdrop-blur border border-slate-200 rounded-2xl p-2 shadow-xl flex flex-col gap-2">
            <div class="px-2 py-1 text-[9px] font-black text-slate-400 uppercase text-center border-b border-slate-100 mb-1">原子操作库</div>
            <button class="p-3 bg-blue-600 rounded-xl hover:scale-110 transition-transform shadow-lg shadow-blue-100">
              <Terminal class="w-5 h-5 text-white" />
            </button>
            <button class="p-3 bg-emerald-600 rounded-xl hover:scale-110 transition-transform shadow-lg shadow-emerald-100">
              <Smartphone class="w-5 h-5 text-white" />
            </button>
            <button class="p-3 bg-indigo-600 rounded-xl hover:scale-110 transition-transform shadow-lg shadow-indigo-100">
              <Send class="w-5 h-5 text-white" />
            </button>
            <button class="p-3 bg-amber-600 rounded-xl hover:scale-110 transition-transform shadow-lg shadow-amber-100">
              <Eye class="w-5 h-5 text-white" />
            </button>
            <button class="p-3 bg-purple-600 rounded-xl hover:scale-110 transition-transform shadow-lg shadow-purple-100">
              <GitBranch class="w-5 h-5 text-white" />
            </button>
         </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vue-flow__node-custom {
  @apply bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-xs shadow-sm !important;
}
</style>
