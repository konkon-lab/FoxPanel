<!-- 组件详情页、分组页里的一节：大标题和右边的小字(CONFIG 这类标记或数量)，下面是各行(默认插槽，放 DetailRow 或组件设置的行)；
     不成行的内容放插槽 body。tight 时标题下面留 12px，否则 16px -->
<script setup lang="ts">
defineProps<{ title: string; legend: string | number; tight?: boolean }>();
const slots = defineSlots<{ default?: () => unknown; body?: () => unknown }>();
</script>

<template>
  <section :aria-label="title">
    <h2 class="h2" :class="{ tight }">{{ title }} <span class="legend">{{ legend }}</span></h2>
    <div v-if="slots.default" class="rows"><slot /></div>
    <slot name="body" />
  </section>
</template>

<style scoped>
.h2 {
  margin: 0 0 16px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 20px;
  font-weight: 700;
}
.h2.tight {
  margin-bottom: 12px;
}
.legend {
  font-family: Consolas, monospace;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.rows {
  display: flex;
  flex-direction: column;
}
</style>
