<!-- 标签列表(数字或文字)：输入后回车添加(数字要在 min / max 内，重复的不加，不收时输入框变红)，点叉删除；改完的整个列表经 set 交出去 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { NInput } from 'naive-ui';
import { X } from '@lucide/vue';
import type { SettingDef } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { readTag } from './values.ts';

const props = defineProps<{ def: Extract<SettingDef, { type: 'tags' }>; value: unknown; label: string }>();
const emit = defineEmits<{ set: [tags: (number | string)[]] }>();

const tags = computed(() => (Array.isArray(props.value) ? props.value as (number | string)[] : []));
const typed = ref('');
const bad = ref(false);   // 刚输入的不收

function add(): void {
  if (!typed.value.trim()) return;
  const tag = readTag(typed.value, props.def.item, props.def.min, props.def.max);
  if (tag === null || tags.value.includes(tag)) {
    bad.value = true;
    return;
  }
  emit('set', [...tags.value, tag]);
  typed.value = '';
  bad.value = false;
}
const remove = (tag: number | string): void => emit('set', tags.value.filter(x => x !== tag));
</script>

<template>
  <span class="tags">
    <span v-for="v in tags" :key="String(v)" class="tag mono">{{ v }}<button type="button" :title="t('cp.tagRemove', { name: String(v) })" :aria-label="t('cp.tagRemove', { name: String(v) })" @click="remove(v)"><x :size="12" /></button></span>
    <n-input
      v-model:value="typed" class="tagin mono" :placeholder="t('cp.tagAdd')" :status="bad ? 'error' : 'success'" :aria-label="label"
      @keydown.enter="add" @update:value="bad = false"
    />
  </span>
</template>

<style scoped>
.tags {
  max-width: 420px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}
.tag {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 12.5px;
}
.tag button {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.tag button:hover {
  color: #d14343;
}
.tagin {
  width: 160px;
}
.mono,
.mono :deep(input) {
  font-family: Consolas, monospace;
  font-size: 12.5px;
}
</style>
