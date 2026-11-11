<!-- 仪表盘：标题和每日一言；两列卡片：组件清单声明的快捷设置卡和组件经插槽 dashboard 放进来的卡片(area 选列，同列按 order)；
     左列最下面留一块空位；两列等高 -->
<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue';
import { locale, store, textOf, windows } from '@konkon-lab/foxpanel-window';
import type { ComponentRow, DashboardCard } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import ConfigCard from './ConfigCard.vue';
import { loadQuote, quote } from './quote.ts';

type Card = { key: string; order: number; slot: Component } | { key: string; order: number; row: ComponentRow; card: DashboardCard };

// 一列的卡片：清单声明的(组件关着也显示)和插槽里的，按 order 排
const cardsOf = (area: string): Card[] => [
  ...store.comps.rows.flatMap(row => (row.dashboard?.area === area ? [{ key: row.id, order: row.dashboard.order, row, card: row.dashboard }] : [])),
  ...windows.slots.filter(s => s.type === 'dashboard' && (s.area || 'left') === area).map((s, i) => ({ key: `${s.owner}:${i}`, order: s.order, slot: s.component })),
].sort((a, b) => a.order - b.order);
// 两列；spare = 最下面留一块空位
const columns = computed(() => [
  { area: 'left', cards: cardsOf('left'), spare: true },
  { area: 'right', cards: cardsOf('right'), spare: false },
]);

onMounted(() => { void loadQuote(); });
</script>

<template>
  <main class="dash">
    <div class="wrap">
      <header class="head">
        <h1>{{ t('home.title') }}</h1>
        <p v-if="quote.text" class="quote" :title="quote.text">
          <span class="text">「{{ quote.text }}」</span>
          <span v-if="quote.from" class="from">—— {{ quote.from }}</span>
        </p>
      </header>
      <div class="columns">
        <div v-for="col in columns" :key="col.area" class="col">
          <template v-for="c in col.cards" :key="c.key">
            <component :is="c.slot" v-if="'slot' in c" />
            <config-card
              v-else :id="c.row.id" :title="textOf(c.card.title, locale)" :keys="c.card.keys" :toggle="c.card.toggle && textOf(c.card.toggle, locale)"
              :link="c.card.link ? t('home.gotoConfig') : undefined" :grow="c.card.grow"
            />
          </template>
          <section v-if="col.spare" class="dash-card spare" aria-hidden="true" />
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* 铺满内容区：宽度跟窗口，两列等高并向下撑满 */
.dash {
  min-height: 100%;
  padding: 16px 32px 20px;
  background: var(--page-bg);
  display: flex;
}
.wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}
.quote {
  min-width: 0;
  max-width: 560px;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: var(--text-secondary);
}
.text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.from {
  flex: none;
  font-size: 12px;
}
.columns {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}
.col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* 左列最下面的空位：不画出来，只占高度(284px，和右列的翻译、语音卡对齐) */
.spare {
  flex: none;
  min-height: 284px;
  visibility: hidden;
}
</style>
