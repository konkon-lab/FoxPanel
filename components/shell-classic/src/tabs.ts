// 侧栏页的页签：选中哪一页。

// 显示着的那一页：选过的那页还在就是它，否则是第一页；一页都没有时为空串
export function activePage(ids: readonly string[], picked: string): string {
  return ids.includes(picked) ? picked : ids[0] ?? '';
}
