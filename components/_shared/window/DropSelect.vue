<!-- 下拉框：白底细边，右侧箭头；点一下展开、再点收起，点外面或按 Esc 也收起。
     展开的列表挂在 body 上(不会被滚动区域裁掉)，至少和框一样宽、最宽 480px，选项文字完整显示(长了换行)；
     选项可分组，当前项淡靛蓝底加勾；allowCustom 时底部有一行输入框，回车用输入的值 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { Check, ChevronDown, Plus } from '@lucide/vue';
import type { DropOption } from './drop-option.ts';

const PANEL_MAX = 480;        // 列表最宽(px)
const PANEL_HEIGHT = 320;     // 列表最高(px)
const PANEL_MIN_GUESS = 160;  // 估算列表宽度时的下限(px)：框比它窄时按它算
const GAP = 4;                // 列表和框之间的距离(px)
const EDGE = 8;               // 列表离窗口左右边的最小距离(px)

const props = withDefaults(defineProps<{ value: string; options: readonly DropOption[]; width?: number; label?: string; allowCustom?: boolean; customPlaceholder?: string }>(), {
  width: 220, label: '', allowCustom: false, customPlaceholder: '',
});
const emit = defineEmits<{ update: [value: string] }>();

const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const pos = ref({ left: 0, top: 0, minWidth: 0, up: false });
const custom = ref('');

const current = computed(() => props.options.find(o => o.value === props.value));
// 按分组切开(保持原顺序)
const sections = computed(() => {
  const out: { group: string; items: DropOption[] }[] = [];
  for (const o of props.options) {
    const g = o.group ?? '';
    const last = out.at(-1);
    if (last && last.group === g) last.items.push(o);
    else out.push({ group: g, items: [o] });
  }
  return out;
});

// 列表的位置：和框左对齐、在框下面；下面放不下而上面更宽敞时翻到上面，右边放不下时往左挪
function place(): void {
  const r = trigger.value?.getBoundingClientRect();
  if (!r) return;
  const below = window.innerHeight - r.bottom;
  const up = below < PANEL_HEIGHT + GAP && r.top > below;
  const width = Math.min(PANEL_MAX, Math.max(r.width, PANEL_MIN_GUESS));
  const left = Math.min(r.left, window.innerWidth - width - EDGE);
  pos.value = { left: Math.max(EDGE, left), top: up ? r.top - GAP : r.bottom + GAP, minWidth: r.width, up };
}

function onOutside(e: MouseEvent): void {
  const t = e.target as Node;
  if (trigger.value?.contains(t) || panel.value?.contains(t)) return;
  close();
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}
function onScroll(e: Event): void {
  if (panel.value?.contains(e.target as Node)) return;
  close();
}
function listen(on: boolean): void {
  const f = on ? window.addEventListener : window.removeEventListener;
  f('mousedown', onOutside, true);
  f('keydown', onKey);
  f('scroll', onScroll, true);
  f('resize', close);
}

async function toggle(): Promise<void> {
  if (open.value) return close();
  place();
  open.value = true;
  custom.value = '';
  listen(true);
  await nextTick();
  panel.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}
function close(): void {
  if (!open.value) return;
  open.value = false;
  listen(false);
}
function pick(v: string): void {
  emit('update', v);
  close();
  trigger.value?.focus();
}
function useCustom(): void {
  const v = custom.value.trim();
  if (v) pick(v);
}
onBeforeUnmount(() => listen(false));
</script>

<template>
  <button
    ref="trigger" type="button" class="drop" :class="{ open }" :style="{ width: `${width}px` }" :aria-label="label"
    :aria-expanded="open" aria-haspopup="listbox" :title="current ? `${current.label}${current.sub ? ` · ${current.sub}` : ''}` : value" @click="toggle"
  >
    <span class="text">{{ current?.label ?? value }}<small v-if="current?.sub">{{ current.sub }}</small></span>
    <chevron-down class="arrow" :size="14" />
  </button>
  <teleport to="body">
    <div
      v-if="open" ref="panel" class="dd" role="listbox" :aria-label="label"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, minWidth: `${pos.minWidth}px`, maxWidth: `${PANEL_MAX}px`, transform: pos.up ? 'translateY(-100%)' : 'none' }"
    >
      <div class="list" :style="{ maxHeight: `${PANEL_HEIGHT}px` }">
        <template v-for="(s, i) in sections" :key="i">
          <div v-if="s.group" class="dd-h">{{ s.group }}</div>
          <button
            v-for="o in s.items" :key="o.value" type="button" role="option" :aria-selected="o.value === value" :title="o.label"
            @click="pick(o.value)"
          >
            <span class="opt">{{ o.label }}<small v-if="o.sub">{{ o.sub }}</small></span>
            <check v-if="o.value === value" class="tick" :size="14" />
          </button>
        </template>
      </div>
      <label v-if="allowCustom" class="dd-in">
        <plus :size="14" />
        <input v-model="custom" type="text" :placeholder="customPlaceholder" :aria-label="customPlaceholder" @keydown.enter.prevent="useCustom">
        <kbd>Enter</kbd>
      </label>
    </div>
  </teleport>
</template>

<style scoped>
.drop {
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.drop:hover {
  border-color: var(--accent);
}
.drop.open,
.drop:focus-visible {
  outline: 0;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(79, 91, 213, 0.15);
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
small {
  margin-left: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.arrow {
  flex: none;
  color: var(--text-secondary);
  transition: transform 0.15s;
}
.open .arrow {
  transform: rotate(180deg);
  color: var(--accent);
}
.dd {
  position: fixed;
  z-index: 3000;
  box-sizing: border-box;
  padding: 4px;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line), 0 8px 20px rgba(17, 24, 39, 0.12);
  color: var(--text);
  font-size: 14px;
}
.list {
  overflow-y: auto;
}
.dd-h {
  padding: 8px 10px 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.dd button {
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dd button:hover {
  background: var(--hover-bg);
}
.dd button[aria-selected='true'] {
  background: var(--accent-tint);
  color: var(--accent);
  font-weight: 600;
}
.dd button[aria-selected='true'] small {
  font-weight: 400;
}
.opt {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.tick {
  flex: none;
}
.dd-in {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin-top: 4px;
  padding: 0 10px;
  border-top: 1px solid var(--line);
  color: var(--text-secondary);
}
.dd-in input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.dd-in kbd {
  padding: 1px 6px;
  border: 1px solid var(--control-border);
  border-radius: 4px;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 11px;
}
</style>
