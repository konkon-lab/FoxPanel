// 保护名单：停用或卸载后就回不到界面的组件。
// 名单里的组件、包含它们的分组，界面上不能停用、不能卸载或删除；手改配置不管。
import type { ComponentRow } from '@konkon-lab/foxpanel-sdk';

const PROTECTED: readonly string[] = ['yanuo.window-components', 'yanuo.window-shell'];

export const isProtected = (id: string): boolean => PROTECTED.includes(id);
export const hasProtected = (rows: readonly ComponentRow[]): boolean => rows.some(r => isProtected(r.id));
