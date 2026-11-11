<!-- 组件详情：标题行(启用 / 选用 / 停用、保存设置、重命名、卸载、安装组件)；版本和链接；提示条；
     设置各节(改在草稿里，保存设置时一起提交)；别的组件放进来的节(插槽 component-details) -->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Check, Pencil, Play, Square, Trash2 } from '@lucide/vue';
import { fox, isVisible, locale, nav, openComponent, openPage, SINGLE_KINDS, store, textOf, windows } from '@konkon-lab/foxpanel-window';
import type { ComponentFeature, ComponentRow } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { nameOf } from './comp-tree.ts';
import type { HeadAction } from './head-action.ts';
import { patch, run } from './ops.ts';
import { inSettings } from './settings.ts';
import { clone, writeDraft } from './values.ts';
import ConfigRow from './ConfigRow.vue';
import PaneView from './PaneView.vue';
import AskDialog from '../../_shared/window/AskDialog.vue';
import DetailSection from '../../_shared/window/DetailSection.vue';
import Notice from '../../_shared/window/Notice.vue';
import { isProtected } from '../../_shared/window/protect.ts';

const props = defineProps<{ row: ComponentRow }>();

// 草稿：组件换了或保存后重新取
const draft = reactive<Record<string, unknown>>({});
// secret 的草稿：输入了新值(空字符串 = 清除)才有
const secretDraft = reactive<Record<string, string>>({});
function resetDraft(): void {
  for (const k of Object.keys(draft)) delete draft[k];
  for (const k of Object.keys(secretDraft)) delete secretDraft[k];
  Object.assign(draft, clone(props.row.config));
}
watch(() => props.row.id, resetDraft, { immediate: true });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const configDirty = computed(() => Object.keys(draft).filter(k => !same(draft[k], props.row.config[k])));
const dirtyKeys = computed(() => [...configDirty.value, ...Object.keys(secretDraft)]);
const isSecret = (key: string): boolean => props.row.settings.some(d => d.key === key && d.type === 'secret');
// 改草稿里的一项；owner 不是正在显示的组件时不收(换组件时，上一个组件的滑块在卸载前还会交一次值)
function setDraft(owner: string, key: string, v: unknown): void {
  writeDraft(draft, secretDraft, props.row.id, { owner, key, value: v, secret: isSecret(key) });
}
// 设置在别处改了(仪表盘、键盘面板)：没改过的项跟着变
watch(() => props.row.config, c => {
  for (const [k, v] of Object.entries(c)) if (!configDirty.value.includes(k)) draft[k] = clone(v);
}, { deep: true });

// 保存：secret 逐个加密保存，其余设置一次提交
async function save(): Promise<void> {
  if (!dirtyKeys.value.length) return;
  for (const [key, value] of Object.entries(secretDraft)) {
    if (!await run(fox.compSecret(props.row.id, key, value.trim()))) return;
  }
  const values = Object.fromEntries(configDirty.value.map(k => [k, draft[k]]));
  if (!configDirty.value.length || await patch({ kind: 'configs', id: props.row.id, values })) resetDraft();
}

// 启用 / 停用：单选类别没在用时是「选用」，在用时「停用」就是这一类都不用；保护名单里的不能停用、不能卸载
const single = computed(() => SINGLE_KINDS.has(props.row.kind));
const locked = computed(() => isProtected(props.row.id));
const power = computed<HeadAction>(() => {
  const { id, kind, active, on } = props.row;
  const stop = { title: t('cp.disable'), icon: Square, disabled: locked.value };
  if (single.value) {
    if (active) return { ...stop, run: () => void patch({ kind: 'none', of: kind }) };
    return { title: t('cp.select'), icon: Play, run: () => void patch({ kind: 'use', id }) };
  }
  if (on) return { ...stop, run: () => void patch({ kind: 'on', id, on: false }) };
  return { title: t('cp.enable'), icon: Play, run: () => void patch({ kind: 'on', id, on: true }) };
});
const renaming = ref(false);
const removing = ref(false);
const actions = computed<HeadAction[]>(() => [
  power.value,
  { title: dirtyKeys.value.length ? `${t('cp.save')}(${t('cp.unsaved')})` : t('cp.save'), icon: Check, disabled: !dirtyKeys.value.length, run: () => void save() },
  { title: t('cp.rename'), icon: Pencil, run: () => { renaming.value = true; } },
  { title: props.row.dev ? t('comp.removeDev') : t('comp.uninstall'), icon: Trash2, disabled: locked.value, run: () => { removing.value = true; } },
]);
const rename = (name: string): void => void patch({ kind: 'name', id: props.row.id, name });
// 卸载(开发中的只移除文件夹登记)；没成时留在这一页，错误显示在右栏上方
async function remove(): Promise<void> {
  if (await run(fox.compRemove(props.row.id))) nav.component = null;
}

const open = (url: string): void => void fox.openExternal(url);

// 别的组件放进详情页的内容(插槽 component-details)：order 小于 0 的在设置各节前面，其余在后面
const slotsBefore = computed(() => windows.slots.filter(x => x.type === 'component-details' && x.order < 0));
const slotsAfter = computed(() => windows.slots.filter(x => x.type === 'component-details' && x.order >= 0));

