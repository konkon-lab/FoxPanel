<!-- 本月费用：大数字、日均和预计全月、本月累计走势线(横轴按整月)、按组件的分条 -->
<script setup lang="ts">
import { computed } from 'vue';
import { cost, price } from './cost.ts';
import { t } from './i18n.ts';

// 走势线的画布(viewBox 里的长度)
const W = 300;
const H = 70;
const PAD = 4;           // 线的上下各留的边
const HEADROOM = 1.12;   // 纵轴上限是预计全月(已累计的更多时按已累计)的这么多倍

const month = computed(() => cost.value.month);
const parts = computed(() => cost.value.series.map(s => ({ ...s, value: month.value.by[s.id] ?? 0 })).filter(s => s.value > 0));

// 累计线：横轴为整月，纵轴上限为预计全月并留余量；末端圆点以百分比定位在 SVG 外，避免被拉伸
const spark = computed(() => {
  const { cumulative, daysInMonth, projected } = month.value;
  const top = Math.max(projected, cumulative.at(-1) ?? 0) * HEADROOM || 1;
  const step = W / daysInMonth;
  const xy = cumulative.map((c, i) => [i * step, H - PAD - (c / top) * (H - PAD * 2)] as const);
  const [lx, ly] = xy.at(-1) ?? [0, H - PAD];
  return {
    points: xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    dot: { left: `${(lx / W) * 100}%`, top: `${(ly / H) * 100}%` },
  };
});

const projectedText = computed(() => price(month.value.projected, month.value.projected >= 10 ? 1 : 2));
</script>

<template>
  <section class="dash-card" :aria-label="t('cost.monthCost')">
    <div class="label">{{ t('cost.monthCost') }}</div>
    <div class="big">{{ price(month.total) }}</div>
    <div class="kv">
      <span>{{ t('cost.daily') }} <b>{{ price(month.daily) }}</b></span>
      <span>{{ t('cost.projected') }} <b>{{ projectedText }}</b></span>
    </div>
    <div class="spark">
      <svg width="100%" :height="H" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="t('cost.monthTrend')">
        <line x1="0" :y1="H - PAD" :x2="W" :y2="H - PAD" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke" />
        <polyline
          :points="spark.points" fill="none" stroke="var(--accent)" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"
        />
      </svg>
      <i class="dot" :style="spark.dot" />
    </div>
    <div class="split">
      <span v-for="p in parts" :key="p.id" :style="{ flex: p.value, background: p.color }" />
      <span v-if="!parts.length" :style="{ flex: 1, background: 'var(--line)' }" />
    </div>
    <div class="split-legend">
      <span v-for="p in parts" :key="p.id"><i :style="{ background: p.color }" />{{ p.name }} {{ price(p.value) }}</span>
    </div>
  </section>
</template>

<style scoped>
.label {
  font-size: 13px;
  color: var(--text-secondary);
}
.big {
  margin-top: 6px;
  font-size: 44px;
  font-weight: 600;
  letter-spacing: -1px;
  line-height: 1.1;
}
.kv {
  display: flex;
  gap: 18px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-secondary);
}
.kv b {
  color: var(--text);
}
.spark {
  position: relative;
  margin: 16px 0 18px;
}
.spark svg {
  display: block;
}
.dot {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -6px 0 0 -6px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  box-sizing: content-box;
}
.split {
  display: flex;
  height: 10px;
  gap: 2px;
  border-radius: 3px;
  overflow: hidden;
}
.split-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.split-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.split-legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
</style>
