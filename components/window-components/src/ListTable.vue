<!-- 表格设置的各行(通栏，在设置行下面)：每格一个文字框，每行最后一个删除按钮；改完的全部行经 set 交出去 -->
<script setup lang="ts">
import { NInput } from 'naive-ui';
import { Trash2 } from '@lucide/vue';
import { locale, textOf } from '@konkon-lab/foxpanel-window';
import type { Text } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import RowButton from './RowButton.vue';

type Row = Record<string, string>;

const props = defineProps<{ fields: readonly { key: string; label: Text }[]; rows: readonly Row[] }>();
const emit = defineEmits<{ set: [rows: Row[]] }>();

const setCell = (i: number, key: string, v: string): void => emit('set', props.rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
const removeRow = (i: number): void => emit('set', props.rows.filter((_r, j) => j !== i));
</script>

<template>
  <table class="vlist">
    <thead><tr><th v-for="f in fields" :key="f.key">{{ textOf(f.label, locale) }}</th><th class="del" /></tr></thead>
    <tbody>
      <tr v-for="(r, i) in rows" :key="i">
        <td v-for="f in fields" :key="f.key">
          <n-input :value="r[f.key] ?? ''" :aria-label="textOf(f.label, locale)" @update:value="(v: string) => setCell(i, f.key, v)" />
        </td>
        <td class="del">
          <row-button :title="t('comp.removeRow')" bare @click="removeRow(i)"><trash-2 :size="15" /></row-button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.vlist {
  grid-column: 1 / -1;
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th {
  padding: 0 8px 6px 0;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 400;
  text-align: left;
}
td {
  padding: 3px 8px 3px 0;
}
.del {
  width: 40px;
  padding-right: 0;
}
</style>
