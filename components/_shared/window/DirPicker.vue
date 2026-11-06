<!-- 选目录对话框(不用系统资源管理器)：在数据文件夹里逐层浏览，点文件夹进去，
     顶上的路径可以跳回上层；可以新建文件夹；确定 = 选当前所在的文件夹 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NModal } from 'naive-ui';
import { Folder, FolderPlus, X } from '@lucide/vue';
import { fox } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';

const props = defineProps<{ show: boolean; value: string; title: string }>();
const emit = defineEmits<{ 'update:show': [show: boolean]; pick: [rel: string] }>();

const rel = ref('');           // 当前所在的文件夹(相对数据文件夹，/ 分隔)
const dirs = ref<string[]>([]);
const error = ref('');
const making = ref(false);
const newName = ref('');

const parts = computed(() => (rel.value ? rel.value.split('/') : []));

async function go(to: string): Promise<void> {
  const r = await fox.dirList(to);
  if (!r.ok) {
    error.value = r.error;
    return;
  }
  error.value = '';
  rel.value = r.rel;
  dirs.value = r.dirs;
}
// 打开时进到已经选着的目录(value)；进不去就从数据文件夹开始
watch(() => props.show, async open => {
  if (!open) return;
  making.value = false;
  await go(props.value);
  if (error.value) await go('');
});

const join = (name: string): string => (rel.value ? `${rel.value}/${name}` : name);
const up = (): Promise<void> => go(parts.value.slice(0, -1).join('/'));
const crumb = (i: number): Promise<void> => go(parts.value.slice(0, i + 1).join('/'));

async function make(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  const r = await fox.dirMake(rel.value, name);
  if (!r.ok) {
    error.value = r.error;
    return;
  }
  making.value = false;
  newName.value = '';
  await go(join(name));
}

// 收起新建文件夹的输入框：Esc、点叉，或者名字为空时点到别处
function cancelNew(): void {
  making.value = false;
  newName.value = '';
}

function close(): void {
  emit('update:show', false);
}
function ok(): void {
  emit('pick', rel.value);
  close();
}
</script>

<template>
  <!-- 不锁焦点：Naive 的焦点锁会把焦点从新建文件夹的原生输入框里拉走 -->
  <n-modal :show="show" :auto-focus="false" :trap-focus="false" @update:show="(v: boolean) => emit('update:show', v)">
    <section class="picker" role="dialog" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <button type="button" class="x" :title="t('comp.cancel')" :aria-label="t('comp.cancel')" @click="close"><x :size="16" /></button>
      </header>
      <nav class="crumbs" :aria-label="t('dir.where')">
        <button type="button" class="link" @click="go('')">{{ t('dir.root') }}</button>
        <template v-for="(p, i) in parts" :key="i">
          <span>/</span>
          <b v-if="i === parts.length - 1">{{ p }}</b>
          <button v-else type="button" class="link" @click="crumb(i)">{{ p }}</button>
        </template>
      </nav>
      <div class="dirs" role="listbox" :aria-label="t('dir.folders')">
        <button v-if="parts.length" type="button" class="row" @click="up"><folder :size="16" />..</button>
        <button v-for="d in dirs" :key="d" type="button" class="row" role="option" :aria-selected="false" @click="go(join(d))"><folder :size="16" />{{ d }}</button>
        <p v-if="!dirs.length && !parts.length" class="none">{{ t('dir.empty') }}</p>
        <div v-if="making" class="row new">
          <folder-plus :size="16" />
          <input v-model="newName" class="name" :placeholder="t('dir.newName')" :aria-label="t('dir.newName')" @keydown.enter="make" @keydown.esc="cancelNew" @blur="newName.trim() || cancelNew()">
          <button type="button" class="x" :title="t('comp.cancel')" :aria-label="t('comp.cancel')" @mousedown.prevent @click="cancelNew"><x :size="14" /></button>
        </div>
        <button v-else type="button" class="row new" @click="making = true"><folder-plus :size="16" />{{ t('dir.new') }}</button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
      <footer>
        <span class="cur">{{ rel || t('dir.root') }}</span>
        <span class="acts">
          <n-button quaternary @click="close">{{ t('comp.cancel') }}</n-button>
          <n-button type="primary" @click="ok">{{ t('cp.apply') }}</n-button>
        </span>
      </footer>
    </section>
  </n-modal>
</template>

<style scoped>
.picker {
  width: 560px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.18);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}
h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.x {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.x:hover {
  background: var(--hover-bg);
}
.crumbs {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 20px;
  padding: 0 10px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
}
.link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.link:hover {
  color: var(--accent);
}
.crumbs b {
  color: var(--text);
  font-weight: 600;
}
.dirs {
  max-height: 260px;
  margin: 12px 20px 0;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.row {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.row:last-child {
  border-bottom: 0;
}
.row:hover {
  background: var(--hover-bg);
}
.row svg {
  flex: none;
  color: var(--text-secondary);
}
.row.new {
  color: var(--text-secondary);
}
div.row.new {
  cursor: default;
}
/* 新建文件夹的名字框：灰色细边，不用强调色 */
.name {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--control-border);
  border-radius: 4px;
  outline: 0;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.name:focus {
  border-color: var(--text-secondary);
}
.none {
  margin: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  color: var(--text-secondary);
  font-size: 13px;
}
.err {
  margin: 8px 20px 0;
  color: #d14343;
  font-size: 12px;
}
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
}
.cur {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: Consolas, monospace;
  font-size: 12px;
  color: var(--text-secondary);
}
.acts {
  display: flex;
  gap: 8px;
  flex: none;
}
</style>
