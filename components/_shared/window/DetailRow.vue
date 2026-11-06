<!-- DetailSection 里的一行：左边名字和说明，右边控件(插槽)，上边一条细线，最后一行下面也有一条。
     inset 时左边留 3px、右边留 32px 一列，和组件设置的行对齐；openEnd 时最后一行下面不画线 -->
<script setup lang="ts">
defineProps<{ title: string; desc?: string; inset?: boolean; openEnd?: boolean }>();
</script>

<template>
  <div class="cfg" :class="{ inset, closed: !openEnd }">
    <div><h3>{{ title }}</h3><p v-if="desc">{{ desc }}</p></div>
    <slot />
  </div>
</template>

<style scoped>
.cfg {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 16px;
  min-height: 72px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}
.cfg.inset {
  grid-template-columns: minmax(0, 1fr) auto 32px;
  border-left: 3px solid transparent;
}
.cfg.closed:last-child {
  border-bottom: 1px solid var(--line);
}
h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
p {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
