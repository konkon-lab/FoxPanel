<!-- 主窗口页面的标题行：64px 高、页面底色、下边一条细线；左边标题和英文小标，右边放按钮(插槽) -->
<script setup lang="ts">
defineProps<{ title: string; legend: string }>();
</script>

<template>
  <div class="head">
    <h1>{{ title }} <span class="legend">{{ legend }}</span></h1>
    <span class="acts"><slot /></span>
  </div>
</template>

<style scoped>
.head {
  height: 64px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 24px;
  background: var(--page-bg);
  border-bottom: 1px solid var(--line);
}
h1 {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 20px;
  font-weight: 700;
}
.legend {
  font-family: Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}
.acts {
  display: flex;
  flex: none;
}
</style>
