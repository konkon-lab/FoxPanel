<!-- 56px 高的标题行：左边标题，右边一排图标按钮(插槽，放 IconAction)，下边一条细线；页面底色。
     detail 是组件页右栏的样子：白底，标题太长时截断、悬停显示全名 -->
<script setup lang="ts">
defineProps<{ title: string; detail?: boolean }>();
</script>

<template>
  <div class="head" :class="{ detail }">
    <h1 :title="detail ? title : undefined">{{ title }}</h1>
    <span class="acts"><slot /></span>
  </div>
</template>

<style scoped>
.head {
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px 0 24px;
  background: var(--page-bg);
  border-bottom: 1px solid var(--line);
}
.head.detail {
  background: var(--surface);
}
h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.detail h1 {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acts {
  display: flex;
  flex: none;
}
</style>
