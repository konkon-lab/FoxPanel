<!-- 仪表盘上的快捷设置卡(组件清单的 dashboard 声明)：标题旁是组件开关或「前往设置」，下面按 keys 列出组件的设置项(下拉、设备、开关)；
     grow 时撑满所在列的剩余高度 -->
<script setup lang="ts">
import { computed } from 'vue';
import { NSwitch } from 'naive-ui';
import { fox, locale, openComponent, store, textOf } from '@konkon-lab/foxpanel-window';
import { setConfig } from '../../_shared/window/comp-fields.ts';
import SettingControl from '../../_shared/window/SettingControl.vue';

const props = defineProps<{ id: string; title: string; keys: readonly string[]; toggle?: string | undefined; link?: string | undefined; grow?: boolean }>();

const row = computed(() => store.comps.rows.find(r => r.id === props.id) ?? null);
const fields = computed(() => (row.value ? props.keys.flatMap(k => row.value?.settings.find(d => d.key === k) ?? []) : []));
const setOn = (on: boolean): void => void fox.compSet({ kind: 'on', id: props.id, on });
</script>

<template>
  <section v-if="row" class="dash-card" :class="{ grow }" :aria-label="title">
    <div class="card-head">
      <h2>{{ title }}</h2>
      <n-switch v-if="toggle" :value="row.on" :aria-label="toggle" @update:value="setOn" />
      <button v-if="link" type="button" class="link" @click="openComponent(id)">{{ link }}</button>
    </div>
    <div v-for="d in fields" :key="d.key" class="form-row">
      <span>{{ textOf(d.label, locale) }}</span>
      <setting-control
        :def="d" :value="row.config[d.key]" :config="row.config" :width="200" custom drop-only
        @update="(v: boolean | number | string) => setConfig(id, d.key, v)"
      />
    </div>
  </section>
</template>

<style scoped>
.grow {
  flex: 1;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
</style>
