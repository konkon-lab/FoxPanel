<!-- 预装组件用到的线框图标(24 视框) -->
<script setup lang="ts">
export type IconName = 'x' | 'copy' | 'mic' | 'send' | 'back' | 'shift' | 'shiftLock' | 'chevron' | 'up' | 'clip' | 'moon' | 'sun' | 'broom' | 'typing' | 'bolt' | 'pin';
defineProps<{ name: IconName; size?: number }>();
</script>

<template>
  <svg
    :width="size ?? 22" :height="size ?? 22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  >
    <path v-if="name === 'x'" d="M6 6l12 12M18 6 6 18" />
    <template v-else-if="name === 'copy'"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></template>
    <template v-else-if="name === 'mic'"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></template>
    <template v-else-if="name === 'send'"><path d="M4 12 20 4l-6 16-3-7z" /><path d="M11 13l9-9" /></template>
    <template v-else-if="name === 'back'"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><path d="M17 9l-6 6M11 9l6 6" /></template>
    <path v-else-if="name === 'shift'" d="M12 4 4 13h4v7h8v-7h4z" />
    <path v-else-if="name === 'shiftLock'" d="M12 4 4 13h4v7h8v-7h4z" fill="currentColor" />
    <path v-else-if="name === 'chevron'" d="M6 9l6 6 6-6" />
    <path v-else-if="name === 'up'" d="M6 15l6-6 6 6" />
    <template v-else-if="name === 'clip'"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></template>
    <path v-else-if="name === 'moon'" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    <template v-else-if="name === 'sun'"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></template>
    <template v-else-if="name === 'typing'"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></template>
    <path v-else-if="name === 'bolt'" d="M13 2 4 14h7l-1 8 9-12h-7z" />
    <path v-else-if="name === 'pin'" d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z" transform="rotate(40 12 12)" />
    <path v-else-if="name === 'broom'" d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
</template>
