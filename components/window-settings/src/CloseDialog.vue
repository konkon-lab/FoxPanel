<!-- 关闭询问：点关闭且关闭方式为「每次询问」时弹出；最小化到托盘 / 退出 / 取消；勾「记住」时改本组件的「关闭窗口时」 -->
<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NCheckbox, NModal } from 'naive-ui';
import { fox } from '@konkon-lab/foxpanel-window';
import type { CloseAction } from '@konkon-lab/foxpanel-sdk';
import { setConfig } from '../../_shared/window/comp-fields.ts';
import { asking } from './ask.ts';
import { t } from './i18n.ts';

const remember = ref(false);

function answer(action: CloseAction | null): void {
  asking.value = false;
  if (action && remember.value) setConfig('yanuo.window-settings', 'closeAction', action);
  remember.value = false;
  fox.closeAnswer(action);
}
</script>

<template>
  <n-modal :show="asking" :mask-closable="true" :auto-focus="false" @update:show="(v: boolean) => !v && answer(null)">
    <section class="dialog" role="dialog" aria-labelledby="close-title" aria-modal="true">
      <h2 id="close-title">{{ t('tray.closeTitle') }}</h2>
      <p>{{ t('tray.closeBody') }}</p>
      <footer>
        <n-checkbox v-model:checked="remember">{{ t('tray.closeRemember') }}</n-checkbox>
        <span class="fill" />
        <n-button quaternary @click="answer(null)">{{ t('tray.cancel') }}</n-button>
        <n-button @click="answer('quit')">{{ t('tray.quit') }}</n-button>
        <n-button type="primary" @click="answer('tray')">{{ t('tray.minimizeToTray') }}</n-button>
      </footer>
    </section>
  </n-modal>
</template>

<style scoped>
.dialog {
  width: 440px;
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.18);
}
h2 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
}
p {
  margin: 0 0 20px;
  color: var(--text-secondary);
}
footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fill {
  flex: 1;
}
</style>
