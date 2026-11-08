<!-- 小键盘：数字和运算符直接插入，Enter 发回车键 -->
<script setup lang="ts">
import { useCtx } from '../../_shared/vue.ts';

// [文字, 网格位置 行起/列起/行止/列止]
const NUMPAD: readonly (readonly [string, string])[] = [
  ['=', '1 / 1 / 2 / 2'], ['/', '1 / 2 / 2 / 3'], ['*', '1 / 3 / 2 / 4'], ['-', '1 / 4 / 2 / 5'],
  ['7', '2 / 1 / 3 / 2'], ['8', '2 / 2 / 3 / 3'], ['9', '2 / 3 / 3 / 4'], ['+', '2 / 4 / 4 / 5'],
  ['4', '3 / 1 / 4 / 2'], ['5', '3 / 2 / 4 / 3'], ['6', '3 / 3 / 4 / 4'],
  ['1', '4 / 1 / 5 / 2'], ['2', '4 / 2 / 5 / 3'], ['3', '4 / 3 / 5 / 4'], ['Enter', '4 / 4 / 6 / 5'],
  ['0', '5 / 1 / 6 / 3'], ['.', '5 / 3 / 6 / 4'],
];

const ctx = useCtx();

function press(label: string): void {
  if (label === 'Enter') ctx.kb.act({ kind: 'key', code: 'Enter', shift: false });
  else ctx.kb.act({ kind: 'text', text: label });
}
</script>

<template>
  <div class="numpad card">
    <button
      v-for="[label, area] in NUMPAD" :key="label" type="button" class="key" :class="{ small: label === 'Enter' }" :style="{ gridArea: area }"
      @mousedown="press(label)"
    >{{ label }}</button>
  </div>
</template>

<style scoped>
.numpad {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(5, minmax(0, 1fr));
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
