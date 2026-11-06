<!-- 标题行里的图标按钮：48×48，图标放插槽，悬停显示名字并变靛蓝；点击由外面接(click) -->
<script setup lang="ts">
defineProps<{ title: string; disabled?: boolean | undefined }>();
</script>

<template>
  <button type="button" class="mi" :title="title" :aria-label="title" :disabled="disabled"><slot /></button>
</template>

<style scoped>
.mi {
  width: 48px;
  height: 48px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: color 0.2s;
}
.mi:hover:not(:disabled) {
  color: var(--accent);
}
.mi:disabled {
  color: var(--dot-idle);
  cursor: default;
}
</style>
