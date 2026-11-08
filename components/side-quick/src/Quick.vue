<!-- 快捷设置：三个开关、发送到(装着的输出组件，点一下开关)、清除聊天气泡 -->
<script setup lang="ts">
import { computed } from 'vue';
import type { KeyboardSettings } from '@konkon-lab/foxpanel-sdk';
import { useCtx, useWords } from '../../_shared/vue.ts';
import { TEXT } from './words.ts';
import KbIcon, { type IconName } from '../../_shared/Icon.vue';

type Flag = 'showTyping' | 'autoSend' | 'pinMessage';
const FLAGS: readonly Flag[] = ['showTyping', 'autoSend', 'pinMessage'];
const FLAG_ICONS: Readonly<Record<Flag, IconName>> = { showTyping: 'typing', autoSend: 'bolt', pinMessage: 'pin' };

const ctx = useCtx();
const t = useWords(TEXT);
const s = computed(() => ctx.kb.state.settings);

function set(patch: Partial<KeyboardSettings>): void {
  ctx.kb.act({ kind: 'settings', patch });
}

// 发送到：装着的输出组件，可以一个都没有
const outputs = computed(() => ctx.kb.state.outputs);
</script>

<template>
  <div class="quick card">
    <div v-for="f in FLAGS" :key="f" class="row">
      <kb-icon class="row-icon" :name="FLAG_ICONS[f]" :size="18" />
      <span>{{ t[f] }}</span>
      <button type="button" role="switch" class="switch" :class="{ on: s[f] }" :aria-checked="s[f]" :aria-label="t[f]" @mousedown="set({ [f]: !s[f] })">
        <span class="knob" />
      </button>
    </div>
    <div v-if="outputs.length" class="targets">
      <span class="hint">{{ t.sendTo }}</span>
      <div class="pair">
        <button
          v-for="o in outputs" :key="o.id" type="button" class="target" :class="{ on: o.on }"
          :aria-pressed="o.on" @mousedown="ctx.kb.setOutput(o.id, !o.on)"
        >{{ ctx.i18n.text(o.name) }}</button>
      </div>
    </div>
    <span class="grow" />
    <button type="button" class="wide" @mousedown="ctx.kb.act({ kind: 'clearOutputs' })"><kb-icon name="broom" :size="18" />{{ t.clearChatbox }}</button>
  </div>
</template>

<style scoped>
.quick {
  display: flex;
  flex-direction: column;
  padding: 4px 14px 12px;
}
.row {
  height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--line);
  font-size: 15px;
}
.row > span {
  flex: 1;
}
.row-icon {
  flex: 0 0 auto;
  color: var(--sub);
}
.switch {
  width: 40px;
  height: 22px;
  flex: 0 0 auto;
  padding: 2px !important;
  border-radius: 11px;
  background: var(--switch-off) !important;
  display: flex;
  justify-content: flex-start;
}
.switch.on {
  background: var(--accent) !important;
  justify-content: flex-end;
}
.knob {
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--knob);
}
.targets {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
}
.hint {
  font-size: 13px;
  color: var(--sub);
}
.pair {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.target {
  flex: 1 1 40%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  height: 36px;
  border: 1px solid var(--line) !important;
  border-radius: 6px;
}
.target.on {
  border-color: transparent !important;
  background: var(--accent-soft) !important;
  color: var(--accent) !important;
  font-weight: 600;
}
.grow {
  flex: 1;
}
.wide {
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--line) !important;
  border-radius: 6px;
}
.wide:active,
.target:active {
  background: var(--key) !important;
}
.wide :deep(svg) {
  color: var(--sub);
}
</style>
