<!-- 设置页一行的外框：左边名字和说明(没有说明时只有名字)，右边是默认插槽里的控件，下面一条细线 -->
<script setup lang="ts">
defineProps<{ label: string; desc?: string }>();
</script>

<template>
  <div class="row">
    <span class="label"><b>{{ label }}</b><small v-if="desc">{{ desc }}</small></span>
    <slot />
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 64px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
}
.label {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.label b {
  font-weight: 600;
}
.label small {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
