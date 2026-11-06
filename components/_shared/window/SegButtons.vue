<!-- 分段按钮(Schema union 的 role: radio)：一排选项，选中的白底；照设置页「界面主题」 -->
<script setup lang="ts">
defineProps<{ value: string; options: { value: string; label: string }[]; label: string }>();
const emit = defineEmits<{ update: [value: string] }>();
</script>

<template>
  <span class="seg" role="group" :aria-label="label">
    <button
      v-for="o in options" :key="o.value" type="button" :class="{ on: value === o.value }" :aria-pressed="value === o.value"
      @click="emit('update', o.value)"
    >{{ o.label }}</button>
  </span>
</template>

<style scoped>
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius);
  background: var(--track);
  flex: none;
}
button {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
button.on {
  background: var(--surface);
  color: var(--text);
  font-weight: 500;
  box-shadow: 0 0 0 1px var(--line);
}
</style>
