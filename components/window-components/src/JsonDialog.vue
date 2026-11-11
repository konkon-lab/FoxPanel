<!-- 把一项设置的值当 JSON 文字编辑的对话框：打开时填进当前的值，点确定时读得出来才交出去(apply)并关上，读不出来提示格式非法 -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { NButton, NInput, NModal } from 'naive-ui';
import { t } from './i18n.ts';

// label = 设置项的名字；value = 当前的值
const props = defineProps<{ label: string; value: unknown }>();
const show = defineModel<boolean>('show', { required: true });
const emit = defineEmits<{ apply: [value: unknown] }>();

const text = ref('');
const bad = ref(false);   // 框里的字读不成 JSON
watch(show, open => {
  if (!open) return;
  text.value = JSON.stringify(props.value, null, 2);
  bad.value = false;
});

function apply(): void {
  try {
    emit('apply', JSON.parse(text.value) as unknown);
    show.value = false;
  } catch {
    bad.value = true;
  }
}
</script>

<template>
  <n-modal v-model:show="show" :auto-focus="false">
    <section class="dialog" role="dialog" :aria-label="t('cp.editJson')">
      <h2>{{ t('cp.editJson') }} · {{ label }}</h2>
      <n-input v-model:value="text" type="textarea" class="mono" :autosize="{ minRows: 4, maxRows: 16 }" :status="bad ? 'error' : 'success'" />
      <p v-if="bad" class="error">{{ t('cp.jsonError') }}</p>
      <footer>
        <n-button quaternary @click="show = false">{{ t('comp.cancel') }}</n-button>
        <n-button type="primary" @click="apply">{{ t('cp.apply') }}</n-button>
      </footer>
    </section>
  </n-modal>
</template>

<style scoped>
.dialog {
  width: 520px;
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.18);
}
h2 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}
.error {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--warning);
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.mono,
.mono :deep(textarea) {
  font-family: Consolas, monospace;
  font-size: 12.5px;
}
</style>
