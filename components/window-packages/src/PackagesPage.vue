<!-- 依赖管理：标题行(全部更新、应用更改、手动添加、刷新)；通栏表格 组件 / 本地版本 / 目标版本 / 操作。
     从 npm 装的组件能选仓库里的版本(新的在前)，全部更新换到各自的最新版；
     目标版本改了或选「移除」后这一行标成改过，点「修改」或「应用更改」生效；开发文件夹里的组件不能在这里改，保护名单里的组件没有「移除」 -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { NButton, NDropdown, NSelect } from 'naive-ui';
import { Check, Plus, RefreshCcw, Rocket } from '@lucide/vue';
import { fox, locale, openComponent, store } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import type { ComponentRow } from '@konkon-lab/foxpanel-sdk';
import { comps } from '../../_shared/window/components-service.ts';
import { REMOVE, targetValues } from './targets.ts';
import ActionHead from '../../_shared/window/ActionHead.vue';
import AskDialog from '../../_shared/window/AskDialog.vue';
import IconAction from '../../_shared/window/IconAction.vue';
import InstallFloat from '../../_shared/window/InstallFloat.vue';

// 组件管理提供的显示名、安装流程和错误
const nameOf = (r: ComponentRow): string => comps.value?.nameOf(r) ?? r.id;
const pending = computed(() => comps.value?.pending ?? null);
const installMenu = computed(() => [...comps.value?.installMenu ?? []]);
const onInstallMenu = (key: string): void => comps.value?.install(key);
const confirmInstall = (ok: boolean): void => void comps.value?.confirm(ok);
const lastError = computed({
  get: () => comps.value?.error ?? '',
  set: (v: string) => { if (comps.value) comps.value.error = v; },
});

const rows = computed(() => [...store.comps.rows].sort((a, b) => nameOf(a).localeCompare(nameOf(b), locale.value)));

// npm 装的组件在仓库里的版本(新的在前)：包名 → 版本
const versions = reactive<Record<string, string[]>>({});
async function loadVersions(): Promise<void> {
  await Promise.all(store.comps.rows.flatMap(r => (r.npm ? [r.npm] : [])).map(async name => {
    const res = await fox.marketInfo(name);
    if (res.ok) versions[name] = res.pkg.versions;
  }));
}
onMounted(() => void loadVersions());
const latestOf = (r: ComponentRow): string | null => (r.npm ? versions[r.npm]?.[0] ?? null : null);
const outdated = (r: ComponentRow): boolean => {
  const latest = latestOf(r);
  return latest !== null && latest !== r.version;
};

// 每行的目标：当前版本、仓库里的别的版本，或移除
const target = reactive<Record<string, string>>({});
const targetOf = (r: ComponentRow): string => target[r.id] ?? r.version;
const changed = (r: ComponentRow): boolean => targetOf(r) !== r.version;
const options = (r: ComponentRow): { value: string; label: string }[] => targetValues(r, versions)
  .map(v => ({ value: v, label: v === REMOVE ? t('pk.remove') : v === r.version ? t('pk.current', { v }) : v }));
const changes = computed(() => rows.value.filter(changed));
const updatable = computed(() => rows.value.filter(outdated));

// 改过的行：换版本直接装；有移除的先确认
const confirming = ref<ComponentRow[]>([]);
const showConfirm = computed({ get: () => confirming.value.length > 0, set: v => { if (!v) confirming.value = []; } });
const removing = computed(() => confirming.value.filter(r => targetOf(r) === REMOVE));
const confirmBody = computed(() => t('pk.removeConfirm', { list: removing.value.map(nameOf).join('、') }));
const busy = ref(false);
function apply(list: ComponentRow[]): void {
  if (!list.length) return;
  if (list.some(r => targetOf(r) === REMOVE)) confirming.value = list;
  else void run(list);
}
async function run(list: readonly ComponentRow[]): Promise<void> {
  busy.value = true;
  for (const r of list) {
    const to = targetOf(r);
    const res = to === REMOVE ? await fox.compRemove(r.id) : r.npm ? await fox.compNpm({ op: 'add', name: r.npm, version: to }) : { ok: true as const };
    if (!res.ok) lastError.value = res.error;
    delete target[r.id];
  }
  busy.value = false;
}
async function confirmApply(): Promise<void> {
  const list = confirming.value;
  confirming.value = [];
  await run(list);
}
// 全部更新：npm 装的换到最新版
function updateAll(): void {
  for (const r of updatable.value) target[r.id] = latestOf(r) ?? r.version;
  void run(updatable.value);
}

