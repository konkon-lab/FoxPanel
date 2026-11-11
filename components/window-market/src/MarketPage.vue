<!-- 市场页：标题行(刷新)；左栏按类别、状态(未安装 / 已安装 / 可更新)、纯数据筛选，带数量；右边搜索、排序和组件卡片
     (名字和已安装 / 可更新标记、作者、版本、更新时间、简介、类别、纯数据、月下载量；按钮是安装、更新或打开)。
     装之前弹确认框(许可证、发布者、替换的版本、带程序的提醒、宿主版本不合时装不上) -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NButton, NModal, NSelect } from 'naive-ui';
import { Download, Puzzle, RefreshCcw, Search } from '@lucide/vue';
import { fox, locale, openComponent, store, textOf } from '@konkon-lab/foxpanel-window';
import type { ComponentKind, ComponentRow, MarketItem, MarketPackage } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { kindName } from '../../_shared/window/i18n.ts';
import ActionHead from '../../_shared/window/ActionHead.vue';
import IconAction from '../../_shared/window/IconAction.vue';

// 状态：没从 npm 装过这个包算未安装(本地装的同 id 组件会被 npm 装的替换)
type State = 'notInstalled' | 'installed' | 'updatable';
const STATES: readonly State[] = ['notInstalled', 'installed', 'updatable'];
const stateName = (st: State): string => t(`mk.state.${st}`);

// 一张卡片：市场里的包和按它算好的显示内容
interface Card {
  item: MarketItem;
  name: string;                          // 显示名
  desc: string;                          // 简介：清单里的，没有时用包的
  installed: ComponentRow | undefined;   // 已装的同 id 组件(npm 装的、预装的或 zip 装的)
  state: State;
}

const DAY_MS = 86_400_000;   // 一天的毫秒数

const items = ref<MarketItem[]>([]);
const loading = ref(false);     // 正在读列表
const failed = ref('');         // 读列表的错误
const query = ref('');
const kind = ref<ComponentKind | ''>('');
const state = ref<State | ''>('');
const dataOnly = ref(false);
const sort = ref<'downloads' | 'date' | 'name'>('downloads');
const working = ref<string | null>(null);   // 正在装的包
const error = ref('');          // 读包详情或安装的错误

async function load(refresh: boolean): Promise<void> {
  loading.value = true;
  failed.value = '';
  const r = await fox.marketSearch(refresh);
  loading.value = false;
  if (r.ok) items.value = r.items;
  else failed.value = r.error;
}
onMounted(() => void load(false));

const nameOf = (i: MarketItem): string => textOf(i.component.name, locale.value);
const sorts = computed(() => [
  { value: 'downloads', label: t('mk.sortDownloads') },
  { value: 'date', label: t('mk.sortDate') },
  { value: 'name', label: t('mk.sortName') },
]);

// 全部卡片：已装的组件按 id 查
const installedById = computed(() => new Map(store.comps.rows.map(r => [r.id, r])));
const cards = computed<Card[]>(() => items.value.map(item => {
  const installed = installedById.value.get(item.component.id);
  const npm = installed?.npm === item.name ? installed : undefined;
  return {
    item, installed,
    name: nameOf(item),
    desc: item.component.description ? textOf(item.component.description, locale.value) : item.description,
    state: !npm ? 'notInstalled' : npm.version === item.version ? 'installed' : 'updatable',
  };
}));

// 搜索：显示名、包名、发布者、简介里有这段字(不分大小写)
const searched = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? cards.value.filter(c => [c.name, c.item.name, c.item.publisher, c.desc].some(s => s.toLowerCase().includes(q))) : cards.value;
});
// 左栏的筛选项和数量(按搜索之后的结果数)
const kindCounts = computed(() => {
  const n = new Map<ComponentKind, number>();
  for (const c of searched.value) n.set(c.item.component.kind, (n.get(c.item.component.kind) ?? 0) + 1);
  return [...n].map(([k, count]) => ({ kind: k, count }));
});
const stateCounts = computed(() => {
  const n: Record<State, number> = { notInstalled: 0, installed: 0, updatable: 0 };
  for (const c of searched.value) n[c.state]++;
  return n;
});
const dataCount = computed(() => searched.value.filter(c => !c.item.component.code).length);

const shown = computed(() => {
  const list = searched.value.filter(c => (!kind.value || c.item.component.kind === kind.value)
    && (!state.value || c.state === state.value) && (!dataOnly.value || !c.item.component.code));
  if (sort.value === 'date') return [...list].sort((a, b) => b.item.date.localeCompare(a.item.date));
  if (sort.value === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, locale.value));
  return list;
});

// 组件来源的显示名：主机名
const source = computed(() => {
  try {
    return new URL(store.settings.components.market.registry).hostname;
  } catch {
    return store.settings.components.market.registry;
  }
});

