<!-- 费用 · 近 14 天：每天按组件堆叠的柱形，两条虚线刻度；图表高度随卡片拉伸 -->
<script setup lang="ts">
import { computed } from 'vue';
import { cost, price } from './cost.ts';
import { t } from './i18n.ts';
import { tickStep } from './ticks.ts';

const MIN_HEIGHT = 170;   // 图表区最矮的高度(px)
const HEADROOM = 1.05;    // 纵轴上限至少是最高柱的这么多倍(柱顶留白)
const TICK_ROOM = 2.2;    // 纵轴上限至少是刻度间隔的这么多倍(两条刻度都在图内)

const chart = computed(() => {
  const days = cost.value.recent;
  const series = cost.value.series;
  const max = Math.max(...days.map(d => d.total));
  const { step, digits } = tickStep(max);
  const top = Math.max(max * HEADROOM, step * TICK_ROOM);
  const pct = (v: number): string => `${((v / top) * 100).toFixed(2)}%`;
  const grid = [step, step * 2].map(v => ({ label: price(v, digits), bottom: pct(v) }));
  const last = days.length - 1;
  const cols = days.map((d, i) => {
    const [, m, day] = d.day.split('-');
    const segs = [...series].reverse().map(s => ({ ...s, value: d.by[s.id] ?? 0 })).filter(s => s.value > 0);
    const tip = `${Number(m)}/${Number(day)} ${price(d.total)}` + (segs.length ? `\n${[...segs].reverse().map(s => `${s.name} ${price(s.value, 3)}`).join('\n')}` : '');
    return { day: d.day, label: i === last ? t('cost.today') : `${Number(m)}/${Number(day)}`, today: i === last, segs, tip, total: d.total, height: pct(d.total) };
  });
  return { grid, cols };
});
</script>

<template>
  <section class="dash-card bars" :aria-label="t('cost.recentAria')">
    <div class="head">
      <h2>{{ t('cost.recentTitle') }}</h2>
      <div class="legend">
        <span v-for="s in cost.series" :key="s.id"><i :style="{ background: s.color }" />{{ s.name }}</span>
      </div>
    </div>
    <div class="chart">
      <div class="plot" :style="{ minHeight: `${MIN_HEIGHT}px` }">
        <div v-for="(g, i) in chart.grid" :key="i" class="tick" :style="{ bottom: g.bottom }">
          <span>{{ g.label }}</span>
        </div>
        <div v-for="c in chart.cols" :key="c.day" class="col" :title="c.tip">
          <span v-if="c.segs.length" class="stack" :style="{ height: c.height }">
            <span v-for="s in c.segs" :key="s.id" :style="{ flexGrow: s.value / c.total, background: s.color }" />
          </span>
        </div>
      </div>
      <div class="labels">
        <span v-for="c in chart.cols" :key="c.day" :class="{ today: c.today }">{{ c.label }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 14px;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.legend i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
/* 撑满所在列的剩余高度 */
.bars {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.chart {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-left: 36px;
}
.plot {
  flex: 1 1 0;
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.tick {
  position: absolute;
  left: -36px;
  right: 0;
  border-top: 1px dashed var(--line);
}
.tick > span {
  position: absolute;
  left: 0;
  top: -9px;
  padding-right: 6px;
  background: var(--surface);
  font-size: 11px;
  color: var(--text-secondary);
}
.col {
  position: relative;
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-end;
}
.stack {
  width: 100%;
  max-width: 26px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 4px 4px 0 0;
  overflow: hidden;
}
.stack > span {
  display: block;
  flex-basis: 0;
  min-height: 2px;
}
.labels {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.labels span {
  flex: 1;
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
}
.labels .today {
  color: var(--text);
  font-weight: 600;
}
</style>
