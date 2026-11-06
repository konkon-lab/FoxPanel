<!-- 滑块(Schema number 的 role: slider)：拖动时只改显示的数值，停下 300 ms 后交出去(没到时间就卸载时在卸载前交)；步长小于 1 时数值按百分比显示。
     样子照设置页「界面缩放」：8 px 轨道，方形键帽式拖块 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NSlider } from 'naive-ui';
import { createSettle } from './settle.ts';

const SETTLE_MS = 300;   // 停止拖动后多久交出数值(ms)

const props = defineProps<{ value: number; min: number; max: number; step?: number | undefined; label: string }>();
const emit = defineEmits<{ update: [value: number] }>();

const shown = ref(props.value);
watch(() => props.value, v => { shown.value = v; });
const text = computed(() => ((props.step ?? 1) < 1 ? `${Math.round(shown.value * 100)}%` : String(shown.value)));

// 拖出来还没交出去的数值：停下 SETTLE_MS 后交，卸载前把没交的交掉
const pending = createSettle<number>(SETTLE_MS, v => emit('update', v));
function onDrag(v: number): void {
  shown.value = v;
  pending.push(v);
}
onBeforeUnmount(pending.flush);

// Naive 滑块的样式覆盖：8px 轨道，20px 的键帽式拖块(下沿加深的内阴影)
const KNOB_SHADOW = 'inset 0 -3px 0 var(--line), 0 0 0 1px var(--control-border), 0 1px 2px rgba(0, 0, 0, 0.15)';
const LOOK = {
  railHeight: '8px', railColor: 'var(--control-border)', railColorHover: 'var(--control-border)', handleSize: '20px', handleColor: 'var(--surface)',
  handleBoxShadow: KNOB_SHADOW, handleBoxShadowHover: KNOB_SHADOW, handleBoxShadowActive: KNOB_SHADOW, handleBoxShadowFocus: `${KNOB_SHADOW}, 0 0 0 3px var(--accent-soft)`,
};
</script>

<template>
  <span class="slider">
    <n-slider :value="shown" :min="min" :max="max" :step="step ?? 1" :tooltip="false" :theme-overrides="LOOK" :aria-label="label" @update:value="onDrag" />
    <span class="value">{{ text }}</span>
  </span>
</template>

<style scoped>
.slider {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  width: 276px;
  flex: none;
}
/* 覆盖 Naive 的圆形拖块(它的选择器更具体) */
.slider :deep(.n-slider-handle) {
  width: 22px !important;
  border-radius: 5px !important;
}
.value {
  width: 44px;
  text-align: right;
  font-family: Consolas, monospace;
  font-size: 13px;
}
</style>
