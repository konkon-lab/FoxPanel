<!-- 提示条：左边一条色带(绿 = 正常、蓝 = 提示、红 = 出错、黄 = 注意)，右边文字和可选的操作 -->
<script setup lang="ts">
defineProps<{ tone: 'ok' | 'info' | 'error' | 'warn' }>();
</script>

<template>
  <div class="notice" :class="tone"><slot /></div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 8px 16px 8px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
  box-shadow: inset 4px 0 0 var(--bar);
  overflow-wrap: anywhere;
}
.ok {
  --bar: #5fbf4a;
}
.info {
  --bar: #4a90d9;
}
.error {
  --bar: #d14343;
}
.warn {
  --bar: #e0a83a;
}
.notice :deep(a),
.notice :deep(.link) {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
