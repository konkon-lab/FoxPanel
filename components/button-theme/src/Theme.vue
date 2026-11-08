<!-- 日夜切换：全部面板的深色 / 浅色 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useCtx, useWords } from '../../_shared/vue.ts';
import { TEXT } from './words.ts';
import RailButton from '../../_shared/RailButton.vue';

const ctx = useCtx();
const t = useWords(TEXT);
const dark = computed(() => ctx.panel.dark);
</script>

<template>
  <rail-button :icon="dark ? 'sun' : 'moon'" :label="dark ? t.light : t.dark" @press="ctx.panel.setDark(!dark)" />
</template>
