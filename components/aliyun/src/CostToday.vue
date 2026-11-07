<!-- 今日费用：左边今天合计和比昨天，右边按组件的环形图和明细(用量 + 金额) -->
<script setup lang="ts">
import { computed } from 'vue';
import { lastDays } from './book.ts';
import { cost, price, usageOf } from './cost.ts';
import { t } from './i18n.ts';
import { today as todayDate } from './state.ts';

// 环形图(viewBox 120×120 里的长度)
const R = 46;         // 半径
const CIRC = 2 * Math.PI * R;
const GAP = 2;        // 扇区间隙
const MIN_ARC = 3;    // 扇区最小弧长

const EVEN = 0.005;   // 和昨天差不到这么多算持平(金额显示到分，不到半分看不出差别)

const today = computed(() => cost.value.today);
const rows = computed(() => {
  const days = lastDays(todayDate.value, 1);
  return cost.value.series.filter(s => (today.value.by[s.id] ?? 0) > 0).map(s => ({ ...s, value: today.value.by[s.id] ?? 0, usage: usageOf(s.id, days).main }));
});

const diff = computed(() => {
  const d = today.value.total - cost.value.yesterday;
  if (Math.abs(d) < EVEN) return t('cost.even');
  return `${d > 0 ? '+' : '−'}${price(Math.abs(d))}`;
});

const arcs = computed(() => {
  const total = today.value.total;
  if (total <= 0) return [];
  let offset = 0;
  return rows.value.map(r => {
    const share = (r.value / total) * CIRC;
    const length = Math.max(MIN_ARC, share - GAP);
    const arc = { ...r, dash: `${length.toFixed(2)} ${(CIRC - length).toFixed(2)}`, offset: (-offset).toFixed(2) };
    offset += Math.max(length + GAP, share);
    return arc;
  });
});

const label = computed(() => t('cost.todayByService', { list: rows.value.map(r => `${r.name} ${price(r.value, 3)}`).join(t('cost.comma')) }));
</script>

<template>
  <section class="dash-card today" :aria-label="t('cost.todayCost')">
    <div class="total">
      <div class="label">{{ t('cost.todayCost') }}</div>
      <div class="big">{{ price(today.total) }}</div>
      <div class="label">{{ t('cost.vsYesterday') }} <b>{{ diff }}</b></div>
    </div>
    <svg width="120" height="120" viewBox="0 0 120 120" role="img" :aria-label="label">
      <circle v-if="!arcs.length" cx="60" cy="60" :r="R" fill="none" stroke="var(--line)" stroke-width="16" />
      <circle
        v-for="a in arcs" :key="a.id" cx="60" cy="60" :r="R" fill="none" :stroke="a.color" stroke-width="16"
        :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset" transform="rotate(-90 60 60)"
      >
        <title>{{ a.name }} {{ price(a.value, 3) }}</title>
      </circle>
    </svg>
    <p v-if="!rows.length" class="meta empty">{{ t('cost.noUsage') }}</p>
    <ul v-else class="legend">
      <li v-for="r in rows" :key="r.id">
        <i :style="{ background: r.color }" />
        <span class="name" :title="r.name">{{ r.name }}</span>
        <span class="usage">{{ r.usage }}</span>
        <b>{{ price(r.value, 3) }}</b>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.today {
  display: flex;
  align-items: center;
  gap: 24px;
}
.total {
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding-right: 24px;
  border-right: 1px solid var(--line);
}
.label {
  font-size: 13px;
  color: var(--text-secondary);
}
.label b {
  color: var(--text);
}
.big {
  font-size: 40px;
  font-weight: 600;
  letter-spacing: -1px;
  line-height: 1.1;
}
svg {
  flex: none;
}
.empty {
  flex: 1;
  margin: 0;
}
/* 各行共用列宽，名称列按最长的组件名 */
.legend {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 14px minmax(0, max-content) minmax(0, 1fr) auto;
  column-gap: 8px;
}
.legend li {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.legend li + li {
  border-top: 1px solid var(--line);
}
.legend i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage {
  font-size: 12px;
  color: var(--text-secondary);
}
.legend b {
  font-weight: 600;
}
</style>
