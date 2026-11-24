<!-- 新版本弹窗：检查到新版本时盖在整个窗口上，占窗口宽和高的各 80%(有上限)，上中下三段。
     上：新版本号，下一行是当前版本和发布日期，右边是用浏览器打开发布页的链接(更新源给了发布页才有)。
     中：这一版的更新日志(小标题、列表项、段落，只有文字)，多了在框里滚。
     下：左边是下载进度或「已下载」，右边「跳过此版本」「稍后」和主按钮(下载更新 / 重启并安装)。
     点「稍后」、遮罩、Esc 关掉后这次运行里同一个版本不再弹；点「跳过此版本」以后都不再为这个版本弹。
     开不开、左下角写什么、主按钮是哪个在 update-view.ts -->
<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NModal } from 'naive-ui';
import { fox, store } from '@konkon-lab/foxpanel-window';
import { dismissed, skip, skipped } from './ask.ts';
import { t } from './i18n.ts';
import { progressOf, promptButtonOf, promptOf } from './update-view.ts';

const show = computed(() => promptOf(store.update, dismissed.value, skipped.value));
// 标题下面那一行：当前版本，有发布日期时接在后面
const about = computed(() => {
  const current = t('upd.current', { v: store.version });
  return store.update.date ? `${current} · ${t('upd.released', { d: store.update.date })}` : current;
});
const notes = computed(() => store.update.notes ?? []);
const progress = computed(() => progressOf(store.update));
const button = computed(() => promptButtonOf(store.update.state));

function later(): void {
  dismissed.value = store.update.version ?? null;
}
function skipThis(): void {
  if (store.update.version) skip(store.update.version);
}
function openPage(): void {
  if (store.update.url) void fox.openExternal(store.update.url);
}
function onButton(): void {
  if (button.value.action === 'install') void fox.updateInstall();
  else void fox.updateCheck();
}
</script>

<template>
  <n-modal :show="show" :mask-closable="true" :auto-focus="false" @update:show="(v: boolean) => !v && later()">
    <section class="dialog" role="dialog" aria-labelledby="update-title" aria-modal="true">
      <header>
        <div class="head">
          <h2 id="update-title">{{ t('upd.found', { v: store.update.version ?? '' }) }}</h2>
          <p class="current">{{ about }}</p>
        </div>
        <n-button v-if="store.update.url" text type="primary" @click="openPage">{{ t('upd.releasePage') }}</n-button>
      </header>
      <div class="notes" :class="{ empty: notes.length === 0 }" tabindex="0">
        <p v-if="notes.length === 0">{{ t('upd.noNotes') }}</p>
        <template v-for="(note, i) in notes" :key="i">
          <h3 v-if="note.kind === 'heading'">{{ note.text }}</h3>
          <p v-else-if="note.kind === 'item'" class="item">{{ note.text }}</p>
          <p v-else>{{ note.text }}</p>
        </template>
      </div>
      <footer>
        <div class="progress">
          <template v-if="progress">
            <span class="state" :class="{ ready: progress.percent === null }">{{ t(progress.key, progress.params) }}</span>
            <div
              v-if="progress.percent !== null" class="bar" role="progressbar"
              :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100"
            >
              <div class="fill" :style="{ width: `${progress.percent}%` }" />
            </div>
          </template>
        </div>
        <n-button size="large" quaternary class="skip" @click="skipThis">{{ t('upd.skip') }}</n-button>
        <n-button size="large" quaternary @click="later">{{ t('upd.later') }}</n-button>
        <n-button size="large" type="primary" :disabled="button.disabled" @click="onButton">{{ t(button.text) }}</n-button>
      </footer>
    </section>
  </n-modal>
</template>

<style scoped>
.dialog {
  width: min(80vw, 1280px);
  height: min(80vh, 860px);
  min-height: 320px;
  max-height: calc(100vh - 32px);
  box-sizing: border-box;
  padding: 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 16px 40px rgba(17, 24, 39, 0.2);
}
header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.head {
  flex: 1 1 0;
  min-width: 0;
}
header .n-button {
  line-height: 34px;
}
.skip {
  color: var(--text-secondary);
}
h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.current {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--text-secondary);
}
.notes {
  flex: 1 1 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--track);
  font-size: 15px;
  line-height: 1.6;
}
.notes.empty {
  color: var(--text-secondary);
}
.notes h3 {
  margin: 6px 0 0;
  font-size: 15px;
  font-weight: 600;
}
.notes h3:first-child {
  margin-top: 0;
}
.notes p {
  margin: 0;
  overflow-wrap: anywhere;
}
.notes .item {
  position: relative;
  padding-left: 16px;
}
.notes .item::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 0.72em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
footer {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress {
  flex: 1 1 0;
  min-width: 0;
  margin-right: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.state {
  font-size: 13px;
  color: var(--text-secondary);
}
.state.ready {
  color: var(--success);
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--track);
  overflow: hidden;
}
.fill {
  height: 6px;
  background: var(--accent);
  transition: width 0.2s ease;
}
@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>
