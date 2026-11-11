<!-- 设置行里的 32×32 小按钮：图标放插槽，悬停显示名字并变靛蓝；label 是读屏用的名字(不写就用 title)；
     bare 时没有边框、悬停变红(表格里的删除)；点击由外面接(click) -->
<script setup lang="ts">
defineProps<{ title: string; label?: string | undefined; disabled?: boolean | undefined; bare?: boolean }>();
</script>

<template>
  <button type="button" class="mini" :class="{ bare }" :title="title" :aria-label="label ?? title" :disabled="disabled"><slot /></button>
</template>

<style scoped>
.mini {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
}
.mini:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.mini.bare {
  border-color: transparent;
}
.mini.bare:hover {
  color: #d14343;
}
</style>
