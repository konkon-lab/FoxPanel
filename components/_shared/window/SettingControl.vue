<!-- 一个设置项的控件，按类型画：开关、分段按钮(select 的 radio)、滑块(number 的 slider)、步进器、下拉(select 和音频设备)；
     别的类型不画。width 是下拉框的宽度(px)；custom 时带 custom 的下拉能自填；dropOnly 时开关以外的类型都画成下拉(仪表盘的卡片) -->
<script setup lang="ts">
import { computed } from 'vue';
import { NSwitch } from 'naive-ui';
import { locale, textOf } from '@konkon-lab/foxpanel-window';
import type { SettingDef } from '@konkon-lab/foxpanel-sdk';
import { optionsOf } from './comp-fields.ts';
import { t } from './i18n.ts';
import DropSelect from './DropSelect.vue';
import NumStep from './NumStep.vue';
import SegButtons from './SegButtons.vue';
import SliderControl from './SliderControl.vue';

// config = 这个组件的全部设置(下拉选项取自 list 设置时用)
const props = defineProps<{ def: SettingDef; value: unknown; config: Record<string, unknown>; width: number; custom?: boolean; dropOnly?: boolean }>();
const emit = defineEmits<{ update: [value: boolean | number | string] }>();

const label = computed(() => textOf(props.def.label, locale.value));
const options = computed(() => optionsOf(props.def, props.config));
</script>

<template>
  <n-switch v-if="def.type === 'toggle'" :value="value === true" :aria-label="label" @update:value="(v: boolean) => emit('update', v)" />
  <seg-buttons
    v-else-if="!dropOnly && def.type === 'select' && def.radio" :value="String(value ?? '')" :options="options" :label="label"
    @update="(v: string) => emit('update', v)"
  />
  <slider-control
    v-else-if="!dropOnly && def.type === 'number' && def.slider" :value="typeof value === 'number' ? value : def.default" :min="def.min ?? 0" :max="def.max ?? 1" :step="def.step" :label="label"
    @update="(v: number) => emit('update', v)"
  />
  <num-step
    v-else-if="!dropOnly && def.type === 'number'" :value="typeof value === 'number' ? value : null" :min="def.min" :max="def.max" :step="def.step" :label="label"
    @update="(v: number) => emit('update', v)"
  />
  <drop-select
    v-else-if="dropOnly || def.type === 'select' || def.type === 'audioOutput' || def.type === 'audioInput'" :value="String(value ?? '')" :options="options"
    :width="width" :label="label" :allow-custom="custom && def.type === 'select' && def.custom === true" :custom-placeholder="t('cp.customValue', { name: label })"
    @update="(v: string) => emit('update', v)"
  />
</template>
