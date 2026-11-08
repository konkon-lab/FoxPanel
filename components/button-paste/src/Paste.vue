<!-- 粘贴：把剪贴板文字插到光标处 -->
<script setup lang="ts">
import { useCtx, useWords } from '../../_shared/vue.ts';
import { TEXT } from './words.ts';
import RailButton from '../../_shared/RailButton.vue';

const ctx = useCtx();
const t = useWords(TEXT);
</script>

<template>
  <rail-button icon="clip" :label="t.paste" @press="ctx.kb.act({ kind: 'paste' })" />
</template>
