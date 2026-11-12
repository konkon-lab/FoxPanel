<!-- 侧栏「依赖图」图标：上面两个、下面一个节点，三条连线；线条风格同 lucide -->
<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string }>(), { size: 24 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="5" cy="6" r="2.5" />
    <circle cx="19" cy="6" r="2.5" />
    <circle cx="12" cy="19" r="2.5" />
    <path d="M6.4 8.1 10.7 16.8M17.6 8.1 13.3 16.8M7.5 6h9" />
  </svg>
</template>
