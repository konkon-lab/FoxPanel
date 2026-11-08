<!-- 候选栏：一行放得下的候选，第一个高亮；右边的按钮展开 / 收起全部候选。字形跟输入语言(lang) -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useCtx, useWords } from '../../_shared/vue.ts';
import { TEXT } from './words.ts';
import KbIcon from '../../_shared/Icon.vue';
import { barMeasureKey, countFit, inputLang, ui } from './ui.ts';

const ctx = useCtx();
const kb = ctx.kb.state;
const t = useWords(TEXT);

const row = ref<HTMLElement | null>(null);
// 一行最多放得下这么多，多的不渲染
const BAR_MAX = 40;
const shown = computed(() => kb.candidates.slice(ui.barStart, ui.barStart + BAR_MAX));
const more = computed(() => ui.barStart > 0 || kb.candidates.length > ui.barStart + ui.barFit);

// 量一下这一行完整放得下几个，放不下的隐藏(不显示被截断的半个)；候选、起点、字体(跟输入语言和界面语言)变了都量
async function measure(): Promise<void> {
  await nextTick();
  if (row.value) ui.barFit = countFit(row.value, 'x');
}
watch(() => barMeasureKey(kb), () => void measure(), { immediate: true });
</script>

<template>
  <div class="bar card" :lang="inputLang(kb)">
    <div ref="row" class="row">
      <button
        v-for="(c, i) in shown" :key="c.index" type="button" class="cand" :class="{ first: ui.barStart === 0 && i === 0, hidden: i >= ui.barFit }"
        @mousedown="ctx.kb.act({ kind: 'select', index: c.index })"
      >{{ c.text }}</button>
    </div>
    <button
      type="button" class="icon-btn toggle" :class="{ open: ui.expanded }" :disabled="!more && !ui.expanded"
      :aria-label="ui.expanded ? t.collapse : t.expand" @mousedown="ui.expanded = !ui.expanded"
    >
      <kb-icon name="chevron" :size="24" />
    </button>
  </div>
</template>

<style scoped>
.bar {
  height: 100%;
  flex: 1;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
}
.row {
  flex: 1;
  min-width: 0;
  height: 40px;
  display: flex;
  gap: 6px;
  overflow: hidden;
}
.cand {
  flex: 0 0 auto;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--line) !important;
  border-radius: 6px;
  background: var(--surface);
  font-size: 20px !important;
  white-space: nowrap;
}
.cand:active {
  background: var(--key);
}
.cand.first {
  border-color: transparent !important;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.cand.hidden {
  visibility: hidden;
}
.toggle:disabled {
  opacity: 0;
}
.toggle.open {
  transform: rotate(180deg);
}
</style>
