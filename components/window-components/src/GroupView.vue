<!-- 分组页：标题行(停用分组、重命名、移除分组、新建分组、安装组件)；分组设置(名字、默认折叠)；组件列表(拖动排序、开关)。
     「加载失败」那一页列出清单有误的文件夹 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NInput, NSwitch } from 'naive-ui';
import { FolderPlus, GripVertical, Pencil, Square, Trash2 } from '@lucide/vue';
import { fox, nav, openComponent, SINGLE_KINDS, store } from '@konkon-lab/foxpanel-window';
import type { ComponentRow } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { BROKEN_KEY, dropOn, findGroup, nameOf, newGroup, removeGroup, renameGroup, setDefaultFolded } from './comp-tree.ts';
import type { HeadAction } from './head-action.ts';
import { patch, run } from './ops.ts';
import PaneView from './PaneView.vue';
import AskDialog from '../../_shared/window/AskDialog.vue';
import DetailRow from '../../_shared/window/DetailRow.vue';
import DetailSection from '../../_shared/window/DetailSection.vue';
import Notice from '../../_shared/window/Notice.vue';
import { hasProtected, isProtected } from '../../_shared/window/protect.ts';

const props = defineProps<{ groupKey: string }>();

// 「加载失败」那一页没有分组；分组刚被移除时 node 也是空的
const broken = computed(() => props.groupKey === BROKEN_KEY);
const node = computed(() => findGroup(props.groupKey));
const title = computed(() => t('cp.groupTitle', { name: broken.value ? t('cp.group.broken') : node.value?.title ?? '' }));

// 能在这里停用的成员：开着的、不是单选类别的
const running = computed(() => (node.value?.rows ?? []).filter(r => r.on && !SINGLE_KINDS.has(r.kind)));
async function disableAll(): Promise<void> {
  for (const r of running.value) await patch({ kind: 'on', id: r.id, on: false });
}
async function addGroup(): Promise<void> {
  const key = await newGroup();
  if (key) nav.group = key;
}

// 分组里有保护名单里的组件时不能停用、不能删
const locked = computed(() => hasProtected(node.value?.rows ?? []));
const renaming = ref(false);
const removing = ref(false);
const actions = computed<HeadAction[]>(() => [
  { title: t('cp.disableGroup'), icon: Square, disabled: locked.value || !running.value.length, run: () => void disableAll() },
  { title: t('cp.rename'), icon: Pencil, disabled: !node.value, run: () => { renaming.value = true; } },
  { title: t('cp.removeGroup'), icon: Trash2, disabled: !node.value || locked.value, run: () => { removing.value = true; } },
  { title: t('cp.newGroup'), icon: FolderPlus, run: () => void addGroup() },
]);
function remove(): void {
  if (!node.value) return;
  removeGroup(node.value.group.id);
  nav.group = null;
}

// 名字框里的字：跟着分组的名字走，离开输入框或回车时保存；清空或没改时回到分组的名字
const name = ref('');
watch([() => props.groupKey, () => node.value?.group.name], ([, saved]) => { name.value = saved ?? ''; }, { immediate: true });
function saveName(): void {
  const g = node.value?.group;
  if (!g) return;
  const typed = name.value.trim();
  if (typed && typed !== g.name) renameGroup(g.id, typed);
  else name.value = g.name;
}

// 组件开关：单选类别只能选用
function setOn(r: ComponentRow, on: boolean): void {
  if (SINGLE_KINDS.has(r.kind)) {
    if (on) void patch({ kind: 'use', id: r.id });
    return;
  }
  void patch({ kind: 'on', id: r.id, on });
}

const dragging = ref<string | null>(null);
function drop(target: ComponentRow): void {
  const id = dragging.value;
  dragging.value = null;
  if (id && id !== target.id) dropOn(id, target, props.groupKey);
}

// 移除一个加载失败的文件夹；没成时错误显示在右栏上方
const removeBroken = (folder: string): void => void run(fox.compRemoveBroken(folder));
</script>

<template>
  <pane-view :title="title" :actions="actions">
    <template v-if="broken">
      <notice v-for="b in store.comps.broken" :key="b.folder" tone="error">
        <span class="grow"><b>{{ b.name }}</b> · {{ t('cp.brokenDesc') }}{{ b.errors.join('；') }}</span>
        <button type="button" class="link" @click="removeBroken(b.folder)">{{ b.dev ? t('comp.removeDev') : t('comp.uninstall') }}</button>
      </notice>
    </template>
    <template v-else-if="node">
      <notice tone="info">{{ t('cp.groupUser') }}</notice>

      <detail-section :title="t('cp.groupSettings')" legend="GROUP" tight>
        <detail-row :title="t('cp.groupName')" :desc="t('cp.groupNameDesc')">
          <n-input
            v-model:value="name" class="name" :aria-label="t('cp.groupName')"
            @blur="saveName" @keydown.enter="saveName"
          />
        </detail-row>
        <detail-row :title="t('cp.groupFold')" :desc="t('cp.groupFoldDesc')">
          <n-switch :value="node.defaultFolded" :aria-label="t('cp.groupFold')" @update:value="(v: boolean) => setDefaultFolded(groupKey, v)" />
        </detail-row>
      </detail-section>

      <detail-section :title="t('cp.groupMembers')" :legend="node.rows.length" tight>
        <template #body>
          <p class="meta">{{ t('cp.groupMembersDesc') }}</p>
          <div v-if="node.rows.length" class="list">
            <div
              v-for="r in node.rows" :key="r.id" class="member" :class="{ drag: dragging === r.id }" draggable="true"
              @dragstart="dragging = r.id" @dragend="dragging = null" @dragover.prevent @drop.prevent="drop(r)"
            >
              <grip-vertical class="grip" :size="16" :aria-label="t('cp.dragHint')" />
              <button type="button" class="who" @click="openComponent(r.id)">
                <b>{{ nameOf(r) }}</b> <span class="meta">{{ r.id }}</span>
              </button>
              <span class="legend">{{ r.kind.toUpperCase() }}</span>
              <n-switch :value="SINGLE_KINDS.has(r.kind) ? r.active : r.on" :disabled="isProtected(r.id)" :aria-label="nameOf(r)" @update:value="(v: boolean) => setOn(r, v)" />
            </div>
          </div>
          <p v-else class="meta empty">{{ t('cp.groupEmpty') }}</p>
        </template>
      </detail-section>
    </template>

    <template #dialogs>
      <ask-dialog v-if="node" v-model:show="renaming" :title="t('cp.rename')" :input="node.group.name" :ok="t('cp.apply')" @ok="(v: string) => renameGroup(node!.group.id, v)" />
      <ask-dialog v-if="node" v-model:show="removing" :title="t('cp.removeGroup')" :body="t('cp.removeConfirm', { name: node.group.name })" :ok="t('cp.removeGroup')" danger @ok="remove" />
    </template>
  </pane-view>
</template>

<style scoped>
.grow {
  flex: 1;
}
/* 成员行里的类别标记 */
.legend {
  font-family: Consolas, monospace;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.name {
  width: 240px;
}
.list {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.member {
  height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px 0 8px;
}
.member + .member {
  border-top: 1px solid var(--line);
}
.member:hover {
  background: var(--hover-bg);
}
.member.drag {
  opacity: 0.5;
}
.grip {
  color: #a3a7ae;
  cursor: grab;
  flex: none;
}
.who {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.who b {
  font-weight: 600;
}
.empty {
  margin-top: 12px;
}
</style>
