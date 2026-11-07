<!-- 经典外壳(1400×490)：候选栏、输入框，下面是键区 + 右侧面板(当前侧栏页 + 竖排侧栏：上面页签，下面侧栏按钮)。
     插槽是带 data-slot 的元素，宿主把部件挂进去；下半部分标 data-region="body"，展开候选盖在它上面。
     候选栏、输入框、键区的插槽里没有部件时放一条缺件提示 -->
<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue';
import { useCtx, useWords } from '../../_shared/vue.ts';
import { activePage } from './tabs.ts';
import { TEXT, type RequiredSlot } from './words.ts';

const ctx = useCtx();
const t = useWords(TEXT);
const missing = (slot: RequiredSlot): boolean => ctx.panel.parts(slot).length === 0;

// 侧栏页：页签选中哪一页就显示哪一页，别的页藏起来
const pages = computed(() => ctx.panel.parts('sidepage'));
const picked = ref('');
const active = computed(() => activePage(pages.value.map(p => p.id), picked.value));
watchEffect(() => {
  for (const p of pages.value) p.el.hidden = p.id !== active.value;
});

// 页签图标：读 svg 文字内联进来，才能跟着文字颜色变
const icons = reactive<Record<string, string>>({});
watchEffect(() => {
  for (const p of pages.value) {
    const { id, icon } = p;
    if (!icon || id in icons) continue;
    icons[id] = '';
    void fetch(icon).then(r => r.text()).then(svg => { icons[id] = svg; }).catch(() => undefined);
  }
});
</script>

<template>
  <div class="shell">
    <div data-slot="candidates" class="candidates">
      <div v-if="missing('candidates')" class="fox-notice">{{ t.candidates }}</div>
    </div>
    <div data-slot="textfield" class="textfield">
      <div v-if="missing('textfield')" class="fox-notice">{{ t.textfield }}</div>
    </div>
    <div class="bottom" data-region="body">
      <div data-slot="layout" class="layout">
        <div v-if="missing('layout')" class="fox-notice">{{ t.layout }}</div>
      </div>
      <div class="side">
        <div data-slot="sidepage" class="page" />
        <div class="rail">
          <div v-if="pages.length > 1" class="tabs">
            <button
              v-for="p in pages" :key="p.id" type="button" class="tab" :class="{ on: p.id === active }" :aria-pressed="p.id === active" :aria-label="p.name"
              @mousedown="picked = p.id"
            >
              <!-- eslint-disable-next-line vue/no-v-html -->
              <span v-if="icons[p.id]" class="icon" v-html="icons[p.id]" />
              <span v-else class="initial">{{ p.name.slice(0, 1) }}</span>
            </button>
          </div>
          <span class="grow" />
          <div data-slot="sidebutton" class="buttons" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: 6px;
  background: var(--panel);
}
.candidates {
  height: 52px;
  flex: 0 0 auto;
  display: flex;
}
.textfield {
  height: 56px;
  flex: 0 0 auto;
  display: flex;
}
.bottom {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
}
.layout {
  flex: 1;
  min-width: 0;
  display: flex;
}
.side {
  width: 340px;
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
}
.page {
  flex: 1;
  min-width: 0;
  display: flex;
}
.rail {
  width: 52px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  border-radius: 6px;
  background: var(--track);
}
.tab {
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--sub) !important;
}
.tab.on {
  background: var(--track-on) !important;
  box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(17, 24, 39, 0.06);
  color: var(--text) !important;
}
.icon {
  display: flex;
}
.icon :deep(svg) {
  width: 22px;
  height: 22px;
}
.initial {
  font-size: 15px;
  font-weight: 600;
}
.grow {
  flex: 1;
}
.buttons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
</style>
