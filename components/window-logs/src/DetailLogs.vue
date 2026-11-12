<!-- 组件详情里的「运行日志」一节(插槽 component-details)：这个组件最近的日志；一条都没有时不显示；日志组件自己的详情里不显示 -->
<script setup lang="ts">
import { computed } from 'vue';
import { store } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import LogLines from './LogLines.vue';
import DetailSection from '../../_shared/window/DetailSection.vue';
import { shown } from './level.ts';

const SHOWN = 100;                   // 显示的日志行数
const SELF = 'yanuo.window-logs';    // 日志组件自己

const props = defineProps<{ id: string }>();
const lines = computed(() => (props.id === SELF ? [] : store.logs.filter(l => l.source === props.id && shown(l)).slice(-SHOWN)));
</script>

<template>
  <detail-section v-if="lines.length" :title="t('log.section')" legend="LOGS">
    <template #body><log-lines :lines="lines" compact /></template>
  </detail-section>
</template>
