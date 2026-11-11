<!-- 组件页左栏：搜索 + 组件树(分组，下面是不在分组里的组件)。点分组标题打开分组页，点三角只在树里展开收起(不改默认折叠)；
     组件行带状态灯；拖到组件上调顺序或换分组，拖到分组标题上移进这个分组，拖到空白处移到顶层；
     拖分组标题调分组顺序(落在标题上半放前面，下半放后面)。
     拖动样式：拖分组时连同下面的组件一起拖，落点是一条 1 像素的强调色线，移进分组时分组名变成强调色底 -->
<script setup lang="ts">
import { ref } from 'vue';
import { ChevronRight, Search } from '@lucide/vue';
import { nav, store } from '@konkon-lab/foxpanel-window';
import type { ComponentRow } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { BROKEN_KEY, dropOn, moveGroup, moveTo, nameOf, query, resetFolded, root, ROOT_KEY, setFolded, visibleRoot, visibleTree, type TreeGroup, type TreeRows } from './comp-tree.ts';
import { dropsAfter } from './values.ts';

const dragging = ref<string | null>(null);        // 正在拖的组件 id
const draggingGroup = ref<string | null>(null);   // 正在拖的分组 key
const over = ref<string | null>(null);            // 拖到上面的分组 key 或组件 id
const after = ref(false);                         // 拖分组时落在目标标题的下半(放到它后面)

resetFolded();

function pickGroup(key: string): void {
  nav.group = key;
  nav.component = null;
}
function pickRow(id: string): void {
  nav.component = id;
  nav.group = null;
}

// 开始拖分组：拖动的图是整个分组(标题和下面的组件)
function startGroup(g: TreeGroup, e: DragEvent): void {
  draggingGroup.value = g.key;
  const box = (e.currentTarget as HTMLElement).parentElement;
  if (box && e.dataTransfer) e.dataTransfer.setDragImage(box, e.offsetX, e.offsetY);
}

// 拖组件到别的组件上时落点线画在哪边：同一段里往下拖落在它后面，其余落在它前面
function rowLine(r: ComponentRow, g: TreeRows): 'before' | 'after' | null {
  const id = dragging.value;
  if (!id || over.value !== r.id || id === r.id) return null;
  return dropsAfter(g.rows.map(x => x.id), id, r.id) ? 'after' : 'before';
}
// 拖分组到别的分组标题上时落点线画在哪边
function groupLine(g: TreeGroup): 'before' | 'after' | null {
  if (over.value !== g.key || !draggingGroup.value || draggingGroup.value === g.key) return null;
  return after.value ? 'after' : 'before';
}

// 拖到分组标题上：记下落点在上半还是下半
function overGroup(g: TreeGroup, e: DragEvent): void {
  over.value = g.key;
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  after.value = e.clientY > box.top + box.height / 2;
}
function dropGroup(g: TreeGroup): void {
  const id = dragging.value;
  const key = draggingGroup.value;
  dragging.value = over.value = draggingGroup.value = null;
  if (key) {
    if (key === g.key) return;
    const keys = visibleTree.value.map(x => x.key).filter(k => k !== key);
    moveGroup(key, after.value ? keys[keys.indexOf(g.key) + 1] ?? null : g.key);
    return;
  }
  if (id && !g.rows.some(r => r.id === id)) moveTo(id, g.key);
}
function dropRow(r: ComponentRow, g: TreeRows): void {
  const id = dragging.value;
  dragging.value = over.value = null;
  if (id && id !== r.id) dropOn(id, r, g.key);
}
// 拖到树的空白处：组件移到顶层
function dropRoot(): void {
  const id = dragging.value;
  dragging.value = over.value = null;
  if (id && !root.value.rows.some(r => r.id === id)) moveTo(id, ROOT_KEY);
}
// 状态灯：出错红、在用绿、关着灰
const led = (r: ComponentRow): string => (r.error ? 'err' : r.active ? 'ok' : 'idle');
</script>

