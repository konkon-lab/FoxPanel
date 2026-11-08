<!-- 特殊符号：键盘上打不出、聊天里常用的符号，点一下插入 -->
<script setup lang="ts">
import { useCtx } from '../../_shared/vue.ts';

const SYMBOLS: readonly string[] = [
  '♡', '♥', '☆', '★', '♪', '♫', '～', '……', '・', '※', '→', '←', '↑', '↓', '↔',
  '✓', '✗', '○', '●', '△', '□', '■', '◇', '◆', '▽', '°', '℃', '¥', '€', '√',
];

const ctx = useCtx();
</script>

<template>
  <div class="symbols card">
    <button v-for="c in SYMBOLS" :key="c" type="button" class="key" :class="{ small: c.length > 1 }" @mousedown="ctx.kb.act({ kind: 'text', text: c })">{{ c }}</button>
  </div>
</template>

<style scoped>
.symbols {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 6px;
  padding: 10px;
}
.key {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}
.key.small {
  font-size: 15px;
}
</style>
