<!-- 侧栏按钮：46×46 的图标按钮 -->
<script setup lang="ts">
import KbIcon, { type IconName } from './Icon.vue';

defineProps<{ icon: IconName; label: string }>();
defineEmits<{ press: [] }>();
</script>

<template>
  <button type="button" class="action" :aria-label="label" @mousedown="$emit('press')"><kb-icon :name="icon" /></button>
</template>

<style scoped>
.action {
  width: 46px;
  height: 46px;
  flex: 0 0 auto !important;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--sub) !important;
}
.action:active {
  background: var(--key) !important;
}
</style>
