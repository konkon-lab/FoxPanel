<!-- 语言面板(弹层)：开着的语言包多于两种时，从语言键上方弹出，列出它们；点一行只切换语言(模式沿用它上次的)；选完关掉，点面板外面由宿主的弹层关掉。
     宽度跟着最长的语言名，一列最宽 280px(含边框)，名字太长截断；语言多于 6 个时排成两列 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useCtx } from '../../_shared/vue.ts';
import { ui } from './ui.ts';

const props = defineProps<{ anchor: { left: number; bottom: number } }>();
const ctx = useCtx();
const kb = ctx.kb.state;
const wide = computed(() => kb.packs.length > 6);

function pick(lang: string): void {
  ctx.kb.act({ kind: 'lang', lang });
  ui.langOpen = false;
}
</script>

<template>
  <div class="picker" :class="{ wide }" role="menu" :style="{ left: `${props.anchor.left}px`, bottom: `${props.anchor.bottom}px` }">
    <div v-for="p in kb.packs" :key="p.id" class="row" :class="{ cur: kb.lang === p.id }" @mousedown="pick(p.id)">
      <span class="name" :lang="p.lang">{{ ctx.i18n.text(p.name) }}</span>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: fixed;
  width: max-content;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  box-sizing: border-box;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.12);
}
.picker.wide {
  display: grid;
  grid-template-columns: repeat(2, max-content);
}
.row {
  height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 262px;
  box-sizing: border-box;
  padding: 0 14px;
  border-radius: 6px;
}
.row.cur {
  background: var(--accent-soft);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 500;
}
.row.cur .name {
  font-weight: 700;
  color: var(--accent);
}
</style>
