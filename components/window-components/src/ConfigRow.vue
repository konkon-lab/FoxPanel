<!-- 组件设置的一行：左边名字和说明，右边控件，最右「⋯」菜单(编辑 JSON、撤销更改、恢复默认值；secret 是清除)。
     目录按钮、文字框和表格的「添加一行」在这里画，标签、secret、表格的各行、JSON 对话框各是一个零件，其余类型交给 SettingControl。
     值改在草稿里(set)，没保存的行左边有靛蓝竖条 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { NDropdown, NInput } from 'naive-ui';
import { Ellipsis, Plus } from '@lucide/vue';
import { locale, textOf } from '@konkon-lab/foxpanel-window';
import type { ComponentRow, SettingDef } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { clone } from './values.ts';
import JsonDialog from './JsonDialog.vue';
import ListTable from './ListTable.vue';
import RowButton from './RowButton.vue';
import SecretField from './SecretField.vue';
import TagsField from './TagsField.vue';
import DirPicker from '../../_shared/window/DirPicker.vue';
import SettingControl from '../../_shared/window/SettingControl.vue';

// secret = 这一项 secret 的草稿(没改过是 undefined，空字符串 = 清除)
const props = defineProps<{ row: ComponentRow; def: SettingDef; draft: Record<string, unknown>; dirty: boolean; secret?: string | undefined }>();
const emit = defineEmits<{ set: [value: unknown] }>();

const label = computed(() => textOf(props.def.label, locale.value));
const desc = computed(() => (props.def.description ? textOf(props.def.description, locale.value) : ''));
const value = computed(() => props.draft[props.def.key]);
// 这一项 secret 已经存了值
const secretSaved = computed(() => props.row.secrets[props.def.key] === true);
// secret 验证没过的原因，显示在说明的位置
const secretError = ref('');

const picking = ref(false);    // 选目录的对话框开着
const jsonOpen = ref(false);   // 编辑 JSON 的对话框开着

// 表格的各行；「添加一行」加一行空的
const listRows = computed(() => (Array.isArray(value.value) ? value.value as Record<string, string>[] : []));
function addRow(): void {
  if (props.def.type === 'list') emit('set', [...listRows.value, Object.fromEntries(props.def.fields.map(f => [f.key, '']))]);
}

// 「⋯」菜单
const menu = computed(() => [
  { key: 'json', label: t('cp.editJson'), disabled: props.def.type === 'secret' },
  { key: 'undo', label: t('cp.undo'), disabled: !props.dirty },
  props.def.type === 'secret'
    ? { key: 'clear', label: t('comp.secretClear'), disabled: !secretSaved.value }
    : { key: 'reset', label: t('cp.reset') },
]);
function onMenu(key: string): void {
  const d = props.def;
  if (key === 'json') jsonOpen.value = true;
  else if (key === 'undo') emit('set', d.type === 'secret' ? undefined : props.row.config[d.key]);
  else if (key === 'clear') emit('set', '');
  else if (key === 'reset') emit('set', clone('default' in d ? d.default : null));
}
</script>

<template>
  <div class="cfg" :class="{ dirty }">
    <div class="text">
      <h3>{{ label }}</h3>
      <p v-if="secretError" class="error">{{ secretError }}</p>
      <p v-else-if="desc">{{ desc }}</p>
    </div>
    <div class="control">
      <button v-if="def.type === 'directory'" type="button" class="path" :title="t('cp.dirPick', { name: label })" @click="picking = true">
        <b>{{ t('cp.dirLabel') }}</b>{{ String(value ?? '') || t('dir.root') }}
      </button>
      <tags-field v-else-if="def.type === 'tags'" :def="def" :value="value" :label="label" @set="(v: (number | string)[]) => emit('set', v)" />
      <n-input v-else-if="def.type === 'text'" class="txt" :value="String(value ?? '')" :aria-label="label" @update:value="(v: string) => emit('set', v)" />
      <secret-field
        v-else-if="def.type === 'secret'" :owner="row.id" :field="def.key" :label="label" :saved="secretSaved" :hint="row.secretHints[def.key]" :draft="secret"
        @set="(v: string) => emit('set', v)" @error="(text: string) => secretError = text"
      />
      <button v-else-if="def.type === 'list'" type="button" class="add" @click="addRow"><plus :size="14" />{{ t('comp.addRow') }}</button>
      <setting-control v-else :def="def" :value="value" :config="draft" :width="240" custom @update="(v: boolean | number | string) => emit('set', v)" />
    </div>
    <n-dropdown trigger="click" :options="menu" placement="bottom-end" @select="onMenu">
      <row-button :title="t('cp.more', { name: label })"><ellipsis :size="16" /></row-button>
    </n-dropdown>

    <list-table v-if="def.type === 'list' && listRows.length" :fields="def.fields" :rows="listRows" @set="(v: Record<string, string>[]) => emit('set', v)" />

    <dir-picker v-if="def.type === 'directory'" v-model:show="picking" :value="String(value ?? '')" :title="t('cp.dirPick', { name: label })" @pick="(v: string) => emit('set', v)" />
    <json-dialog v-model:show="jsonOpen" :label="label" :value="value" @apply="(v: unknown) => emit('set', v)" />
  </div>
</template>

<style scoped>
.cfg {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 32px;
  align-items: center;
  column-gap: 16px;
  row-gap: 12px;
  min-height: 72px;
  padding: 10px 16px;
  border-left: 3px solid transparent;
  border-top: 1px solid var(--line);
}
.cfg:last-child {
  border-bottom: 1px solid var(--line);
}
.cfg.dirty {
  border-left-color: var(--accent);
}
h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
}
p {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}
p.error {
  color: var(--warning);
}
.control {
  display: flex;
  align-items: center;
  gap: 8px;
}
.path {
  height: 36px;
  max-width: 280px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 14px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.path:hover {
  border-color: var(--accent);
}
.txt {
  width: 260px;
}
.add {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.add:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