// 更新时间：几天前
const rtf = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }));
function ago(date: string): string {
  const days = Math.round((Date.parse(date) - Date.now()) / DAY_MS);
  if (!Number.isFinite(days)) return '';
  if (days > -30) return rtf.value.format(days, 'day');
  if (days > -365) return rtf.value.format(Math.round(days / 30), 'month');
  return rtf.value.format(Math.round(days / 365), 'year');
}
const count = (n: number): string => n.toLocaleString(locale.value);
// 发布不满一天的版本能装的时间
const readyText = (iso: string): string => (iso ? new Date(iso).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' }) : '—');

// 安装确认：读包的详情(许可证、宿主版本范围)；对话框关完再清掉内容
const confirming = ref<{ item: MarketItem; pkg: MarketPackage } | null>(null);
const show = ref(false);
async function ask(i: MarketItem): Promise<void> {
  error.value = '';
  working.value = i.name;
  const r = await fox.marketInfo(i.name, i.version);
  working.value = null;
  if (r.ok) {
    confirming.value = { item: i, pkg: r.pkg };
    show.value = true;
  } else error.value = r.error;
}
const replaces = computed(() => (confirming.value ? installedById.value.get(confirming.value.item.component.id)?.version ?? null : null));
async function install(): Promise<void> {
  const c = confirming.value;
  if (!c) return;
  show.value = false;
  working.value = c.item.name;
  const r = await fox.compNpm({ op: 'add', name: c.item.name, version: c.pkg.version });
  working.value = null;
  if (!r.ok) error.value = r.error;
}
</script>

<template>
  <div class="view">
    <action-head :title="t('mk.title')">
      <icon-action :title="t('mk.refresh')" :disabled="loading" @click="load(true)"><refresh-ccw :size="18" /></icon-action>
    </action-head>

    <main class="page">
      <aside class="filter" :aria-label="t('mk.filters')">
        <h2>{{ t('mk.category') }}</h2>
        <button type="button" class="f" :aria-pressed="kind === ''" @click="kind = ''">{{ t('mk.all') }}<small>{{ searched.length }}</small></button>
        <button v-for="k in kindCounts" :key="k.kind" type="button" class="f" :aria-pressed="kind === k.kind" @click="kind = kind === k.kind ? '' : k.kind">
          {{ kindName(k.kind) }}<small>{{ k.count }}</small>
        </button>
        <h2>{{ t('mk.status') }}</h2>
        <button v-for="st in STATES" :key="st" type="button" class="f" :aria-pressed="state === st" @click="state = state === st ? '' : st">
          {{ stateName(st) }}<small>{{ stateCounts[st] }}</small>
        </button>
        <h2>{{ t('mk.other') }}</h2>
        <button type="button" class="f" :aria-pressed="dataOnly" @click="dataOnly = !dataOnly">{{ t('mk.dataOnly') }}<small>{{ dataCount }}</small></button>
      </aside>
      <div class="content">
        <div class="tools">
          <label class="search">
            <search :size="14" aria-hidden="true" />
            <input v-model="query" type="search" :placeholder="t('mk.search')" :aria-label="t('mk.search')">
          </label>
          <n-select v-model:value="sort" class="sel" :options="sorts" :aria-label="t('mk.sort')" />
        </div>
        <p class="meta">
          <template v-if="loading">{{ t('mk.loading') }}</template>
          <template v-else-if="failed">{{ t('mk.failed', { error: failed }) }}</template>
          <template v-else>{{ t('mk.count', { n: shown.length, source }) }}</template>
        </p>
        <p v-if="error" class="error" @click="error = ''">{{ error }}</p>

        <div v-if="shown.length" class="grid">
          <article v-for="{ item, name, desc, installed, state: st } in shown" :key="item.name" class="card">
            <div class="top">
              <span class="icon" aria-hidden="true"><puzzle :size="20" /></span>
              <div class="who">
                <h2>
                  <button v-if="installed" type="button" class="name" @click="openComponent(item.component.id)">{{ name }}</button>
                  <template v-else>{{ name }}</template>
                  <span v-if="st !== 'notInstalled'" class="mark" :class="st">{{ stateName(st) }}</span>
                </h2>
                <p class="sub">{{ item.publisher }} · {{ st === 'updatable' ? `${installed?.version} → ${item.version}` : item.version }} · {{ ago(item.date) }}</p>
              </div>
            </div>
            <p class="desc">{{ desc }}</p>
            <div class="foot">
              <span class="tags">
                <span class="tag">{{ kindName(item.component.kind) }}</span>
                <span v-if="!item.component.code" class="tag data">{{ t('mk.dataOnly') }}</span>
                <span class="dl"><download :size="12" aria-hidden="true" />{{ t('mk.perMonth', { n: count(item.downloads) }) }}</span>
              </span>
              <n-button v-if="working === item.name" size="small" loading disabled>{{ t('mk.working') }}</n-button>
              <n-button v-else-if="st === 'installed'" size="small" @click="openComponent(item.component.id)">{{ t('mk.open') }}</n-button>
              <n-button v-else-if="st === 'updatable'" size="small" type="primary" :disabled="working !== null" @click="ask(item)">{{ t('mk.updateShort') }}</n-button>
              <n-button v-else size="small" type="primary" :disabled="working !== null" @click="ask(item)">{{ t('mk.install') }}</n-button>
            </div>
          </article>
        </div>
        <p v-else-if="!loading && !failed" class="none">{{ t('mk.empty') }}</p>
      </div>
    </main>

    <n-modal v-model:show="show" @after-leave="confirming = null">
      <section v-if="confirming" class="dialog" role="dialog" :aria-label="t('mk.confirmTitle', { name: nameOf(confirming.item), version: confirming.pkg.version })">
        <h2>{{ t('mk.confirmTitle', { name: nameOf(confirming.item), version: confirming.pkg.version }) }}</h2>
        <p class="meta">{{ t('mk.from', { pkg: confirming.item.name, license: confirming.pkg.license || '—', who: confirming.item.publisher || '—' }) }}</p>
        <p v-if="replaces !== null" class="meta">{{ t('mk.replaces', { version: replaces }) }}</p>
        <p v-if="!confirming.pkg.component" class="warn">{{ t('mk.notComponent') }}</p>
        <p v-else-if="!confirming.pkg.compatible" class="warn">{{ t('mk.incompatible', { range: confirming.pkg.sdk ?? '' }) }}</p>
        <p v-else-if="confirming.pkg.readyAt !== undefined" class="warn">{{ t('mk.notYet', { time: readyText(confirming.pkg.readyAt) }) }}</p>
        <p v-else-if="confirming.pkg.component.code" class="warn">{{ t('mk.codeWarn') }}</p>
        <footer>
          <n-button quaternary @click="show = false">{{ t('mk.cancel') }}</n-button>
          <n-button type="primary" :disabled="!confirming.pkg.compatible || confirming.pkg.readyAt !== undefined" @click="install">{{ t('mk.install') }}</n-button>
        </footer>
      </section>
    </n-modal>
  </div>
</template>

<style scoped>
.view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--page-bg);
}
.filter {
  width: 220px;
  flex: none;
  box-sizing: border-box;
  padding: 16px 12px 24px;
  border-right: 1px solid var(--line);
  background: var(--surface);
  overflow: auto;
}
.filter h2 {
  margin: 16px 12px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.filter h2:first-child {
  margin-top: 4px;
}
.f {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.f:hover {
  background: var(--hover-bg);
}
.f[aria-pressed='true'] {
  background: var(--accent-tint);
  color: var(--accent);
  font-weight: 600;
}
.f small {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}
.f[aria-pressed='true'] small {
  color: var(--accent);
}
.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.mark {
  height: 20px;
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: 2px;
}
.mark.installed {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}
.mark.updatable {
  background: var(--accent-tint);
  color: var(--accent);
}
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 16px 24px 0;
}
.search {
  flex: 1 1 280px;
  min-width: 0;
  height: 34px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-secondary);
}
.search:focus-within {
  border-color: var(--accent);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.sel {
  width: 140px;
}
.meta {
  margin: 0;
  padding: 12px 24px 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.dialog .meta {
  padding: 0;
}
.error {
  margin: 12px 24px 0;
  padding: 10px 16px;
  border: 1px solid var(--warning-line);
  border-radius: var(--radius);
  background: var(--warning-bg);
  color: var(--warning);
  white-space: pre-wrap;
  cursor: pointer;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  padding: 16px 24px 32px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 172px;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.icon {
  width: 40px;
  height: 40px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: var(--radius);
  background: var(--accent-tint);
  color: var(--accent);
}
.who {
  min-width: 0;
  flex: 1;
}
.card h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}
.name {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.name:hover {
  color: var(--accent);
}
.sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desc {
  flex: 1;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tag {
  height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--hover-bg);
  font-size: 12px;
  white-space: nowrap;
}
.tag.data {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}
.dl {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.none {
  margin: 48px 24px;
  text-align: center;
  color: var(--text-secondary);
}
.dialog {
  width: min(480px, calc(100vw - 48px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 24px;
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--text);
}
.dialog h2 {
  margin: 0 0 4px;
  font-size: 16px;
}
.warn {
  margin: 4px 0 0;
  color: var(--warning);
}
.dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
