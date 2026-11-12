<!-- 设置页：顶部搜索；各组件登记的节(同 id 合成一张卡片，按节顺序)，节里按组件顺序放自定义内容和配置项 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { NInput } from 'naive-ui';
import { Search } from '@lucide/vue';
import { isVisible, locale, store, textOf, windows } from '@konkon-lab/foxpanel-window';
import type { ComponentRow, SettingDef } from '@konkon-lab/foxpanel-sdk';
import SettingRow from './SettingRow.vue';
import { t } from './i18n.ts';

interface Part {
  key: string;
  row: ComponentRow;
  custom: unknown;
  defs: SettingDef[];
}
interface Section {
  id: string;
  title: string;
  parts: Part[];
}

const query = ref('');
const q = computed(() => query.value.trim().toLowerCase());
const hit = (...texts: string[]): boolean => !q.value || texts.join(' ').toLowerCase().includes(q.value);
const tx = (v: Parameters<typeof textOf>[0] | undefined): string => (v === undefined ? '' : textOf(v, locale.value));

// 登记 → 节；组件没开或已经没了的跳过；按条件显示的配置项照组件页的规则
const sections = computed<Section[]>(() => {
  const out: Section[] = [];
  for (const s of windows.settings) {
    const row = store.comps.rows.find(r => r.id === s.owner && r.active);
    if (!row) continue;
    let sec = out.find(x => x.id === s.id);
    if (!sec) out.push(sec = { id: s.id, title: tx(s.title), parts: [] });
    const titleHit = hit(sec.title);
    const defs = row.settings
      .filter(d => (s.keys === null || s.keys.includes(d.key)) && isVisible(d, row.config))
      .filter(d => titleHit || hit(tx(d.label), tx(d.description)));
    const custom = s.component && titleHit ? s.component : null;
    if (custom || defs.length) sec.parts.push({ key: `${s.owner}:${sec.parts.length}`, row, custom, defs });
  }
  return out.filter(x => x.parts.length);
});
</script>

<template>
  <main class="page">
    <h1>{{ t('settings.title') }}</h1>
    <n-input v-model:value="query" class="search" :placeholder="t('settings.search')" clearable :aria-label="t('settings.search')">
      <template #prefix><search :size="16" /></template>
    </n-input>
    <p v-if="!sections.length" class="meta empty">{{ t('settings.notFound', { q: query.trim() }) }}</p>
    <section v-for="s in sections" :key="s.id" class="group" :aria-label="s.title">
      <header><h2>{{ s.title }}</h2></header>
      <template v-for="p in s.parts" :key="p.key">
        <component :is="p.custom" v-if="p.custom" />
        <setting-row v-for="d in p.defs" :key="`${p.row.id}.${d.key}`" :row="p.row" :def="d" />
      </template>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 1040px;
  min-height: 100%;
  margin: 0 auto;
  padding: 16px 32px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}
.search {
  --n-height: 40px !important;
}
.empty {
  margin: 8px 0 0;
}
.group {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.group header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
}
.group h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
/* 每节最后一行不画底线 */
.group > :last-child {
  border-bottom: 0;
}
</style>
