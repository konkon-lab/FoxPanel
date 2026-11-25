<!-- 组件详情里的「在线记录」一节(插槽 component-details)：只在本组件的详情里显示。列出发送状态(正在发送，或不发送的原因)
     和一条记录里的三项：设备标识、会话标识、程序版本；两个标识默认打码，点「显示」看全文(能选中复制)。主进程部分还没给状态时不显示 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton } from 'naive-ui';
import { store } from '@konkon-lab/foxpanel-window';
import DetailRow from '../../_shared/window/DetailRow.vue';
import DetailSection from '../../_shared/window/DetailSection.vue';
import { EVERY_MS } from './beat.ts';
import { t } from './i18n.ts';
import { telemetry } from './view.ts';

const SELF = 'yanuo.telemetry';       // 本组件
const MASK = '•'.repeat(24);          // 打码时显示的字符
const MINUTE_MS = 60_000;

const props = defineProps<{ id: string }>();
const shown = ref(false);   // 标识显示着全文

const state = computed(() => (props.id === SELF ? telemetry.value : null));
const status = computed(() => {
  const off = state.value?.off ?? null;
  return off === null ? { text: t('tm.on'), on: true } : { text: t(`tm.off.${off}`), on: false };
});
const idText = (id: string): string => (shown.value ? id : MASK);
</script>

<template>
  <detail-section v-if="state" :title="t('tm.record')" legend="RECORD">
    <detail-row :title="t('tm.status')" :desc="t('tm.statusDesc', { n: EVERY_MS / MINUTE_MS })">
      <span class="badge" :class="{ on: status.on }">{{ status.text }}</span>
    </detail-row>
    <detail-row :title="t('tm.device')" :desc="t('tm.deviceDesc')">
      <span class="value" :class="{ shown }">{{ idText(state.device) }}</span>
    </detail-row>
    <detail-row :title="t('tm.session')" :desc="t('tm.sessionDesc')">
      <span class="value" :class="{ shown }">{{ idText(state.session) }}</span>
    </detail-row>
    <detail-row :title="t('tm.version')" :desc="t('tm.versionDesc')">
      <span class="value shown">{{ store.version }}</span>
    </detail-row>
    <template #body>
      <div class="foot"><n-button @click="shown = !shown">{{ t(shown ? 'tm.hide' : 'tm.show') }}</n-button></div>
    </template>
  </detail-section>
</template>

<style scoped>
.badge {
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 12px;
  white-space: nowrap;
  background: var(--track);
  color: var(--text-secondary);
}
.badge.on {
  background: rgba(31, 122, 71, 0.12);
  color: var(--success);
}
.value {
  max-width: 520px;
  overflow-wrap: anywhere;
  text-align: right;
  color: var(--text-secondary);
  font-family: Consolas, monospace;
  font-size: 12.5px;
}
.value.shown {
  user-select: text;
}
.foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
