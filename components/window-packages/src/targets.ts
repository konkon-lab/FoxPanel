// 依赖管理页每行「目标版本」下拉能选的值：npm 装的是仓库里的各版本(新的在前)，别的只有当前版本；最后是「移除」，保护名单里的组件没有。
import type { ComponentRow } from '@konkon-lab/foxpanel-sdk';
import { isProtected } from '../../_shared/window/protect.ts';

export const REMOVE = '__remove';   // 「移除」一项的值(不会和版本号重)

// versions：包名 → 仓库里的版本；还没读到时只给当前版本
export function targetValues(r: Pick<ComponentRow, 'id' | 'npm' | 'version'>, versions: Readonly<Record<string, string[]>>): string[] {
  const list = r.npm ? versions[r.npm] ?? [r.version] : [r.version];
  return isProtected(r.id) ? list : [...list, REMOVE];
}