async function refresh(): Promise<void> {
  store.comps = await fox.compList();
  await loadVersions();
}
</script>

<template>
  <div class="view">
    <action-head :title="t('pk.title')">
      <icon-action :title="t('pk.updateAll')" :disabled="busy || !updatable.length" @click="updateAll"><rocket :size="18" /></icon-action>
      <icon-action :title="t('pk.apply')" :disabled="busy || !changes.length" @click="apply(changes)"><check :size="18" /></icon-action>
      <n-dropdown trigger="click" :options="installMenu" placement="bottom-end" @select="onInstallMenu">
        <icon-action :title="t('pk.add')"><plus :size="18" /></icon-action>
      </n-dropdown>
      <icon-action :title="t('pk.refresh')" @click="refresh"><refresh-ccw :size="18" /></icon-action>
    </action-head>

    <main class="page">
      <install-float sticky :pending="pending" :error="lastError" @confirm="confirmInstall" @dismiss="lastError = ''" />

      <table class="pkgs">
        <colgroup><col><col style="width: 18%"><col style="width: 24%"><col style="width: 14%"></colgroup>
        <thead><tr><th>{{ t('pk.component') }}</th><th>{{ t('pk.version') }}</th><th>{{ t('pk.target') }}</th><th>{{ t('pk.actions') }}</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="pkg">
            <td>
              <button type="button" class="name" @click="openComponent(r.id)">{{ nameOf(r) }}</button>
              <span class="id">{{ r.id }}</span>
            </td>
            <td class="mono">
              {{ r.version }}<template v-if="r.dev"> ({{ t('pk.devFolder') }})</template>
              <span v-else-if="outdated(r)" class="new"> ({{ t('pk.outdated') }})</span>
              <span v-else-if="latestOf(r)" class="dim"> ({{ t('pk.latest') }})</span>
            </td>
            <td>
              <span v-if="r.dev" class="dim">—</span>
              <n-select
                v-else class="sel mono" :class="{ changed: changed(r) }" size="small" :value="targetOf(r)" :options="options(r)"
                :aria-label="t('pk.targetOf', { name: nameOf(r) })" @update:value="(v: string) => (target[r.id] = v)"
              />
            </td>
            <td>
              <span v-if="r.dev" class="dim">—</span>
              <n-button v-else size="small" :disabled="busy || !changed(r)" @click="apply([r])">{{ t('pk.modify') }}</n-button>
            </td>
          </tr>
        </tbody>
      </table>
    </main>

    <ask-dialog v-model:show="showConfirm" :title="t('pk.apply')" :body="confirmBody" :ok="t('pk.apply')" danger @ok="confirmApply" />
  </div>
</template>

<style scoped>
.view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.page {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.pkgs {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 44px;
  padding: 0 16px;
  background: var(--page-bg);
  border-bottom: 1px solid var(--line);
  font-family: Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}
td {
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px dashed var(--line);
  white-space: nowrap;
}
th:first-child,
td:first-child {
  padding-left: 32px;
}
.pkg:hover {
  background: var(--hover-bg);
}
.name {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.name:hover {
  color: var(--accent);
}
.id {
  margin-left: 6px;
  font-family: Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}
.mono {
  font-family: Consolas, monospace;
  font-size: 13px;
}
.dim {
  color: var(--text-secondary);
}
.new {
  color: var(--accent);
}
.sel {
  width: 180px;
}
.sel.changed :deep(.n-base-selection) {
  --n-border: 1px solid var(--accent) !important;
  --n-text-color: var(--accent) !important;
}
</style>