// 组件正在提供的功能的说明
const featureText = (f: ComponentFeature): string => t(`cp.feature.${f}`);

// 设置分节：节标题没写时叫「基础设置」；只显示条件满足的设置项，在设置页改的项不显示。
// 一节什么都没有时不显示。owner = 这些设置项属于哪个组件
const sections = computed(() => {
  const r = props.row;
  const list = r.sections.length ? r.sections : [{ keys: [] as string[] }];
  return list.map(sec => ({
    owner: r.id,
    title: sec.title ? textOf(sec.title, locale.value) : t('cp.config'),
    defs: r.settings.filter(d => sec.keys.includes(d.key) && isVisible(d, draft) && !inSettings(r.id, d)),
  })).filter(sec => sec.defs.length);
});

// 这个组件注册的主窗口页面
const ownPages = computed(() => windows.pages.filter(p => p.owner === props.row.id));

// 提示条：组件进程崩溃的那条只给带代码的组件；一条都没有时不留空的一格
const hostDown = computed(() => store.comps.host === 'crashed' && props.row.code);
const hasNotices = computed(() => {
  const r = props.row;
  return Boolean(r.error || r.dev || hostDown.value || r.requires?.length || r.provides?.length || r.features?.length || ownPages.value.length);
});
</script>

<template>
  <pane-view :title="`${nameOf(row)} [${row.id}]`" :actions="actions">
    <div class="links">
      <span class="chip">{{ t('cp.currentVersion', { v: row.version }) }}</span>
      <button v-if="row.repository" type="button" class="chip link" @click="open(row.repository)">{{ t('cp.repository') }}</button>
      <button v-if="row.bugs" type="button" class="chip link" @click="open(row.bugs)">{{ t('cp.bugs') }}</button>
    </div>

    <div v-if="hasNotices" class="notices">
      <notice v-if="row.error" tone="error"><span :title="row.error">{{ t('cp.loadFailed') }}</span></notice>
      <notice v-if="hostDown" tone="warn">
        <span>{{ t('comp.hostCrashed') }}</span>
        <button type="button" class="link" @click="fox.compHostRestart()">{{ t('comp.hostRestart') }}</button>
      </notice>
      <template v-for="s in row.requires ?? []" :key="s.name">
        <notice :tone="s.on ? 'ok' : 'warn'">
          <span>{{ t('cp.requires') }}<button v-if="s.id" type="button" class="link" @click="openComponent(s.id)">{{ s.name }}</button><template v-else>{{ s.name }}</template> {{ s.on ? t('cp.loaded') : t('cp.notLoaded') }}</span>
        </notice>
      </template>
      <notice v-for="name in row.provides ?? []" :key="name" :tone="row.active ? 'ok' : 'info'">{{ t(row.active ? 'cp.providesService' : 'cp.willProvide', { name }) }}</notice>
      <notice v-for="f in row.features ?? []" :key="f" tone="ok">{{ featureText(f) }}</notice>
      <notice v-for="p in ownPages" :key="p.id" tone="ok">
        <span>{{ t('cp.providesPage') }}<button type="button" class="link" @click="openPage(p.id)">{{ textOf(p.title, locale) }}</button></span>
      </notice>
      <notice v-if="row.dev" tone="info">
        <span>{{ t('cp.devFolder', { path: row.folder }) }}</span>
        <button type="button" class="link" @click="fox.compOpenFolder(row.folder)">{{ t('comp.openFolder') }}</button>
      </notice>
    </div>

    <component :is="x.component" v-for="(x, i) in slotsBefore" :id="row.id" :key="`before:${i}`" />

    <detail-section v-for="sec in sections" :key="sec.title" :title="sec.title" legend="CONFIG">
      <config-row
        v-for="d in sec.defs" :key="`${row.id}:${d.key}`" :row="row" :def="d" :draft="draft" :secret="secretDraft[d.key]"
        :dirty="dirtyKeys.includes(d.key)" @set="(v: unknown) => setDraft(sec.owner, d.key, v)"
      />
    </detail-section>

    <component :is="x.component" v-for="(x, i) in slotsAfter" :id="row.id" :key="`after:${i}`" />

    <template #dialogs>
      <ask-dialog v-model:show="renaming" :title="t('cp.rename')" :body="t('cp.renameDesc')" :input="store.settings.components.names[row.id] ?? ''" :ok="t('cp.apply')" @ok="rename" />
      <ask-dialog
        v-model:show="removing" :title="row.dev ? t('comp.removeDevOk', { name: nameOf(row) }) : t('comp.uninstallOk', { name: nameOf(row) })"
        :body="row.dev ? t('comp.removeDevConfirm', { name: nameOf(row) }) : t('comp.uninstallConfirm', { name: nameOf(row) })"
        :ok="row.dev ? t('comp.removeDev') : t('comp.uninstall')" danger @ok="remove"
      />
    </template>
  </pane-view>
</template>

<style scoped>
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.chip {
  height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.chip.link {
  cursor: pointer;
}
.chip.link:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.notices {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