<template>
  <aside class="aside" :aria-label="t('comp.title')" @dragover.prevent @drop.prevent="dropRoot">
    <label class="search">
      <search :size="14" aria-hidden="true" />
      <input v-model="query" type="search" :placeholder="t('cp.search')" :aria-label="t('cp.search')">
    </label>
    <div role="tree" :aria-label="t('comp.title')" :class="{ dragging: dragging || draggingGroup }">
      <div
        v-for="g in visibleTree" :key="g.key" class="branch" role="group" :aria-label="g.title"
        :class="[groupLine(g), { drag: draggingGroup === g.key }]"
      >
        <div
          class="group" role="treeitem" tabindex="0" draggable="true"
          :class="{ on: nav.group === g.key, inner: over === g.key && dragging !== null && !g.rows.some(r => r.id === dragging) }"
          :aria-expanded="!g.folded" :aria-current="nav.group === g.key ? 'page' : undefined"
          @click="pickGroup(g.key)" @keydown.enter="pickGroup(g.key)"
          @dragstart="startGroup(g, $event)" @dragend="draggingGroup = over = null"
          @dragover.prevent.stop="overGroup(g, $event)" @dragleave="over = null" @drop.prevent.stop="dropGroup(g)"
        >
          <button
            type="button" class="caret" :class="{ open: !g.folded }" :title="t(g.folded ? 'cp.unfold' : 'cp.fold', { name: g.title })"
            :aria-label="t(g.folded ? 'cp.unfold' : 'cp.fold', { name: g.title })" @click.stop="setFolded(g.key, !g.folded)"
          >
            <chevron-right :size="14" />
          </button>
          <span class="title">{{ t('cp.groupTitle', { name: g.title }) }}</span>
        </div>
        <template v-if="!g.folded">
          <div
            v-for="r in g.rows" :key="r.id" class="node" :class="[{ on: nav.component === r.id, off: !r.on, drag: dragging === r.id }, rowLine(r, g)]"
            role="treeitem" tabindex="0" draggable="true" :aria-current="nav.component === r.id ? 'page' : undefined"
            @click="pickRow(r.id)" @keydown.enter="pickRow(r.id)"
            @dragstart.stop="dragging = r.id" @dragend="dragging = over = null"
            @dragover.prevent.stop="over = r.id" @drop.prevent.stop="dropRow(r, g)"
          >
            <span class="name">{{ nameOf(r) }}</span>
            <span class="led" :class="led(r)" aria-hidden="true" />
          </div>
        </template>
      </div>
      <div
        v-for="r in visibleRoot" :key="r.id" class="node top" :class="[{ on: nav.component === r.id, off: !r.on, drag: dragging === r.id }, rowLine(r, root)]"
        role="treeitem" tabindex="0" draggable="true" :aria-current="nav.component === r.id ? 'page' : undefined"
        @click="pickRow(r.id)" @keydown.enter="pickRow(r.id)"
        @dragstart.stop="dragging = r.id" @dragend="dragging = over = null"
        @dragover.prevent.stop="over = r.id" @drop.prevent.stop="dropRow(r, root)"
      >
        <span class="name">{{ nameOf(r) }}</span>
        <span class="led" :class="led(r)" aria-hidden="true" />
      </div>
      <div v-if="store.comps.broken.length" role="group" :aria-label="t('cp.group.broken')">
        <div class="group" :class="{ on: nav.group === BROKEN_KEY }" role="treeitem" tabindex="0" @click="pickGroup(BROKEN_KEY)" @keydown.enter="pickGroup(BROKEN_KEY)">
          <span class="caret static" aria-hidden="true" />
          <span class="title">{{ t('cp.groupTitle', { name: t('cp.group.broken') }) }}</span>
        </div>
      </div>
      <p v-if="!visibleTree.length && !visibleRoot.length" class="meta none">{{ t('cp.noMatch') }}</p>
    </div>
  </aside>
</template>

<style scoped>
.aside {
  width: 228px;
  flex: none;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 16px 0 24px;
  background: var(--surface);
  border-right: 1px solid var(--line);
}
.aside::-webkit-scrollbar {
  display: none;
}
.search {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 4px;
  padding: 0 10px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
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
.group,
.node {
  height: 32px;
  display: flex;
  align-items: center;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}
.group {
  padding: 0 24px 0 8px;
  font-weight: 700;
}
.node {
  justify-content: space-between;
  gap: 8px;
  padding: 0 24px 0 50px;
}
.node.top {
  padding-left: 30px;
}
.group:hover,
.node:hover {
  background: var(--hover-bg);
}
.group.on,
.node.on {
  background: #e9eaee;
  color: var(--accent);
}
.branch,
.node {
  position: relative;
}
.branch.before::before,
.branch.after::after,
.node.before::before,
.node.after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--accent);
  pointer-events: none;
}
.branch.before::before,
.node.before::before {
  top: 0;
}
.branch.after::after,
.node.after::after {
  bottom: 0;
}
.branch.drag {
  opacity: 0.5;
}
.group.inner .title {
  background: var(--accent);
  color: #ffffff;
}
.dragging .group,
.dragging .node {
  cursor: move;
}
.caret {
  width: 24px;
  height: 24px;
  flex: none;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #a8abb2;
  cursor: pointer;
  transition: transform 0.15s;
}
.caret:hover {
  color: var(--text);
}
.caret.open {
  transform: rotate(90deg);
}
.caret.static {
  cursor: default;
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node.off {
  color: var(--text-secondary);
}
.node.drag {
  opacity: 0.5;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.led {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.led.ok {
  background: #5fbf4a;
}
.led.idle {
  background: #909399;
  opacity: 0.5;
}
.led.err {
  background: #d14343;
}
.none {
  padding: 12px 24px;
}
@media (prefers-color-scheme: dark) {
  .group.on,
  .node.on {
    background: #2a2d35;
  }
}
</style>
