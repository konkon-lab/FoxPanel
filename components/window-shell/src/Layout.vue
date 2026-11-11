<!-- 主窗口外壳：顶栏 + 侧栏 + 当前页(各组件注册的页面，找不到时用第一个) + 状态栏 -->
<script setup lang="ts">
import { computed } from 'vue';
import { nav, windows } from '@konkon-lab/foxpanel-window';
import TitleBar from './TitleBar.vue';
import SideNav from './SideNav.vue';
import StatusBar from './StatusBar.vue';

const current = computed(() => windows.pages.find(p => p.id === nav.page) ?? windows.pages[0] ?? null);
</script>

<template>
  <div class="shell">
    <title-bar />
    <div class="body">
      <side-nav />
      <div class="content">
        <div class="scroll">
          <component :is="current.component" v-if="current" :key="current.id" />
        </div>
        <status-bar />
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--page-bg);
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
