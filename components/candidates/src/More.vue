<!-- 候选展开(弹层，盖住外壳主体)：一页排满候选，右边上下翻页。字形跟输入语言(lang) -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useCtx, useWords } from '../../_shared/vue.ts';
import { TEXT } from './words.ts';
import KbIcon from '../../_shared/Icon.vue';
import { countFit, inputLang, pageCandidates, ui } from './ui.ts';

const ctx = useCtx();
const kb = ctx.kb.state;
const t = useWords(TEXT);

const grid = ref<HTMLElement | null>(null);
// 一页最多放得下这么多，多的不渲染
const PAGE_MAX = 120;
const shown = computed(() => kb.candidates.slice(ui.moreStart, ui.moreStart + PAGE_MAX));

// 量一下这一页完整放得下几个；候选、起点、候选的字体(跟输入语言)变了都量
async function measure(): Promise<void> {
  await nextTick();
  if (grid.value) ui.moreFit = countFit(grid.value, 'y');
}
watch(() => [kb.candidates, ui.moreStart, inputLang(kb)], () => void measure(), { immediate: true });

function pick(index: number): void {
  ctx.kb.act({ kind: 'select', index });
  ui.expanded = false;
}
</script>

<template>
  <div class="more card" :lang="inputLang(kb)">
    <div ref="grid" class="grid">
      <button
        v-for="(c, i) in shown" :key="c.index" type="button" class="cand" :class="{ hidden: ui.moreFit > 0 && i >= ui.moreFit }"
        @mousedown="pick(c.index)"
      >{{ c.text }}</button>
    </div>
    <div class="pager">
      <button type="button" class="page key" :disabled="ui.moreStart === 0" :aria-label="t.prev" @mousedown="pageCandidates(kb.candidates.length, -1)">
        <kb-icon name="up" :size="28" />
      </button>
      <button
        type="button" class="page key" :disabled="ui.moreStart + ui.moreFit >= kb.candidates.length" :aria-label="t.next"
        @mousedown="pageCandidates(kb.candidates.length, 1)"
      >
        <kb-icon name="chevron" :size="28" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.more {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  gap: 10px;
  padding: 10px;
}
.grid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
  overflow: hidden;
}
.cand {
  height: 52px;
  min-width: 64px;
  padding: 0 16px;
  border: 1px solid var(--line) !important;
  border-radius: 6px;
  font-size: 22px !important;
  white-space: nowrap;
}
.cand:active {
  background: var(--key);
}
.cand.hidden {
  visibility: hidden;
}
.pager {
  width: 72px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.page:disabled {
  opacity: 0.4;
}
</style>
