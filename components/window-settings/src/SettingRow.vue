<!-- 设置页的一行：左边名字和说明，右边控件；改了立即保存到登记它的组件的配置。
     控件：开关、下拉(不能自填)、分段按钮(role: radio)、滑块(role: slider)、步进器、文字框；其他类型给「去组件页设置」 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NInput } from 'naive-ui';
import { locale, openComponent, textOf } from '@konkon-lab/foxpanel-window';
import type { ComponentRow, SettingDef } from '@konkon-lab/foxpanel-sdk';
import { setConfig } from '../../_shared/window/comp-fields.ts';
import SettingControl from '../../_shared/window/SettingControl.vue';
import SettingLine from './SettingLine.vue';
import { t } from './i18n.ts';

const props = defineProps<{ row: ComponentRow; def: SettingDef }>();

const label = computed(() => textOf(props.def.label, locale.value));
const desc = computed(() => (props.def.description ? textOf(props.def.description, locale.value) : ''));
const value = computed(() => props.row.config[props.def.key]);

const set = (v: unknown): void => setConfig(props.row.id, props.def.key, v);

// 文字框：离开或回车时保存
const text = ref(String(value.value ?? ''));
watch(value, v => { text.value = String(v ?? ''); });
const saveText = (): void => {
  if (text.value !== String(value.value ?? '')) set(text.value);
};
</script>

<template>
  <setting-line :label="label" :desc="desc">
    <setting-control
      v-if="def.type === 'toggle' || def.type === 'select' || def.type === 'number'" :def="def" :value="value" :config="row.config" :width="180"
      @update="set"
    />
    <n-input v-else-if="def.type === 'text'" v-model:value="text" class="text" :aria-label="label" @blur="saveText" @keydown.enter="saveText" />
    <n-button v-else @click="openComponent(row.id)">{{ t('settings.inComponent') }}</n-button>
  </setting-line>
</template>

<style scoped>
.text {
  width: 260px;
}
</style>
