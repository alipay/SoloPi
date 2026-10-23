<script setup lang="ts">
import { ref } from 'vue';
import Sidebar from './components/Sidebar.vue';
import DeviceHeader from './components/DeviceHeader.vue';
import WorkflowEditor from './components/WorkflowEditor.vue';

const activeTab = ref('automation');
</script>

<template>
  <div class="flex h-screen bg-white text-slate-900 overflow-hidden font-sans antialiased">
    <!-- Sidebar -->
    <Sidebar :active-tab="activeTab" @update:active-tab="activeTab = $event" />
    
    <main class="flex-1 flex flex-col min-w-0 bg-white">
      <!-- Shared Header -->
      <DeviceHeader />
      
      <!-- Dynamic Content -->
      <div v-if="activeTab === 'automation'" class="flex-1 flex flex-col min-h-0">
        <WorkflowEditor />
      </div>
      
      <div v-else class="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50 uppercase tracking-widest">
        {{ activeTab }} 模块正在开发中...
      </div>
    </main>
  </div>
</template>

<style>
@import './index.css';

body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
