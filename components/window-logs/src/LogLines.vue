<!-- 深色日志框：每行是一个 LogLine，按行号复用，前面裁掉旧行、后面进新行时其余的行不重画；
     日志页里悬停的行右边出现箭头，点了跳到那个组件(compact：组件详情里，不显示箭头)。新行进来时滚到底(用户往上翻时不动) -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { store } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import LogLine from './LogLine.vue';
import type { LogEntry } from '@konkon-lab/foxpanel-sdk';

const props = defineProps<{ lines: readonly LogEntry[]; compact?: boolean }>();

const STICK_PX = 24;            // 离底部不到这么多像素时算贴底，新行进来跟着滚

// 这一行右边有没有跳转箭头：日志页里、来源是列表里有的组件
const knownIds = computed(() => new Set(store.comps.rows.map(r => r.id)));
const linked = (l: LogEntry): boolean => !props.compact && knownIds.value.has(l.source);

// 贴底：显示的最后一行变了(看行号；行数到上限后行数不变)且用户没往上翻时滚到底
const box = ref<HTMLElement | null>(null);
let stick = true;
function onScroll(): void {
  const el = box.value;
  if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
}
watch(() => props.lines.at(-1)?.id, async () => {
  if (!stick) return;
  await nextTick();
  if (box.value) box.value.scrollTop = box.value.scrollHeight;
}, { immediate: true });
</script>

<template>
  <div ref="box" class="term" :class="{ compact }" role="log" @scroll="onScroll">
    <p v-if="!lines.length" class="empty">{{ t('log.empty') }}</p>
    <log-line v-for="l in lines" :key="l.id" :line="l" :linked="linked(l)" />
  </div>
</template>

<style scoped>
.term {
  overflow: auto;
  scrollbar-width: none;
  padding: 12px;
  border-radius: 10px;
  background: #2b2a28;
  font-family: Consolas, monospace;
  font-size: 13px;
  line-height: 1.75;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.35);
  user-select: text;
}
.term::-webkit-scrollbar {
  display: none;
}
.term.compact {
  max-height: 220px;
}
.empty {
  margin: 0;
  color: #7d766c;
}
</style>
