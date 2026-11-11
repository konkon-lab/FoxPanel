<!-- 组件页右栏的一页(组件详情、分组页)：标题行，下面是能滚动的内容(默认插槽：最宽 880px，各块隔 24px)；对话框放插槽 dialogs -->
<script setup lang="ts">
import HeadBar from './HeadBar.vue';
import type { HeadAction } from './head-action.ts';

defineProps<{ title: string; actions: readonly HeadAction[] }>();
</script>

<template>
  <div class="view">
    <head-bar :title="title" :actions="actions" />
    <main class="page">
      <div class="wrap"><slot /></div>
    </main>
    <slot name="dialogs" />
  </div>
</template>

<style scoped>
.view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 32px;
}
.wrap {
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  padding-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
