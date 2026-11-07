<!-- 语言组件详情里的「基础设置」一节(插槽 component-details)：模式多于一个时选输入模式(立即生效)；拼音能导入搜狗词库；
     不是语言组件、或两样都没有时不显示 -->
<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSelect } from 'naive-ui';
import { locale, textOf } from '@konkon-lab/foxpanel-window';
import { MODE, SOGOU } from './channels.ts';
import { bus, info, sogou } from './state.ts';
import { t } from './i18n.ts';
import DetailRow from '../../_shared/window/DetailRow.vue';
import DetailSection from '../../_shared/window/DetailSection.vue';

const props = defineProps<{ id: string }>();

const lang = computed(() => info.langs.find(l => l.id === props.id) ?? null);
const modes = computed(() => (lang.value?.modes ?? []).map(m => ({ value: m.id, label: textOf(m.label, locale.value) })));
const modeId = computed(() => info.modes[props.id] ?? lang.value?.modes[0]?.id ?? '');
const shown = computed(() => modes.value.length > 1 || lang.value?.pinyin === true);
const sogouDesc = computed(() => sogou.message || (info.sogouWords ? t('ime.sogouDone', { n: info.sogouWords.toLocaleString() }) : t('ime.sogouDesc')));

function setMode(mode: string): void {
  info.modes = { ...info.modes, [props.id]: mode };
  bus.value?.send(MODE, { id: props.id, mode });
}
function importSogou(): void {
  sogou.importing = true;
  sogou.message = '';
  bus.value?.send(SOGOU);
}
</script>

<template>
  <detail-section v-if="shown" :title="t('ime.config')" legend="CONFIG">
    <detail-row v-if="modes.length > 1" :title="t('ime.mode')" inset open-end>
      <n-select class="sel" :value="modeId" :options="modes" :aria-label="t('ime.mode')" @update:value="setMode" />
    </detail-row>
    <detail-row v-if="lang?.pinyin" :title="t('ime.sogou')" :desc="sogouDesc" inset open-end>
      <n-button :loading="sogou.importing" @click="importSogou">{{ t('ime.sogouImport') }}</n-button>
    </detail-row>
  </detail-section>
</template>

<style scoped>
.sel {
  width: 240px;
}
</style>
