<!-- 日志框里的一行：时间 [级别] 来源 内容；来源按组件着色，内容里冒号后面的部分和数字用来源的颜色；
     linked 时悬停右边出现箭头，点了跳到那个组件。行对象的内容不变(markRaw)，只在行对象、linked 或界面语言变了时重画 -->
<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight } from '@lucide/vue';
import { openComponent } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import type { LogEntry } from '@konkon-lab/foxpanel-sdk';

const props = defineProps<{ line: LogEntry; linked: boolean }>();

const LEVEL = { info: 'I', warn: 'W', error: 'E' } as const;
const HOST_COLOR = '#7fb8e6';   // 宿主的行
const SOURCE_COLORS = ['#e79be0', '#9fd38a', '#7fd3c4', '#f0b45a', '#e8955a', '#b9a6f0', '#f2c879', '#8fc7f0'];   // 组件的行，按 id 取一个

const pad = (n: number): string => String(n).padStart(2, '0');
function stamp(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// 来源显示 id 的后半段(yanuo.tts-bailian → tts-bailian)，宿主是 host
const short = (source: string): string => source.split('.').pop() || 'host';
const gotoText = computed(() => t('log.goto', { name: short(props.line.source) }));

// 来源的颜色：按 id 算，同一个组件每次一样
function colorOf(source: string): string {
  if (!source) return HOST_COLOR;
  let h = 0;
  for (const ch of source) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SOURCE_COLORS[h % SOURCE_COLORS.length] ?? HOST_COLOR;
}

// 内容分段：冒号后面的部分、数字着色
function parts(text: string): { text: string; hot: boolean }[] {
  const colon = text.search(/[:：]/);
  const head = colon >= 0 ? text.slice(0, colon + 1) : text;
  const tail = colon >= 0 ? text.slice(colon + 1) : '';
  const out = head.split(/(\d+(?:\.\d+)?)/).map((s, i) => ({ text: s, hot: i % 2 === 1 }));
  if (tail) out.push({ text: tail, hot: true });
  return out.filter(p => p.text);
}
</script>

<template>
  <div class="ll" :class="line.level" :style="{ '--src': colorOf(line.source) }">
    <span class="time">{{ stamp(line.time) }}</span>
    <span class="lv">[{{ LEVEL[line.level] }}]</span>
    <b class="src">{{ short(line.source) }}</b>
    <span class="text"><span v-for="(p, i) in parts(line.text)" :key="i" :class="{ hot: p.hot }">{{ p.text }}</span></span>
    <button v-if="linked" type="button" class="go" :title="gotoText" :aria-label="gotoText" @click="openComponent(line.source)">
      <arrow-right :size="14" />
    </button>
  </div>
</template>

<style scoped>
.ll {
  position: relative;
  padding: 0 30px 0 8px;
  border-radius: 3px;
  white-space: nowrap;
  color: #ece6db;
}
.ll:hover {
  background: #3a3835;
}
.time {
  color: #7d766c;
}
.lv {
  margin: 0 6px;
}
.warn .lv {
  color: #f0b45a;
}
.error .lv {
  color: #f08a75;
}
.src {
  margin-right: 6px;
  color: var(--src);
}
.hot {
  color: var(--src);
}
.go {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  display: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #ece6db;
  cursor: pointer;
}
.go:hover {
  background: #4a4743;
}
.ll:hover .go {
  display: grid;
}
</style>
