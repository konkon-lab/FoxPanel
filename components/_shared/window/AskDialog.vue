<!-- 小对话框：确认一件事，或输入一行文字(input 不为 undefined 时显示输入框) -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { NButton, NInput, NModal } from 'naive-ui';
import { t } from './i18n.ts';

const props = defineProps<{ title: string; body?: string; input?: string; ok: string; danger?: boolean }>();
const show = defineModel<boolean>('show', { required: true });
const emit = defineEmits<{ ok: [value: string] }>();

const text = ref('');
watch(show, v => { if (v) text.value = props.input ?? ''; });

function confirm(): void {
  show.value = false;
  emit('ok', text.value);
}
</script>

<template>
  <n-modal v-model:show="show" :auto-focus="input !== undefined">
    <section class="dialog" role="dialog" :aria-label="title">
      <h2>{{ title }}</h2>
      <p v-if="body">{{ body }}</p>
      <n-input v-if="input !== undefined" v-model:value="text" :aria-label="title" @keydown.enter="confirm" />
      <footer>
        <n-button quaternary @click="show = false">{{ t('comp.cancel') }}</n-button>
        <n-button :type="danger ? 'error' : 'primary'" @click="confirm">{{ ok }}</n-button>
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
  margin: 0 0 16px;
  color: var(--text-secondary);
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
