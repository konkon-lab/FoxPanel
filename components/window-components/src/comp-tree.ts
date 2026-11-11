// 组件页的组件树：设置里的分组按顺序排，不在分组里的组件在顶层排在分组后面，加载失败的放最后；
// 以及分组的增删改、折叠、拖动。

import { computed, ref } from 'vue';
import { locale, store, textOf } from '@konkon-lab/foxpanel-window';
import type { ComponentGroup, ComponentRow } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { patch } from './ops.ts';
import { moveNear } from './values.ts';

// 树里各段的 key(nav.group 和设置里的 folded 用它)：分组是 groupKey(id)，另外两段不是分组
export const groupKey = (id: string): string => `u:${id}`;
export const BROKEN_KEY = 'd:broken';   // 「加载失败」
export const ROOT_KEY = 'd:root';       // 树的顶层

// 树里的一段组件行：一个分组，或顶层
export interface TreeRows {
  key: string;
  rows: ComponentRow[];
}

export interface TreeGroup extends TreeRows {
  title: string;
  group: ComponentGroup;  // 设置里的这个分组
  folded: boolean;        // 组件树里是否收起着
  defaultFolded: boolean; // 打开组件页时是否收起(分组设置里的「默认折叠」)
}

export const query = ref('');

// 组件树里点三角展开 / 收起过的分组(key → 是否收起，不保存)；没点过的按默认折叠
const foldedInTree = ref<Record<string, boolean>>({});

// 组件显示的名字：重命名过的优先
export const nameOf = (r: ComponentRow): string => store.settings.components.names[r.id] ?? textOf(r.name, locale.value);

// 分组(不过滤)
export const tree = computed<TreeGroup[]>(() => {
  const s = store.settings.components;
  const byId = new Map(store.comps.rows.map(r => [r.id, r]));
  const folded = new Set(s.folded);
  return s.groups.map(g => {
    const key = groupKey(g.id);
    return { key, title: g.name, group: g, rows: g.ids.flatMap(id => byId.get(id) ?? []), folded: foldedInTree.value[key] ?? folded.has(key), defaultFolded: folded.has(key) };
  });
});

// 顶层：不在任何分组里的组件，按组件顺序
export const root = computed<TreeRows>(() => {
  const grouped = new Set(store.settings.components.groups.flatMap(g => g.ids));
  return { key: ROOT_KEY, rows: store.comps.rows.filter(r => !grouped.has(r.id)) };
});

const matches = (r: ComponentRow, q: string): boolean => nameOf(r).toLowerCase().includes(q) || r.id.includes(q);

// 搜索后的树：按名字和 id 过滤，搜索时都展开
export const visibleTree = computed<TreeGroup[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return tree.value;
  return tree.value
    .map(g => ({ ...g, folded: false, rows: g.rows.filter(r => matches(r, q)) }))
    .filter(g => g.rows.length || g.title.toLowerCase().includes(q));
});

// 搜索后的顶层组件
export const visibleRoot = computed<ComponentRow[]>(() => {
  const q = query.value.trim().toLowerCase();
  return q ? root.value.rows.filter(r => matches(r, q)) : root.value.rows;
});

export const findGroup = (key: string): TreeGroup | undefined => tree.value.find(g => g.key === key);

const saveGroups = (groups: ComponentGroup[]): Promise<boolean> => patch({ kind: 'groups', groups });

// 组件树里展开 / 收起一个分组(不保存)
export function setFolded(key: string, folded: boolean): void {
  foldedInTree.value = { ...foldedInTree.value, [key]: folded };
}

// 各分组回到默认折叠(打开组件页时)
export function resetFolded(): void {
  foldedInTree.value = {};
}

// 改分组的默认折叠，组件树跟着变
export function setDefaultFolded(key: string, folded: boolean): void {
  setFolded(key, folded);
  void patch({ kind: 'fold', key, folded });
}

// 把分组拖到另一个分组前面(before 为空时放到最后)
export function moveGroup(key: string, before: string | null): void {
  const all = store.settings.components.groups;
  const moving = all.find(g => groupKey(g.id) === key);
  if (!moving) return;
  const rest = all.filter(g => g !== moving);
  const at = before ? rest.findIndex(g => groupKey(g.id) === before) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, moving);
  void saveGroups(rest);
}

// 新建分组，返回它的 key；没存上时是 null
export async function newGroup(): Promise<string | null> {
  const id = `g${Date.now().toString(36)}`;
  const ok = await saveGroups([...store.settings.components.groups, { id, name: t('cp.newGroupName'), ids: [] }]);
  return ok ? groupKey(id) : null;
}

export function renameGroup(id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  void saveGroups(store.settings.components.groups.map(g => (g.id === id ? { ...g, name: n } : g)));
}

// 移除分组：里面的组件到树的顶层
export function removeGroup(id: string): void {
  void saveGroups(store.settings.components.groups.filter(g => g.id !== id));
}

// 把组件移进分组(key 是 ROOT_KEY 时移到顶层)；before = 排在这个组件前面
export function moveTo(id: string, key: string, before?: string): void {
  const groups = store.settings.components.groups.map(g => ({ ...g, ids: g.ids.filter(x => x !== id) }));
  if (key !== ROOT_KEY) {
    const g = groups.find(x => groupKey(x.id) === key);
    if (!g) return;
    const at = before ? g.ids.indexOf(before) : -1;
    g.ids.splice(at < 0 ? g.ids.length : at, 0, id);
  }
  void saveGroups(groups);
}

// 同类组件的顺序(键盘上的顺序)：把 id 挪到 target 旁边
function reorderKind(id: string, target: string): void {
  const rows = store.comps.rows;
  const from = rows.find(r => r.id === id);
  const to = rows.find(r => r.id === target);
  if (!from || !to || from.kind !== to.kind || id === target) return;
  const same = rows.filter(r => r.kind === from.kind).map(r => r.id);
  void patch({ kind: 'order', ids: moveNear(same, id, target) });
}

// 拖到一个组件上(key = 它所在的那一段)：同一个分组里调成员顺序，同类的还调键盘上的顺序；跨分组(含顶层)时移过去
export function dropOn(id: string, target: ComponentRow, key: string): void {
  const from = tree.value.find(g => g.rows.some(r => r.id === id));
  if ((from?.key ?? ROOT_KEY) !== key) return moveTo(id, key, target.id);
  if (from) {
    const ids = moveNear(from.group.ids, id, target.id);
    void saveGroups(store.settings.components.groups.map(g => (g.id === from.group.id ? { ...g, ids } : g)));
  }
  reorderKind(id, target.id);
}
