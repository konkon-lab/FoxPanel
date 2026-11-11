<!-- secret 设置的输入框和眼睛按钮：框里是草稿，或验证后取到的明文；输入的新值进草稿(set)。
     眼睛按钮切换明文：已保存的值要先过 Windows 安全验证，显示 30 秒后自动隐藏；验证没过的原因经 error 交出去(空 = 没有) -->
<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { NInput } from 'naive-ui';
import { Eye, EyeOff } from '@lucide/vue';
import { fox } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import RowButton from './RowButton.vue';

const REVEAL_MS = 30_000;   // 验证后明文显示多久(ms)

// owner / field = 组件 id 和设置的键；saved = 已经存了值；hint = 已存的值的掩码；draft = 草稿(没改过是 undefined，空字符串 = 清除)
const props = defineProps<{ owner: string; field: string; label: string; saved: boolean; hint?: string | undefined; draft?: string | undefined }>();
const emit = defineEmits<{ set: [value: string]; error: [text: string] }>();

const shown = ref(false);
const revealed = ref<string | null>(null);   // 验证后取到的明文
const revealing = ref(false);                // 正在等验证
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const value = computed(() => props.draft ?? (shown.value ? revealed.value ?? '' : ''));

function hide(): void {
  clearTimeout(hideTimer);
  shown.value = false;
  revealed.value = null;
}
async function toggleShown(): Promise<void> {
  emit('error', '');
  if (shown.value) return hide();
  if (props.draft !== undefined || !props.saved) {
    shown.value = true;
    return;
  }
  revealing.value = true;
  const r = await fox.compSecretReveal(props.owner, props.field);
  revealing.value = false;
  if (!r.ok) {
    emit('error', t(`cp.verify.${r.error}`));
    return;
  }
  revealed.value = r.value;
  shown.value = true;
  hideTimer = setTimeout(hide, REVEAL_MS);
}
onUnmounted(hide);
</script>

<template>
  <span class="secret">
    <n-input
      class="txt mono" :type="shown ? 'text' : 'password'" :value="value" :aria-label="label"
      :placeholder="saved ? (hint || '••••••') : t('cp.secretPlaceholder')" @update:value="(v: string) => emit('set', v)"
    />
    <row-button
      :title="shown ? t('cp.hide') : t('cp.reveal')" :label="`${shown ? t('cp.hide') : t('cp.reveal')} ${label}`"
      :disabled="revealing || (!saved && draft === undefined)" @click="toggleShown"
    >
      <component :is="shown ? EyeOff : Eye" :size="16" />
    </row-button>
  </span>
</template>

<style scoped>
.secret {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 加上眼睛按钮(32 + 间距 8)，总宽和文字框的 260 一样，左右边都对齐 */
.txt {
  width: 220px;
}
.mono,
.mono :deep(input) {
  font-family: Consolas, monospace;
  font-size: 12.5px;
}
</style>
