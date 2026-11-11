<!-- 状态栏：组件上报的项(按组件顺序，有卡片的悬停弹出，点一下固定住，点别处或按 Esc 收起)；CPU 和内存 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { locale, store, textOf } from '@konkon-lab/foxpanel-window';
import type { Text } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';

const tx = (v: Text | undefined): string => (v === undefined ? '' : textOf(v, locale.value));
const items = computed(() => store.stats.items.map(({ id, item }) => ({
  id, led: item.led, label: tx(item.label), value: tx(item.value), state: tx(item.state),
  rows: (item.rows ?? []).map(r => ({ label: tx(r.label), value: tx(r.value) })),
  card: item.state !== undefined || !!item.rows?.length,
})));

// 点一下固定卡片，再点一下、点别处或按 Esc 收起
const pinned = ref('');
const onDown = (e: PointerEvent): void => {
  const el = e.target instanceof Element ? e.target.closest('[data-item]') : null;
  if (pinned.value && el?.getAttribute('data-item') !== pinned.value) pinned.value = '';
};
const onKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') pinned.value = '';
};
const toggle = (id: string): void => {
  pinned.value = pinned.value === id ? '' : id;
};
onMounted(() => {
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDown, true);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <footer class="status-bar" :aria-label="t('shell.statusAria')">
    <span v-for="i in items" :key="i.id" class="item" :class="{ pinned: pinned === i.id }" :data-item="i.id">
      <button
        type="button" class="it itembtn" :aria-expanded="i.card ? pinned === i.id : undefined"
        :aria-label="[i.label, i.state, i.value].filter(Boolean).join('，')" @click="i.card && toggle(i.id)"
      >
        <i class="led" :class="i.led" aria-hidden="true" />{{ i.label }}<span v-if="i.value" class="up">{{ i.value }}</span>
      </button>
      <span v-if="i.card" class="card" role="tooltip">
        <span class="head"><i class="led" :class="i.led" aria-hidden="true" /><b>{{ i.label }}</b><span class="state" :class="i.led">{{ i.state }}</span></span>
        <dl v-if="i.rows.length">
          <template v-for="(r, n) in i.rows" :key="n">
            <dt>{{ r.label }}</dt><dd>{{ r.value }}</dd>
          </template>
        </dl>
      </span>
    </span>
    <span class="it" :title="t('shell.usageTip')">CPU {{ store.stats.cpu }}%&nbsp;&nbsp;MEM {{ store.stats.mem }}%</span>
  </footer>
</template>

<style scoped>
.status-bar {
  height: 30px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
  padding: 0 20px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  color: var(--text-secondary);
  font-family: Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.it {
  display: flex;
  align-items: center;
  gap: 6px;
}
.led {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  flex: none;
}
.ok {
  background: var(--dot-ok);
}
.wait {
  background: var(--dot-wait);
}
.idle {
  background: var(--dot-idle);
}
.item {
  position: relative;
  height: 30px;
  display: flex;
  align-items: center;
}
.itembtn {
  height: 30px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
}
.item:hover .itembtn,
.item.pinned .itembtn,
.itembtn:focus-visible {
  background: var(--hover-bg);
}
.up {
  margin-left: 4px;
}
/* 悬停卡片：在这一项正上方居中，底下的小尖角对准它 */
.card {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: 20;
  width: 232px;
  box-sizing: border-box;
  padding: 10px 14px 12px;
  border-radius: 6px;
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line), 0 8px 20px rgba(17, 24, 39, 0.12);
  color: var(--text);
  font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif;
  font-size: 13px;
  letter-spacing: 0;
  white-space: normal;
  transform: translate(-50%, 4px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  /* 淡入并上移 4px；收起时等淡出完再隐藏 */
  transition: opacity 0.16s ease-out, transform 0.16s ease-out, visibility 0s linear 0.16s;
}
.card::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  background: var(--surface);
  box-shadow: 1px 1px 0 var(--line);
  transform: rotate(45deg);
}
/* 鼠标悬停或键盘移到这一项时显示；点过之后按钮留着焦点也不常显 */
.item:hover .card,
.item.pinned .card,
.item:has(.itembtn:focus-visible) .card {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
  transition-delay: 0s;
}
@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
  }
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--line);
  line-height: 20px;
}
.head .led {
  width: 8px;
  height: 8px;
  border-radius: 4px;
}
.head b {
  font-size: 14px;
}
.state {
  margin-left: auto;
  background: none;
  color: var(--text-secondary);
}
.state.wait {
  color: #a86b10;
}
.state.ok {
  color: #3f8f5a;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0;
  line-height: 20px;
}
dt {
  color: var(--text-secondary);
}
dd {
  margin: 0;
  text-align: right;
  font-family: Consolas, monospace;
}
</style>
