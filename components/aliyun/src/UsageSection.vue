<!-- 组件详情里的「用量」一节(插槽 component-details)：今天、最近 7 天、本月的主要用量和费用；清单没声明 usage 的组件不显示 -->
<script setup lang="ts">
import { computed } from 'vue';
import { money, store } from '@konkon-lab/foxpanel-window';
import DetailSection from '../../_shared/window/DetailSection.vue';
import { lastDays, monthDays } from './book.ts';
import { usageOf } from './cost.ts';
import { today } from './state.ts';
import { t } from './i18n.ts';

const WEEK_DAYS = 7;   // 「最近 7 天」一格的天数

const props = defineProps<{ id: string }>();

const cards = computed(() => {
  const decl = store.comps.rows.find(r => r.id === props.id)?.usage;
  if (!decl) return [];
  const now = today.value;
  return [
    { key: 'today', legend: `TODAY · ${t('usage.today')}`, days: lastDays(now, 1) },
    { key: 'week', legend: `7D · ${t('usage.week')}`, days: lastDays(now, WEEK_DAYS) },
    { key: 'month', legend: `MONTH · ${t('usage.month')}`, days: monthDays(now) },
  ].map(c => {
    const u = usageOf(props.id, c.days);
    return { key: c.key, legend: c.legend, cost: money(u.cost, decl.currency, 2), amount: u.main || t('usage.none') };
  });
});
</script>

<template>
  <DetailSection v-if="cards.length" :title="t('usage.title')" legend="USAGE">
    <template #body>
      <div class="cards">
        <div v-for="u in cards" :key="u.key" class="card">
          <span class="legend">{{ u.legend }}</span>
          <span class="nums"><span class="meta">{{ u.amount }}</span><span class="big">{{ u.cost }}</span></span>
        </div>
      </div>
      <p class="meta">{{ t('usage.estimate') }}</p>
    </template>
  </DetailSection>
</template>

<style scoped>
.legend {
  font-family: Consolas, monospace;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.nums {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.big {
  font-size: 22px;
  font-weight: 600;
}
</style>
