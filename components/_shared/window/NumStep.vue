<!-- 数字步进器：左「−」、中间数字、右「+」；按 step 加减，夹在 min / max 内；直接输入时回车或离开后生效 -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from './i18n.ts';

const props = defineProps<{ value: number | null; min?: number | undefined; max?: number | undefined; step?: number | undefined; label: string }>();
const emit = defineEmits<{ update: [value: number] }>();

const text = ref(String(props.value ?? ''));
watch(() => props.value, v => { text.value = String(v ?? ''); });

const clamp = (n: number): number => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n));
// 按 step 的小数位取整，避免 0.1 + 0.2 这类误差
const round = (n: number): number => {
  const digits = String(props.step ?? 1).split('.')[1]?.length ?? 0;
  return Number(n.toFixed(digits));
};

function set(n: number): void {
  const v = round(clamp(n));
  text.value = String(v);
  if (v !== props.value) emit('update', v);
}
const add = (sign: 1 | -1): void => set((props.value ?? props.min ?? 0) + sign * (props.step ?? 1));
function commit(): void {
  const n = Number(text.value.trim());
  if (text.value.trim() === '' || !Number.isFinite(n)) text.value = String(props.value ?? '');
  else set(n);
}
</script>

<template>
  <span class="step">
    <button type="button" :disabled="value !== null && min !== undefined && value <= min" :aria-label="t('cp.stepDown', { name: label })" @click="add(-1)">−</button>
    <input v-model="text" :aria-label="label" inputmode="decimal" @keydown.enter="commit" @blur="commit">
    <button type="button" :disabled="value !== null && max !== undefined && value >= max" :aria-label="t('cp.stepUp', { name: label })" @click="add(1)">+</button>
  </span>
</template>

<style scoped>
.step {
  height: 36px;
  display: inline-flex;
  box-sizing: border-box;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.step:focus-within {
  border-color: var(--accent);
}
button {
  width: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
button:first-child {
  border-right: 1px solid var(--control-border);
}
button:last-child {
  border-left: 1px solid var(--control-border);
}
button:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--accent);
}
button:disabled {
  color: var(--text-secondary);
  opacity: 0.5;
  cursor: default;
}
input {
  width: 100px;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  text-align: center;
}
</style>
