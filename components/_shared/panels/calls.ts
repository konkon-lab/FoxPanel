// 远程服务 panels 的调用：参数按 unknown 收，收窄成命令；命令作用到布局上。各显示方共用。

import type { Caller, PanelInfo, PanelPatch, PanelsCalls, Served } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../util.ts';
import { isAnchor, isPanelId, lockAll, readMeters, reset, setOpen, setPanel, summon, toggleAll, type DisplaySettings, type Layout } from './layout.ts';

// 收窄好的一次调用
export type PanelsCommand =
  | { kind: 'open'; id: string; on: boolean }
  | { kind: 'toggleAll' }
  | { kind: 'summon'; id: string | null }   // null = 全部显示着的
  | { kind: 'reset'; id: string }
  | { kind: 'set'; id: string; patch: PanelPatch }
  | { kind: 'lockAll'; on: boolean };

// 一块面板能改的项里认得的；值不对的、不认识的键都丢掉
export function readPatch(raw: unknown): PanelPatch {
  const out: PanelPatch = {};
  if (!isObject(raw)) return out;
  if (typeof raw['pinned'] === 'boolean') out.pinned = raw['pinned'];
  if (typeof raw['locked'] === 'boolean') out.locked = raw['locked'];
  const meters = readMeters(raw['meters']);
  if (meters !== undefined) out.meters = meters;
  if (isAnchor(raw['anchor'])) out.anchor = raw['anchor'];
  if (typeof raw['glance'] === 'boolean') out.glance = raw['glance'];
  return out;
}

// 一次调用收窄成命令：method 是方法名，args 是调用者之后的参数。
// 面板 id 不合格、开关不是布尔、能改的项一项都认不出时为 null(不做任何事)
export function parseCall(method: keyof PanelsCalls, args: readonly unknown[]): PanelsCommand | null {
  const [first, second] = args;
  switch (method) {
    case 'open':
      return isPanelId(first) && typeof second === 'boolean' ? { kind: 'open', id: first, on: second } : null;
    case 'toggleAll':
      return { kind: 'toggleAll' };
    case 'summon':
      if (first === undefined || first === null) return { kind: 'summon', id: null };
      return isPanelId(first) ? { kind: 'summon', id: first } : null;
    case 'reset':
      return isPanelId(first) ? { kind: 'reset', id: first } : null;
    case 'set': {
      const patch = readPatch(second);
      return isPanelId(first) && Object.keys(patch).length ? { kind: 'set', id: first, patch } : null;
    }
    case 'lockAll':
      return typeof first === 'boolean' ? { kind: 'lockAll', on: first } : null;
  }
}

// 命令作用到布局上：给出新的布局，没有变化时给回同一份
export function applyCommand(layout: Layout, list: readonly PanelInfo[], settings: DisplaySettings, command: PanelsCommand): Layout {
  switch (command.kind) {
    case 'open': return setOpen(layout, settings, command.id, command.on);
    case 'toggleAll': return toggleAll(layout);
    case 'summon': return command.id === null ? summon(layout, settings) : summon(layout, settings, command.id);
    case 'reset': return reset(layout, list, command.id);
    case 'set': return setPanel(layout, list, command.id, command.patch);
    case 'lockAll': return lockAll(layout, command.on);
  }
}

// 远程服务 panels 的实现：每个方法把参数收窄成命令，连同宿主填的调用者交给 run；收窄不过的不交
export function serveCalls(run: (command: PanelsCommand, caller: Caller) => void): Served<PanelsCalls> {
  const on = (method: keyof PanelsCalls) => (caller: Caller, ...args: unknown[]): void => {
    const command = parseCall(method, args);
    if (command) run(command, caller);
  };
  return { open: on('open'), toggleAll: on('toggleAll'), summon: on('summon'), reset: on('reset'), set: on('set'), lockAll: on('lockAll') };
}
